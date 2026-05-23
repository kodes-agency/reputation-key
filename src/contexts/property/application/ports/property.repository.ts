// Property context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { Property, PropertyId } from '../../domain/types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'

export type PropertyRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PropertyId) => Promise<Property | null>
  list: (orgId: OrganizationId) => Promise<ReadonlyArray<Property>>
  slugExists: (
    orgId: OrganizationId,
    slug: string,
    excludeId?: PropertyId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, property: Property) => Promise<void>
  update: (
    orgId: OrganizationId,
    id: PropertyId,
    patch: Readonly<Partial<Property>>,
  ) => Promise<void>
  hardDelete: (orgId: OrganizationId, id: PropertyId) => Promise<void>
  /** Find a non-deleted property by its Google Business Profile place ID. */
  findByGbpPlaceId: (gbpPlaceId: string) => Promise<Property | null>
  /** Find IDs of non-deleted properties linked to a Google connection within an org. */
  findIdsByGoogleConnection: (
    connectionId: GoogleConnectionId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<PropertyId>>
  /** Null out googleConnectionId for properties matching the given connection within an org. */
  clearGoogleConnectionRef: (
    orgId: OrganizationId,
    propertyIds: ReadonlyArray<PropertyId>,
  ) => Promise<void>

  /**
   * Insert a property and return the full inserted row.
   * Used by importProperty on the public API for GBP bulk import.
   * Throws on unique-constraint violations — the caller maps them to PropertyImportConflict.
   */
  insertAndReturn: (orgId: OrganizationId, property: Property) => Promise<Property>

  /** Find existing non-deleted property gbpPlaceIds for the given organization. */
  findExistingGbpPlaceIds: (
    orgId: OrganizationId,
    gbpPlaceIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<string>>

  /** Check if a non-deleted property with this gbpPlaceId exists in the org. */
  existsByGbpPlaceId: (orgId: OrganizationId, gbpPlaceId: string) => Promise<boolean>
}>
