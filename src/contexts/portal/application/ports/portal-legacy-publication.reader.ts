// Portal context — the live Portals still on a v1 or v2 page.
//
// The one question the bulk republish asks of storage: which Portals are
// Published right now with a live version older than the Immersive Hub design
// (snapshot schema 1 or 2)? A Portal that is draft-only, disabled, archived or
// deleted has no live version and never appears, however old its last snapshot.

import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type LegacyLivePortal = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** The live version's number: what the republish replaces. */
  liveVersion: number
  /** The design the live version was written with. */
  liveSchemaVersion: 1 | 2
}>

export type ListLiveLegacyPortalsInput = Readonly<{
  organizationId: OrganizationId
  /** Narrow to one Property; absent means every Property of the organisation. */
  propertyId?: PropertyId
  /** Keyset cursor: only Portals whose id sorts after this one. */
  afterPortalId: PortalId | null
  limit: number
}>

export type PortalLegacyPublicationReader = Readonly<{
  /** Ordered by Portal id, so a caller can page through with the last id it saw. */
  listLiveLegacyPortals: (
    input: ListLiveLegacyPortalsInput,
  ) => Promise<ReadonlyArray<LegacyLivePortal>>
}>
