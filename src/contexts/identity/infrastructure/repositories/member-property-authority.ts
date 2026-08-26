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

type MemberPropertyAuthorityDatabase = Pick<Database, 'execute' | 'select'>

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
    const member = await db.execute(sql`
      SELECT role
      FROM member
      WHERE "organizationId" = ${organizationId}
        AND "userId" = ${userId}
      LIMIT 1
    `)
    const role = member.rows[0]?.role
    if (typeof role !== 'string' || role.length === 0) return false

    const decision = await decideMemberPropertyAuthority(db, {
      organizationId,
      propertyId,
      userId,
      memberRole: role,
      permission,
      at: new Date(),
    })
    return decision.allowed
  }
}
