// Property context — public API surface for cross-context consumers.
// Other contexts (team, portal) consume this typed interface
// to query property data. Per ADR-0001.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type PropertyPublicApi = Readonly<{
  /**
   * Check whether a property exists within an organization.
   */
  propertyExists: (orgId: OrganizationId, propertyId: PropertyId) => Promise<boolean>
}>
