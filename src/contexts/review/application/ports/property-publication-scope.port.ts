// Review context — Property publication scope port
//
// Google is asked to publish a reply only for an active Property, at the
// source epoch its Review was observed at: the provider authorizer refuses
// anything else. Composition wires this content-free lookup to the Property
// public API so reply commands can refuse up front (ADR-0001).

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type ReviewPropertyPublicationScope = Readonly<{
  /** The Property is in the workspace (not archived, suspended, or later). */
  active: boolean
  /** The Property's current Google binding generation. */
  sourceEpoch: number
}>

export type PropertyPublicationScopePort = Readonly<{
  /** Null when the Property does not exist in the Organization. */
  getPublicationScope: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReviewPropertyPublicationScope | null>
}>
