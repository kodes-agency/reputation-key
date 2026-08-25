import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member } from '#/shared/db/schema/auth'
import type { ManagerMembership } from '../../application/public-api'

const roleFromRaw = (role: string): ManagerMembership['role'] | null => {
  if (role === 'owner') return 'AccountAdmin'
  if (role === 'admin') return 'PropertyManager'
  return null
}

export const createManagerMembershipRepository = (db: Database) => ({
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
    return rows.flatMap((row) => {
      const role = roleFromRaw(row.role)
      return role ? [{ userId: row.userId, role }] : []
    })
  },
})
