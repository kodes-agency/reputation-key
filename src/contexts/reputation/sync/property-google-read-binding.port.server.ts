// Review context — Property Google read-binding port
//
// A read of one review from Google authorizes against the Property's CURRENT
// binding. The connection and source epoch a Review row carries are from its
// last sync and can lag a reconnect or relink, which the provider authorizer
// then refuses. Composition wires this content-free lookup to the Property
// public API (ADR-0001).

import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'

export type ReviewPropertyGoogleReadBinding = Readonly<{
  /**
   * The Google connection to read through. Null unless the Property is
   * active and holds an active Google binding: there is nothing to read
   * through otherwise.
   */
  connectionId: GoogleConnectionId | null
  /** The Property's current binding generation. */
  sourceEpoch: number
}>

export type PropertyGoogleReadBindingPort = Readonly<{
  /** Null when the Property does not exist in the Organization. */
  getBinding: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReviewPropertyGoogleReadBinding | null>
}>
