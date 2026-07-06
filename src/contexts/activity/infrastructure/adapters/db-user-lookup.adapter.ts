// Activity context — DB-backed user lookup adapter for BullMQ worker
// The identity adapter (auth-identity.adapter) depends on HTTP request headers
// (better-auth session cookie). BullMQ workers have no HTTP context, so
// identityPort.getMember() always fails silently → FALLBACK_USER.
// This adapter queries the Better Auth `member` + `user` tables via Drizzle,
// bypassing the HTTP dependency entirely.

import type { UserLookupPort, UserInfo } from '../../ports/user-lookup.port'
import type { Database } from '#/shared/db'
import { toDomainRole, type Role } from '#/shared/domain/roles'
import { and, eq } from 'drizzle-orm'
import { member, user } from '#/shared/db/schema/auth'
import { activityError } from '../../domain/errors'

const FALLBACK_USER: UserInfo = Object.freeze({
  name: 'System',
  avatarUrl: null,
  role: 'Staff' as Role,
})

export const createDbUserLookupAdapter = (db: Database): UserLookupPort => ({
  lookup: async (uid: string, orgId: string): Promise<UserInfo> => {
    try {
      const rows = await db
        .select({
          role: member.role,
          name: user.name,
          image: user.image,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(and(eq(member.userId, uid), eq(member.organizationId, orgId)))
        .limit(1)
      const row = rows[0]
      if (!row) return FALLBACK_USER
      return {
        name: row.name ?? 'Unknown',
        avatarUrl: row.image ?? null,
        role: toDomainRole(row.role),
      }
    } catch (e) {
      // §13: surface DB failures as a typed error instead of returning the
      // FALLBACK_USER sentinel, which silently mis-attributes actions to a
      // Staff-shaped 'System' user during a DB outage. The caller
      // (insertActivityLog) catches this and decides whether to write the row
      // with system defaults — the not-found case (empty result) still returns
      // FALLBACK_USER above; only a thrown DB error reaches here.
      throw activityError('lookup_failed', 'User lookup failed', {
        userId: uid,
        orgId,
        cause: e instanceof Error ? e.message : String(e),
      })
    }
  },
})
