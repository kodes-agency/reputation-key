// Inbox context — property lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PropertyLookupPort = Readonly<{
  getPropertyNameById(
    propertyId: PropertyId,
    orgId: OrganizationId,
  ): Promise<string | null>
  getPropertyNamesByIds(
    propertyIds: ReadonlyArray<PropertyId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, string | null>>
}>
