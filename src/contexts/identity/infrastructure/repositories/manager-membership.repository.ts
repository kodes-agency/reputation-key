import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member } from '#/shared/db/schema/auth'
import type { ManagerMembership } from '../../application/public-api'

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

export const createManagerMembershipRepository = (
  db: Database,
  resolvePropertyAuthority: ManagerPropertyAuthorityResolver,
) => ({
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
