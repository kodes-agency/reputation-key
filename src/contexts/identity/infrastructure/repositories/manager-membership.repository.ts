import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member } from '#/shared/db/schema/auth'
import type { ManagerMembership } from '../../application/ports/identity.port'

export type ManagerPropertyAuthorityResolver = (
  input: Readonly<{
    organizationId: string
    userId: string
    memberRole: string
  }>,
) => Promise<ManagerMembership['propertyAccessScope'] | null>

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
  resolvePropertyAuthority: ManagerPropertyAuthorityResolver,
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
    const resolved = await Promise.all(
      rows.map(async (row) => {
        const role = roleFromRaw(row.role)
        if (!role) return null
        const propertyAccessScope = await resolvePropertyAuthority({
          organizationId,
          userId: row.userId,
          memberRole: row.role,
        })
        return propertyAccessScope
          ? ({ userId: row.userId, role, propertyAccessScope } as const)
          : null
      }),
    )
    return resolved.filter(
      (membership): membership is ManagerMembership => membership !== null,
    )
  },
})
