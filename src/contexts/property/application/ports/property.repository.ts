// Property context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { Property, PropertyId } from '../../domain/types'
import type { OrganizationId, GoogleConnectionId } from '#/shared/domain/ids'

export type PropertyRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PropertyId) => Promise<Property | null>
  findByIds: (
    orgId: OrganizationId,
    ids: ReadonlyArray<PropertyId>,
  ) => Promise<ReadonlyArray<Property>>
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
  /**
   * Every non-deleted Property that holds this Google location, in every
   * Organization, ordered by Organization then id. Cross-tenant on purpose and
   * only for the JWT-verified GBP webhook handler: a push names a location
   * before any tenant is known, and a location is unique only within an
   * Organization, so more than one Organization can hold it.
   */
  listByGbpLocationId: (gbpLocationId: string) => Promise<ReadonlyArray<Property>>

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

  /** Insert a property and return the full inserted row. */
  insertAndReturn: (orgId: OrganizationId, property: Property) => Promise<Property>
}>
