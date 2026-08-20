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
  /** Cross-tenant only for the JWT-verified GBP webhook handler. */
  findByGbpLocationId: (
    gbpLocationId: string,
    orgId?: OrganizationId,
  ) => Promise<Property | null>

  /** Find a non-deleted property by its slug (public-facing, no orgId). */
  findBySlug: (slug: string) => Promise<Property | null>
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
