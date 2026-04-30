// Staff context — public API surface for cross-context consumers.
// Other contexts (property, team) consume this typed interface
// to query staff assignment data. Per ADR-0001.

import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'

export type StaffPublicApi = Readonly<{
  /**
   * Get property IDs accessible to a user based on their role and assignments.
   * Returns null for AccountAdmin (meaning "all properties in org").
   * Returns specific IDs for PropertyManager/Staff (from staff_assignments).
   */
  getAccessiblePropertyIds: (
    orgId: OrganizationId,
    userId: UserId,
    role: Role,
  ) => Promise<ReadonlyArray<PropertyId> | null>
}>
