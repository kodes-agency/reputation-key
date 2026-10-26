// Portal context — a Portal's own look (ADR 0070): the `portal_look_overrides`
// row of each Portal that has one. A Portal with no row follows the whole
// Property look. Every method names the Organization; every statement is also
// held to the Property, so a row can only ever be read or made for a Portal of
// that Property.

import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type {
  PortalLookChange,
  PortalLookFacet,
  PortalLookOverride,
  PortalLookSources,
} from '../../domain/portal-look'

/** A Portal named with the Property it belongs to, so a read is held to both. */
export type PortalOfProperty = Readonly<{ propertyId: PropertyId; portalId: PortalId }>

/** Where one Portal's look groups come from, for a Portal that has a row. */
export type PortalLookSourcesRow = Readonly<{
  portalId: PortalId
  sources: PortalLookSources
}>

export type SavePortalLookPartInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** One group's next state, its values already checked by the use case. */
  change: PortalLookChange
  /** Recorded in the page-edit ledger and as who last saved the row. */
  actorUserId: UserId
  at: Date
}>

export type SavePortalLookPartResult =
  | Readonly<{
      status: 'saved'
      /** The row as it now stands, at the Portal's effective look version. */
      override: PortalLookOverride
      /** What guests would see differently once published; empty when nothing visible moved. */
      changedFacets: readonly PortalLookFacet[]
    }>
  /** The Property has no Brand Profile: a Portal cannot own part of a look that does not exist. */
  | Readonly<{ status: 'brand_profile_missing' }>
  /** The Portal is gone, deleted, or not of this Property. */
  | Readonly<{ status: 'portal_not_found' }>
  /** The Portal was archived after the caller checked it; seen under its row lock. */
  | Readonly<{ status: 'portal_archived' }>

export type PortalLookRepository = Readonly<{
  /** The Portal's override, or null when it follows the whole Property look. */
  findForPortal: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
  ) => Promise<PortalLookOverride | null>
  /**
   * Where each named Portal's groups come from, for the Portals that have a row;
   * a Portal left out follows the whole Property look (`PROPERTY_LOOK_SOURCES`).
   * One read for the whole set, which may span Properties (the Organization
   * overview); a row is returned only for the Property its Portal was named with.
   */
  listSourcesForPortals: (
    organizationId: OrganizationId,
    portals: readonly PortalOfProperty[],
  ) => Promise<readonly PortalLookSourcesRow[]>
  /**
   * The Property's Portals that are neither archived nor deleted, this one
   * included: the own-look controls appear once there are two.
   */
  countLivePortals: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<number>
  /**
   * Save one group of a Portal's own look, in one transaction: the Property's
   * publication lock, then the Portal row (the order publish takes them), then
   * the Brand Profile and the current row. The next row is decided by
   * `nextPortalLook` from what guests see before and after. When nothing
   * visible moved only the modes and values are written. Otherwise the row
   * moves to the next effective look version and each changed facet is
   * recorded under `portal_configuration` as `look:<facet>` (ledger and fence,
   * source version `look:v<n>`) through `recordPortalContentChange`.
   */
  savePortalLookPart: (
    input: SavePortalLookPartInput,
  ) => Promise<SavePortalLookPartResult>
}>
