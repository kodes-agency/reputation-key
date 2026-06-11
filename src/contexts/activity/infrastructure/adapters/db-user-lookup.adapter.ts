// Activity context — DB-backed user lookup adapter for BullMQ worker
// The identity adapter (auth-identity.adapter) depends on HTTP request headers
// (better-auth session cookie). BullMQ workers have no HTTP context, so
// identityPort.getMember() always fails silently → FALLBACK_USER.
// This adapter queries the Better Auth `member` table directly via raw SQL,
// bypassing the HTTP dependency entirely.

import type { UserLookupPort, UserInfo } from '../../ports/user-lookup.port'
import type { Database } from '#/shared/db'
import type { Role } from '#/shared/domain/roles'
import { sql } from 'drizzle-orm'
import { getLogger } from '#/shared/observability/logger'

const VALID_ROLES = new Set<string>(['Owner', 'Admin', 'PropertyManager', 'Staff'])

const FALLBACK_USER: UserInfo = Object.freeze({
  name: 'System',
  avatarUrl: null,
  role: 'Staff' as Role,
})

function validateRole(raw: unknown): Role {
  if (typeof raw === 'string' && VALID_ROLES.has(raw)) return raw as Role
  return 'Staff' as Role
}

export const createDbUserLookupAdapter = (db: Database): UserLookupPort => ({
  lookup: async (userId: string, orgId: string): Promise<UserInfo> => {
    try {
      // Query the Better Auth managed `member` table directly.
      // Columns: id, organization_id, user_id, role, created_at.
      // User name/image lives in the `user` table — join to get it.
      const rows = await db.execute(sql`
        SELECT m.role, u.name, u.image
        FROM member m
        JOIN "user" u ON u.id = m.user_id
        WHERE m.user_id = ${userId} AND m.organization_id = ${orgId}
        LIMIT 1
      `)
      const row = rows.rows?.[0]
      if (!row) return FALLBACK_USER
      return {
        name: ((row as Record<string, unknown>).name as string) ?? 'Unknown',
        avatarUrl: ((row as Record<string, unknown>).image as string) ?? null,
        role: validateRole((row as Record<string, unknown>).role),
      }
    } catch (e) {
      getLogger().warn(
        { err: e, userId, orgId },
        'DB user lookup failed, returning fallback user',
      )
      return FALLBACK_USER
    }
  },
})
