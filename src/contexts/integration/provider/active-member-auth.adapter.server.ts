import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member } from '#/shared/db/schema/auth'
import type { AuthContext } from '#/shared/domain/auth-context'
import { resolveMemberAuthContext } from '#/shared/auth/tenant-resolver'

export type ActiveMemberAuthResolver = (
  organizationId: string,
  userId: string,
) => Promise<AuthContext | null>

/**
 * Rebuild a delayed worker's current authorization from durable membership.
 * Session cookies are intentionally unavailable in the worker process.
 */
export const createActiveMemberAuthResolver = (
  db: Database,
): ActiveMemberAuthResolver => {
  return async (organizationId, userId) => {
    const [row] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1)
    if (!row) return null
    const resolved = await resolveMemberAuthContext({
      memberRole: row.role,
      organizationId,
      userId,
    })
    return resolved.context
  }
}
