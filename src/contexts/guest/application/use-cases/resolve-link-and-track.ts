import type { TrackReviewLinkClick } from './track-review-link-click'
import {
  organizationId,
  portalId,
  propertyId,
  type PortalLinkId,
} from '#/shared/domain/ids'
import type { PublicPortalLookup } from '../ports/public-portal-lookup.port'
import type { GuestObservationLossReporter } from '../ports/guest-observation-loss-monitor.port'

export type ResolveLinkAndTrackInput = Readonly<{
  token: string
  linkId: PortalLinkId
  /**
   * Explicit POST-edge qualification. Its absence is the navigation-only GET
   * path and must never increment product analytics.
   */
  qualifyObservation?: (
    scope: ResolvedLinkObservationScope,
  ) => Promise<ResolvedLinkObservationSession | null>
}>

export type ResolvedLinkObservationScope = Readonly<{
  linkId: PortalLinkId
  organizationId: string
  portalId: string
  propertyId: string
}>

export type ResolvedLinkObservationSession = Readonly<{
  sessionId: string
  sessionExpiresAt: Date
}>

export type ResolveLinkAndTrackDeps = Readonly<{
  publicPortalLookup: PublicPortalLookup
  trackClick: TrackReviewLinkClick
  reportObservationLoss?: GuestObservationLossReporter
}>

export type ResolveLinkAndTrackResult = Readonly<{
  url: string
}> | null

export const resolveLinkAndTrack =
  (deps: ResolveLinkAndTrackDeps) =>
  async (input: ResolveLinkAndTrackInput): Promise<ResolveLinkAndTrackResult> => {
    const reportLoss = async () => {
      try {
        await deps.reportObservationLoss?.('review_link')
      } catch {
        // Navigation has already been approved; monitoring stays fail-open.
      }
    }
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
    let qualified: ResolvedLinkObservationSession | null
    try {
      qualified = input.qualifyObservation
        ? await input.qualifyObservation(observation)
        : null
    } catch {
      qualified = null
      await reportLoss()
    }
    if (qualified) {
      try {
        await deps.trackClick({
          ...observation,
          ...qualified,
          destinationKind: 'secondary_link',
        })
      } catch {
        await reportLoss()
      }
    }

    return { url: link.url }
  }
