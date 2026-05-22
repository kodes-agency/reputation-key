// Guest context — resolve a portal link by ID and track the click.
// Replaces the direct DB access in the server function with proper use case + port pattern.

import type { LinkResolverPort } from '#/contexts/portal/application/public-api'
import type { TrackReviewLinkClick } from './track-review-link-click'
import type { PortalLinkId } from '#/shared/domain/ids'

export type ResolveLinkAndTrackDeps = Readonly<{
  linkResolver: LinkResolverPort
  trackClick: TrackReviewLinkClick
}>

export type ResolveLinkAndTrackResult = Readonly<{
  url: string
}> | null

export const resolveLinkAndTrack =
  (deps: ResolveLinkAndTrackDeps) =>
  async (input: { linkId: PortalLinkId }): Promise<ResolveLinkAndTrackResult> => {
    const resolved = await deps.linkResolver.resolveLinkById(input.linkId)
    if (!resolved) {
      return null
    }

    await deps.trackClick({
      linkId: input.linkId,
      organizationId: resolved.organizationId,
      portalId: resolved.portalId,
      propertyId: resolved.propertyId,
    })

    return { url: resolved.url }
  }

export type ResolveLinkAndTrack = ReturnType<typeof resolveLinkAndTrack>
