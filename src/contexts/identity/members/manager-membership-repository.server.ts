import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db/index'
import { member } from '#/shared/db/schema/auth'
import { prepareMemberAuthContextsWithDatabase } from '#/shared/auth/tenant-resolver'
import { canForContext, scopeForPermission } from '#/shared/domain/permissions'
import type { ManagerMembership } from './auth-identity.port.server'

/** One manager's current Property scope, or null when their role grants none. */
export type ManagerPropertyAuthority = (
  input: Readonly<{
    userId: string
    memberRole: string
  }>,
) => ManagerMembership['propertyAccessScope'] | null

/**
 * Reads whatever one Organization's managers share (its permission version) once,
 * then answers per manager. A failed read rejects here, before any manager is judged.
 */
export type PrepareManagerPropertyAuthority = (
  organizationId: string,
) => Promise<ManagerPropertyAuthority>

/**
 * Tenant resolution decides each manager's authority; this reads the Organization's
 * permission version once and asks the same decision per manager.
 */
export const prepareManagerPropertyAuthority =
  (db: Database): PrepareManagerPropertyAuthority =>
  async (organizationId) => {
    const authorize = await prepareMemberAuthContextsWithDatabase(db, { organizationId })
    return ({ userId, memberRole }) => {
      const { context } = authorize({ userId, memberRole })
      if (!canForContext(context, 'property.read')) return null
      const scope = scopeForPermission(context, 'property.read')
      return scope === 'none' ? null : scope
    }
  }

const roleFromRaw = (role: string): ManagerMembership['role'] | null => {
  if (role === 'owner') return 'AccountAdmin'
  if (role === 'admin') return 'PropertyManager'
  return null
}

/** The member's raw Better Auth role for content-free policy diagnostics. */
export async function getMemberRole(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1)
  return rows[0]?.role ?? null
}

export const createManagerMembershipRepository = (
  db: Database,
  prepareAuthority: PrepareManagerPropertyAuthority,
) => ({
  isCurrentAccountAdmin: async (
    input: Readonly<{
      organizationId: string
      userId: string
    }>,
  ): Promise<boolean> => {
    const rows = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, input.organizationId),
          eq(member.userId, input.userId),
          eq(member.role, 'owner'),
        ),
      )
      .limit(1)
    return rows.length === 1
  },
  listActiveManagers: async (
    organizationId: string,
  ): Promise<readonly ManagerMembership[]> => {
    const rows = await db
      .select({ userId: member.userId, role: member.role })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          inArray(member.role, ['owner', 'admin']),
        ),
      )
    const managers = rows.flatMap((row) => {
      const role = roleFromRaw(row.role)
      return role ? [{ userId: row.userId, role, memberRole: row.role }] : []
    })
    // No manager to judge, no read: an empty Organization never touches its permission row.
    if (managers.length === 0) return []
    const authorityOf = await prepareAuthority(organizationId)
    return managers.flatMap(({ userId, role, memberRole }) => {
      const propertyAccessScope = authorityOf({ userId, memberRole })
      return propertyAccessScope ? [{ userId, role, propertyAccessScope } as const] : []
    })
  },
})
