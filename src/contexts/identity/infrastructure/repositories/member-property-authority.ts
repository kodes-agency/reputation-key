import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { resolveMemberAuthContextWithDatabase } from '#/shared/auth/tenant-resolver'
import {
  canForContext,
  scopeForPermission,
  type Permission,
  type PermissionAuthorityContext,
} from '#/shared/domain/permissions'
import { toDomainRole } from '#/shared/domain/roles'
import {
  isBetaInteractiveRole,
  requiresStaffParticipation,
} from '#/shared/domain/beta-interactive-role'

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

/**
 * Collapse a command's complete permission set into one Property authority
 * requirement. Every permission must be present; one assigned-Property scope
 * makes the whole command assigned-scoped so callers need only one canonical
 * grant read and lock.
 */
export function managerPropertyAuthorityRequirement(
  authority: PermissionAuthorityContext,
  permissions: readonly Permission[],
): 'organization' | 'active-grant' | 'deny' {
  if (permissions.length === 0) return 'deny'

  let requirement: 'organization' | 'active-grant' = 'organization'
  for (const permission of new Set(permissions)) {
    const permissionRequirement = propertyAuthorityRequirement(authority, permission)
    if (permissionRequirement === 'deny') return 'deny'
    if (permissionRequirement === 'active-grant') requirement = 'active-grant'
  }
  return requirement
}

export type MemberPropertyAuthorityLookup = (
  organizationId: string,
  propertyId: string,
  userId: string,
) => Promise<boolean>

export type MemberPropertyAuthorityDatabase = Pick<Database, 'execute' | 'select'>

export type ManagerPropertyAuthorityDenyReason =
  | 'membership_denied'
  | 'manager_role_denied'
  | 'permission_denied'
  | 'assignment_denied'
  | 'authority_changed'

export type CurrentManagerPropertyAuthorityDecision =
  | Readonly<{
      allowed: true
      role: 'AccountAdmin' | 'PropertyManager'
      scope: 'organization' | 'assigned-properties'
      requiresStaffParticipation: boolean
    }>
  | Readonly<{
      allowed: false
      reason: ManagerPropertyAuthorityDenyReason
    }>

export type ManagerPropertyAuthorityRequirement = Readonly<{
  propertyId: string
  userId: string
  permissions: readonly Permission[]
}>

export type CurrentManagerPropertyAuthorityBatchDecision =
  | Readonly<{
      allowed: true
      decisions: readonly Readonly<{
        propertyId: string
        userId: string
        role: 'AccountAdmin' | 'PropertyManager'
        scope: 'organization' | 'assigned-properties'
        requiresStaffParticipation: boolean
      }>[]
    }>
  | Readonly<{
      allowed: false
      propertyId: string
      userId: string
      reason: ManagerPropertyAuthorityDenyReason
    }>

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

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const compareAuthorityRequirement = (
  left: ManagerPropertyAuthorityRequirement,
  right: ManagerPropertyAuthorityRequirement,
): number =>
  compareText(left.userId, right.userId) || compareText(left.propertyId, right.propertyId)

function canonicalizeAuthorityRequirements(
  requirements: readonly ManagerPropertyAuthorityRequirement[],
): readonly ManagerPropertyAuthorityRequirement[] {
  const merged = new Map<
    string,
    { propertyId: string; userId: string; permissions: Set<Permission> }
  >()
  for (const requirement of requirements) {
    const key = `${requirement.userId}\u0000${requirement.propertyId}`
    const current = merged.get(key) ?? {
      propertyId: requirement.propertyId,
      userId: requirement.userId,
      permissions: new Set<Permission>(),
    }
    for (const permission of requirement.permissions) {
      current.permissions.add(permission)
    }
    merged.set(key, current)
  }
  return [...merged.values()]
    .map((requirement) => ({
      ...requirement,
      permissions: [...requirement.permissions].sort(compareText),
    }))
    .sort(compareAuthorityRequirement)
}

/**
 * Resolve a command's complete unique manager/Property authority set through
 * one permission-generation boundary. Membership rows are locked in user-id
 * order, then every required grant in (user-id, Property-id) order, and only
 * then is permission_version locked and rechecked once.
 *
 * The generation lock must remain last. Identity mutations lock a concrete
 * membership/grant row before their AFTER trigger bumps permission_version;
 * taking the generation lock between two command principals would let a
 * later-principal revocation form a lock cycle with this transaction.
 */
