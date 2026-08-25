// Database adapter for the UserLookupPort
// Queries Better Auth identity tables only. Scoped notification responsibility
// is supplied through the Property/Portal public APIs, never inferred here
// from access grants or Staff attribution.
import type { Database } from '#/shared/db'
import { and, eq } from 'drizzle-orm'
import { member, user } from '#/shared/db/schema/auth'
import { userId, type UserId, type OrganizationId, unbrand } from '#/shared/domain/ids'
import { toBetterAuthRole, toDomainRole, type Role } from '#/shared/domain/roles'
import type { NotificationActorRole } from '../../domain/notification-payload'

/** Domain role -> the payload's actor role vocabulary (ADR 0046 r.8: role, never name). */
const ACTOR_ROLE_BY_ROLE: Readonly<Record<Role, NotificationActorRole>> = {
  AccountAdmin: 'account_admin',
  PropertyManager: 'property_manager',
  Staff: 'staff',
}

export const createDbUserLookupAdapter = (db: Database) => {
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

    /**
     * The acting user's role, for `payload.actorRole`. Multi-role and custom
     * better-auth roles map to null via `toDomainRole` rather than throwing —
     * an unrecognised role must cost the sentence its "A property manager"
     * clause, never the whole notification.
     */
    async findActorRole(
      uid: UserId,
      orgId: OrganizationId,
    ): Promise<NotificationActorRole | null> {
      const rows = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(eq(member.organizationId, unbrand(orgId)), eq(member.userId, unbrand(uid))),
        )
        .limit(1)
      const raw = rows[0]?.role
      if (raw === undefined) return null
      const role = toDomainRole(raw)
      return role === null ? null : ACTOR_ROLE_BY_ROLE[role]
    },
  }
}
