// Property access port — bridges staff and property contexts.
// Moved to shared/domain because it's a pure type (no I/O, no framework) consumed
// by the property context's listProperties use case but implemented via staff
// assignment data. Cross-context interface types that bridge two contexts belong here.
//
// Per conventions: "shared/ holds cross-cutting concerns used by multiple contexts."
// This port is used by exactly two contexts (property reads it, staff implements it),
// so it meets the "second importer" bar.

import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Role } from './roles'

export type PropertyAccessProvider = Readonly<{
  /**
   * Get property IDs accessible to a user.
   * Returns null for AccountAdmin (meaning "all properties in org").
   * Returns specific IDs for PropertyManager/Staff (from staff_assignments).
   */
  getAccessiblePropertyIds: (
    orgId: OrganizationId,
    userId: UserId,
    role: Role,
  ) => Promise<ReadonlyArray<PropertyId> | null>
}>
