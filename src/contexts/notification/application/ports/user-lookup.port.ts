// Notification context — port for resolving user information from the identity context.
// Per architecture: type alias + Readonly<{…}>, no classes.

import type { UserId, OrganizationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

export type UserLookupPort = Readonly<{
  /** Find all user IDs in an org that hold the given domain role. */
  findByRole(orgId: OrganizationId, role: Role): Promise<readonly UserId[]>

  /** Find user IDs of managers (owner/admin) assigned to a property via staff_assignments. */
  findAssignedManagers(propertyId: string): Promise<readonly UserId[]>

  /** Get a user's email address. Returns null if not found. */
  getEmail(userId: UserId): Promise<string | null>

  /** Get a user's display name. Returns null if not found. */
  getName(userId: UserId): Promise<string | null>
}>
