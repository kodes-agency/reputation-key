// Database adapter for the UserLookupPort
// Queries better-auth tables (member, user) and staff_assignments via Drizzle.
// Uses the read-only Drizzle definitions from auth.ts for type-safe column refs.
import type { Database } from '#/shared/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { member, user } from '#/shared/db/schema/auth'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import { userId, type UserId, type OrganizationId, unbrand } from '#/shared/domain/ids'
import { toBetterAuthRole, type Role } from '#/shared/domain/roles'

export function createDbUserLookupAdapter(db: Database) {
  return {
    /** Find all user IDs in an org that hold the given domain role. */
    async findByRole(orgId: OrganizationId, role: Role): Promise<UserId[]> {
      const betterAuthRole = toBetterAuthRole(role)
      const rows = await db
        .select({ userId: member.userId })
        .from(member)
        .where(
          and(eq(member.organizationId, unbrand(orgId)), eq(member.role, betterAuthRole)),
        )
      return rows.map((r) => userId(r.userId))
    },

    /** Find user IDs of managers (owner/admin) assigned to a property via staff_assignments. */
    async findAssignedManagers(
      orgId: OrganizationId,
      propertyId: string,
    ): Promise<UserId[]> {
      const rows = await db
        .select({ userId: staffAssignments.userId })
        .from(staffAssignments)
        .innerJoin(
          member,
          and(
            eq(member.userId, staffAssignments.userId),
            eq(member.organizationId, staffAssignments.organizationId),
          ),
        )
        .where(
          and(
            eq(staffAssignments.organizationId, unbrand(orgId)),
            eq(staffAssignments.propertyId, propertyId),
            isNull(staffAssignments.deletedAt),
            inArray(member.role, ['owner', 'admin']),
          ),
        )
      return rows.map((r) => userId(r.userId))
    },

    /** Get a user's email address. Returns null if not found. */
    async getEmail(uid: UserId): Promise<string | null> {
      const rows = await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, unbrand(uid)))
        .limit(1)
      return rows[0]?.email ?? null
    },

    /** Get a user's display name. Returns null if not found. */
    async getName(uid: UserId): Promise<string | null> {
      const rows = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, unbrand(uid)))
        .limit(1)
      return rows[0]?.name ?? null
    },
  }
}
