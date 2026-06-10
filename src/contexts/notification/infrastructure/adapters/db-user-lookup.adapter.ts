// Database adapter for the UserLookupPort
// Queries better-auth tables (member, user) and staff_assignments via raw SQL.
// Better-auth tables are not in the Drizzle schema, so we use db.execute(sql`...`).
import type { Database } from '#/shared/db'
import { sql } from 'drizzle-orm'
import { userId, type UserId, type OrganizationId, unbrand } from '#/shared/domain/ids'
import { toBetterAuthRole, type Role } from '#/shared/domain/roles'

export function createDbUserLookupAdapter(db: Database) {
  return {
    /** Find all user IDs in an org that hold the given domain role. */
    async findByRole(orgId: OrganizationId, role: Role): Promise<UserId[]> {
      const betterAuthRole = toBetterAuthRole(role)
      const result = await db.execute(sql`
        SELECT m.user_id
        FROM member m
        WHERE m.organization_id = ${unbrand(orgId)}
          AND m.role = ${betterAuthRole}
      `)
      return (result.rows as Record<string, unknown>[]).map((r) =>
        userId(r.user_id as string),
      )
    },

    /** Find user IDs of managers (owner/admin) assigned to a property via staff_assignments. */
    async findAssignedManagers(propertyId: string): Promise<UserId[]> {
      const result = await db.execute(sql`
        SELECT sa.user_id
        FROM staff_assignments sa
        JOIN member m
          ON m.user_id = sa.user_id
          AND m.organization_id = sa.organization_id
        WHERE sa.property_id = ${propertyId}
          AND sa.deleted_at IS NULL
          AND m.role IN ('owner', 'admin')
      `)
      return (result.rows as Record<string, unknown>[]).map((r) =>
        userId(r.user_id as string),
      )
    },

    /** Get a user's email address. Returns null if not found. */
    async getEmail(uid: UserId): Promise<string | null> {
      const result = await db.execute(sql`
        SELECT email FROM "user" WHERE id = ${unbrand(uid)}
      `)
      const row = (result.rows as Record<string, unknown>[])[0]
      return (row?.email as string) ?? null
    },

    /** Get a user's display name. Returns null if not found. */
    async getName(uid: UserId): Promise<string | null> {
      const result = await db.execute(sql`
        SELECT name FROM "user" WHERE id = ${unbrand(uid)}
      `)
      const row = (result.rows as Record<string, unknown>[])[0]
      return (row?.name as string) ?? null
    },
  }
}
