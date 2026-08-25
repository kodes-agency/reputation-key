import type { TrackReviewLinkClick } from './track-review-link-click'
import {
  organizationId,
  portalId,
  propertyId,
  type PortalLinkId,
} from '#/shared/domain/ids'
import type { PublicPortalLookup } from '../ports/public-portal-lookup.port'

export type ResolveLinkAndTrackInput = Readonly<{
  token: string
  linkId: PortalLinkId
  /** Request-edge qualifier; a denial suppresses analytics, never navigation. */
  qualifyObservation?: (scope: ResolvedLinkObservationScope) => Promise<boolean>
}>

export type ResolvedLinkObservationScope = Readonly<{
  linkId: PortalLinkId
  organizationId: string
  portalId: string
  propertyId: string
}>

export type ResolveLinkAndTrackDeps = Readonly<{
  publicPortalLookup: PublicPortalLookup
  trackClick: TrackReviewLinkClick
  reportObservationFailure?: (error: unknown) => void
}>

export type ResolveLinkAndTrackResult = Readonly<{
  url: string
}> | null

export const resolveLinkAndTrack =
  (deps: ResolveLinkAndTrackDeps) =>
  async (input: ResolveLinkAndTrackInput): Promise<ResolveLinkAndTrackResult> => {
    // Token resolution performs the public ExecutionPolicy decision and returns
    // only the authoritative organization/property/Portal scope. A link ID can
    // never widen that scope: it must be present in this token's published data.
    const portal = await deps.publicPortalLookup.findByToken(input.token)
    if (!portal) return null

    const link = portal.links.find((candidate) => candidate.id === input.linkId)
    if (!link) return null

    const observation = {
      linkId: input.linkId,
      organizationId: organizationId(portal.organizationId),
      portalId: portalId(portal.portal.id),
      propertyId: propertyId(portal.propertyId),
    }
    let qualified: boolean
    try {
      qualified = input.qualifyObservation
        ? await input.qualifyObservation(observation)
        : true
    } catch (error) {
      qualified = false
      deps.reportObservationFailure?.(error)
    }
    if (qualified) {
      await deps.trackClick(observation)
    }

    return { url: link.url }
  }
