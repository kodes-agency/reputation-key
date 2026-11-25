// Review context — Property publication scope port
//
// Google is asked to publish a reply only for an active Property, at the
// source epoch its Review was observed at: the provider authorizer refuses
// anything else. Composition wires this content-free lookup to the Property
// public API so reply commands can refuse up front, in words that match the
// Property's actual state (ADR-0001).

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * The Property's lifecycle as reply publication sees it:
 * - `active` — in the workspace; replies may be published.
 * - `suspended` — its Organization is being closed.
 * - `archived` — removed, and restorable from the Removed list.
 * - `removing` — past the recovery window, on its way to deletion.
 */
export type ReviewPropertyPublicationLifecycle =
  'active' | 'suspended' | 'archived' | 'removing'

export type ReviewPropertyPublicationScope = Readonly<{
  lifecycle: ReviewPropertyPublicationLifecycle
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
