// Inbox context — property lookup adapter
// Implements PropertyLookupPort by delegating to the Property context's public API.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.

import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * Minimal structural type — only what we need from the property public API.
 * Avoids importing the full PropertyPublicApi type from another context.
 */
type GetPropertyName = (
  orgId: OrganizationId,
  propertyId: PropertyId,
) => Promise<string | null>

type GetPropertyNames = (
  orgId: OrganizationId,
  propertyIds: ReadonlyArray<PropertyId>,
) => Promise<ReadonlyArray<{ id: string; name: string | null }>>

export const createPropertyLookupAdapter = (deps: {
  getPropertyName: GetPropertyName
  getPropertyNames: GetPropertyNames
}): PropertyLookupPort => ({
  getPropertyNameById: (pid, orgId) => deps.getPropertyName(orgId, pid),

  getPropertyNamesByIds: async (propertyIds, orgId) => {
    const map = new Map<string, string | null>()
    if (propertyIds.length === 0) return map
    const rows = await deps.getPropertyNames(orgId, propertyIds)
    for (const r of rows) {
      map.set(r.id, r.name)
    }
    return map
  },
})
