// Database adapter for the UserLookupPort
// Queries better-auth tables (member, user) and the legacy `staff_assignments`
// table. Access granted through the authoritative `property_access_grant`
// model is resolved by an injected identity-owned lookup — this context never
// reads the grant table directly (identity owns it).
import type { Database } from '#/shared/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { member, user } from '#/shared/db/schema/auth'
import { staffAssignments } from '#/shared/db/schema/staff-assignment.schema'
import { userId, type UserId, type OrganizationId, unbrand } from '#/shared/domain/ids'
import { toBetterAuthRole, type Role } from '#/shared/domain/roles'

/** Identity-owned lookup: users holding active access to one property. */
export type PropertyAccessHolderLookup = (
  organizationId: string,
  propertyId: string,
) => Promise<ReadonlyArray<string>>

// Recipients of property-scoped notifications: AccountAdmins, PropertyManagers,
// AND Staff (root CONTEXT.md: "property managers AND staff"). Derived from the
// canonical Role union via toBetterAuthRole() so it tracks role changes.
const PROPERTY_NOTIFY_ROLES = (['AccountAdmin', 'PropertyManager', 'Staff'] as const).map(
  toBetterAuthRole,
)

export const createDbUserLookupAdapter = (
  db: Database,
  /**
   * Identity-owned grant-holder lookup. Required: `property_access_grant` is the
   * authoritative access model, so a caller without it resolves zero
   * property-scoped recipients and silently drops every such notification.
   */
  propertyAccessHolders: PropertyAccessHolderLookup,
) => {
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

    /**
     * Property-scoped recipients (managers AND staff).
     *
     * `property_access_grant` is the authoritative access model (BQC-2.3); the
     * invitation lifecycle no longer writes the legacy `staff_assignments`
     * table, so reading only that table resolved zero recipients and silently
     * dropped every property-scoped notification. Legacy rows are still
     * unioned in for organizations that have not been reconciled yet.
     */
    async findAssignedManagers(
      orgId: OrganizationId,
      propertyId: string,
    ): Promise<UserId[]> {
      const [grantHolders, legacy] = await Promise.all([
        propertyAccessHolders(unbrand(orgId), propertyId),
        db
          .selectDistinct({ userId: staffAssignments.userId })
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
              inArray(member.role, PROPERTY_NOTIFY_ROLES),
            ),
          ),
      ])
      const candidates = [...new Set([...grantHolders, ...legacy.map((r) => r.userId)])]
      if (candidates.length === 0) return []
      // Grant holders still have to be current members holding a notifiable
      // role, so membership stays the single source for role checks.
      const notifiable = await db
        .selectDistinct({ userId: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, unbrand(orgId)),
            inArray(member.userId, candidates),
            inArray(member.role, PROPERTY_NOTIFY_ROLES),
          ),
        )
      return notifiable
        .map((r) => r.userId)
        .sort()
        .map((id) => userId(id))
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
