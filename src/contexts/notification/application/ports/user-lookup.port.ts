// Notification context — port for resolving user information from the identity context.
// Per architecture: type alias + Readonly<{…}>, no classes.

import type { UserId, OrganizationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { NotificationActorRole } from '../../domain/notification-payload'

export type UserLookupPort = Readonly<{
  /** Find all user IDs in an org that hold the given domain role. */
  findByRole(orgId: OrganizationId, role: Role): Promise<readonly UserId[]>

  /** Get a user's email address. Returns null if not found. */
  getEmail(userId: UserId): Promise<string | null>

  /** Get a user's display name. Returns null if not found. */
  getName(userId: UserId): Promise<string | null>

  /**
   * The acting user's ROLE, for `payload.actorRole` — ADR 0046 r.8 excludes
   * other employees' data, so copy says "A property manager assigned this to
   * you", never a name. Null when the user is not a member of the org or holds
   * a non-built-in role.
   */
  findActorRole(
    userId: UserId,
    orgId: OrganizationId,
  ): Promise<NotificationActorRole | null>
}>
