import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import {
  canForContext,
  scopeForPermission,
  type Permission,
  type PermissionAuthorityContext,
} from '#/shared/domain/permissions'

export type MemberPropertyAuthorityDecision =
  | Readonly<{ allowed: true; scope: 'organization' | 'assigned-properties' }>
  | Readonly<{ allowed: false; reason: 'membership_denied' | 'assignment_denied' }>

export function propertyAuthorityRequirement(
  authority: PermissionAuthorityContext,
  permission: Permission,
): 'organization' | 'active-grant' | 'deny' {
  if (!canForContext(authority, permission)) return 'deny'
  const scope = scopeForPermission(authority, permission)
  if (scope === 'organization') return 'organization'
  return scope === 'assigned-properties' ? 'active-grant' : 'deny'
}

export type MemberPropertyAuthorityLookup = (
  organizationId: string,
  propertyId: string,
  userId: string,
) => Promise<boolean>

export type MemberPropertyAuthorityDatabase = Pick<Database, 'execute' | 'select'>

async function readPermissionVersion(
  db: MemberPropertyAuthorityDatabase,
  organizationId: string,
  lock: boolean,
): Promise<string | null> {
  const version = lock
    ? await db.execute(sql`
        SELECT version::text AS version
        FROM permission_version
        WHERE organization_id = ${organizationId}
        FOR SHARE
      `)
    : await db.execute(sql`
        SELECT version::text AS version
        FROM permission_version
        WHERE organization_id = ${organizationId}
      `)
  const value = version.rows[0]?.version
  return typeof value === 'string' ? value : null
}

/**
 * Resolve current membership and Property authority in the caller's
 * transaction. Read the permission generation optimistically, lock the
 * concrete membership/grant rows in the same order their mutations acquire
 * them, then lock and re-read the generation. A changed generation denies the
 * command; a matching locked generation is the serializable cutover point.
 *
 * Taking the generation lock first would invert the order of Identity's
 * row-mutation + AFTER-trigger bump and can deadlock a mutation-first race.
 * No in-transaction retry is needed: denying a changed generation is bounded,
 * fail-closed, and the caller can start a fresh command from current state.
 *
 * A missing version row is denied. The registered Identity SQL sidecar
 * backfills existing Organizations and every later membership/grant mutation
 * creates or bumps the row; accepting an unversioned decision would reopen a
 * revocation race during an incomplete deployment.
 */
export async function decideCurrentMemberPropertyAuthority(
  db: MemberPropertyAuthorityDatabase,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    permission: Permission
    at: Date
  }>,
): Promise<MemberPropertyAuthorityDecision> {
  const observedVersion = await readPermissionVersion(db, input.organizationId, false)
  if (observedVersion === null) {
    return { allowed: false, reason: 'membership_denied' }
  }

  const member = await db.execute(sql`
    SELECT role
    FROM member
    WHERE "organizationId" = ${input.organizationId}
      AND "userId" = ${input.userId}
    FOR SHARE
  `)
  const memberRole = member.rows[0]?.role
  const decision =
    typeof memberRole !== 'string' || memberRole.length === 0
      ? ({ allowed: false, reason: 'membership_denied' } as const)
      : await decideMemberPropertyAuthority(db, {
          ...input,
          memberRole,
        })

  const currentVersion = await readPermissionVersion(db, input.organizationId, true)
  if (currentVersion === observedVersion || !decision.allowed) return decision
  return { allowed: false, reason: 'membership_denied' }
}

/**
 * Resolve a locked/current membership through the same effective-permission
 * model as interactive requests. For assigned scope, the grant row is locked
 * for the remainder of the caller transaction so revocation cannot race an
 * authorization-sensitive write.
 *
 * Runtime custom roles are beta-disabled. The dynamic resolver is still used
 * when explicitly enabled, but callers must add policy-row locking before
 * activating that dormant capability for transaction-sensitive commands.
 */
export async function decideMemberPropertyAuthority(
  db: MemberPropertyAuthorityDatabase,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    memberRole: string
    permission: Permission
    at: Date
  }>,
): Promise<MemberPropertyAuthorityDecision> {
  const { context } = await resolveMemberAuthContextWithDatabase(db, {
    organizationId: input.organizationId,
    userId: input.userId,
    memberRole: input.memberRole,
  })
  const requirement = propertyAuthorityRequirement(context, input.permission)
  if (requirement === 'organization') {
    return { allowed: true, scope: 'organization' }
  }
  if (requirement === 'deny') {
    return { allowed: false, reason: 'membership_denied' }
  }

  const grant = await db.execute(sql`
    SELECT id
    FROM property_access_grant
    WHERE organization_id = ${input.organizationId}
      AND property_id = ${input.propertyId}::uuid
      AND user_id = ${input.userId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ${input.at})
    FOR SHARE
  `)
  return grant.rows.length > 0
    ? { allowed: true, scope: 'assigned-properties' }
    : { allowed: false, reason: 'assignment_denied' }
}

/**
 * Cross-context adapter for callers that possess only an accountable member
 * identity. Membership is loaded at call time; the legacy role is then fed to
 * the canonical effective-permission resolver and is not itself the verdict.
 */
export function createMemberPropertyAuthorityLookup(
  db: Database,
  permission: Permission,
): MemberPropertyAuthorityLookup {
  return async (organizationId, propertyId, userId) => {
    const decision = await decideCurrentMemberPropertyAuthority(db, {
      organizationId,
      propertyId,
      userId,
      permission,
      at: new Date(),
    })
    return decision.allowed
  }
}