export async function decideCurrentManagerPropertyAuthorities(
  db: MemberPropertyAuthorityDatabase,
  input: Readonly<{
    organizationId: string
    requirements: readonly ManagerPropertyAuthorityRequirement[]
    at: Date
  }>,
): Promise<CurrentManagerPropertyAuthorityBatchDecision> {
  const requirements = canonicalizeAuthorityRequirements(input.requirements)
  if (requirements.length === 0) return { allowed: true, decisions: [] }

  const firstRequirement = requirements[0]
  if (!firstRequirement) return { allowed: true, decisions: [] }
  const observedVersion = await readPermissionVersion(db, input.organizationId, false)
  if (observedVersion === null) {
    return {
      allowed: false,
      propertyId: firstRequirement.propertyId,
      userId: firstRequirement.userId,
      reason: 'authority_changed',
    }
  }

  const userIds = [
    ...new Set(requirements.map((requirement) => requirement.userId)),
  ].sort(compareText)
  const memberRoles = new Map<string, string | null>()
  for (const userId of userIds) {
    const member = await db.execute(sql`
      SELECT role
      FROM member
      WHERE "organizationId" = ${input.organizationId}
        AND "userId" = ${userId}
      FOR SHARE
    `)
    const memberRole = member.rows[0]?.role
    memberRoles.set(
      userId,
      typeof memberRole === 'string' && memberRole.length > 0 ? memberRole : null,
    )
  }

  type UserAuthority =
    | Readonly<{
        allowed: true
        role: 'AccountAdmin' | 'PropertyManager'
        context: PermissionAuthorityContext
        requiresStaffParticipation: boolean
      }>
    | Readonly<{
        allowed: false
        reason: 'membership_denied' | 'manager_role_denied'
      }>

  const userAuthorities = new Map<string, UserAuthority>()
  for (const userId of userIds) {
    const memberRole = memberRoles.get(userId) ?? null
    if (memberRole === null) {
      userAuthorities.set(userId, { allowed: false, reason: 'membership_denied' })
      continue
    }
    const role = toDomainRole(memberRole)
    if (role === null || !isBetaInteractiveRole(role)) {
      userAuthorities.set(userId, { allowed: false, reason: 'manager_role_denied' })
      continue
    }
    const { context } = await resolveMemberAuthContextWithDatabase(db, {
      organizationId: input.organizationId,
      userId,
      memberRole,
    })
    userAuthorities.set(userId, {
      allowed: true,
      role,
      context,
      requiresStaffParticipation: requiresStaffParticipation(role),
    })
  }

  type PendingDecision = Readonly<{
    requirement: ManagerPropertyAuthorityRequirement
    role: 'AccountAdmin' | 'PropertyManager'
    requiresStaffParticipation: boolean
    scope: 'organization' | 'assigned-properties'
  }>
  let firstDenied:
    | Readonly<{
        requirement: ManagerPropertyAuthorityRequirement
        reason: ManagerPropertyAuthorityDenyReason
      }>
    | undefined
  const pending: PendingDecision[] = []

  for (const requirement of requirements) {
    const userAuthority = userAuthorities.get(requirement.userId)
    if (!userAuthority || !userAuthority.allowed) {
      firstDenied ??= {
        requirement,
        reason: userAuthority?.reason ?? 'membership_denied',
      }
      continue
    }
    const authorityRequirement = managerPropertyAuthorityRequirement(
      userAuthority.context,
      requirement.permissions,
    )
    if (authorityRequirement === 'deny') {
      firstDenied ??= { requirement, reason: 'permission_denied' }
      continue
    }
    pending.push({
      requirement,
      role: userAuthority.role,
      requiresStaffParticipation: userAuthority.requiresStaffParticipation,
      scope:
        authorityRequirement === 'organization' ? 'organization' : 'assigned-properties',
    })
  }

  for (const decision of pending) {
    if (decision.scope !== 'assigned-properties') continue
    const { requirement } = decision
    const grant = await db.execute(sql`
      SELECT id
      FROM property_access_grant
      WHERE organization_id = ${input.organizationId}
        AND property_id = ${requirement.propertyId}::uuid
        AND user_id = ${requirement.userId}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ${input.at})
      LIMIT 1
      FOR SHARE
    `)
    const granted = grant.rows.length === 1
    if (!granted) firstDenied ??= { requirement, reason: 'assignment_denied' }
  }

  const currentVersion = await readPermissionVersion(db, input.organizationId, true)
  if (firstDenied) {
    return {
      allowed: false,
      propertyId: firstDenied.requirement.propertyId,
      userId: firstDenied.requirement.userId,
      reason: firstDenied.reason,
    }
  }
  if (currentVersion !== observedVersion) {
    return {
      allowed: false,
      propertyId: firstRequirement.propertyId,
      userId: firstRequirement.userId,
      reason: 'authority_changed',
    }
  }

  return {
    allowed: true,
    decisions: pending.map((decision) => ({
      propertyId: decision.requirement.propertyId,
      userId: decision.requirement.userId,
      role: decision.role,
      scope: decision.scope,
      requiresStaffParticipation: decision.requiresStaffParticipation,
    })),
  }
}

/** Resolve one manager/Property tuple through the canonical batch primitive. */
export async function decideCurrentManagerPropertyAuthority(
  db: MemberPropertyAuthorityDatabase,
  input: Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    permissions: readonly Permission[]
    at: Date
  }>,
): Promise<CurrentManagerPropertyAuthorityDecision> {
  const batch = await decideCurrentManagerPropertyAuthorities(db, {
    organizationId: input.organizationId,
    requirements: [
      {
        propertyId: input.propertyId,
        userId: input.userId,
        permissions: input.permissions,
      },
    ],
    at: input.at,
  })
  if (!batch.allowed) return { allowed: false, reason: batch.reason }
  const decision = batch.decisions[0]
  return decision
    ? {
        allowed: true,
        role: decision.role,
        scope: decision.scope,
        requiresStaffParticipation: decision.requiresStaffParticipation,
      }
    : { allowed: false, reason: 'permission_denied' }
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
  const decision = await decideCurrentManagerPropertyAuthority(db, {
    ...input,
    permissions: [input.permission],
  })
  if (decision.allowed) return { allowed: true, scope: decision.scope }
  return {
    allowed: false,
    reason:
      decision.reason === 'assignment_denied' ? 'assignment_denied' : 'membership_denied',
  }
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
export const createMemberPropertyAuthorityLookup = (
  db: Database,
  permission: Permission,
  clock: () => Date,
): MemberPropertyAuthorityLookup => {
  return async (organizationId, propertyId, userId) => {
    const decision = await decideCurrentMemberPropertyAuthority(db, {
      organizationId,
      propertyId,
      userId,
      permission,
      at: clock(),
    })
    return decision.allowed
  }
}
