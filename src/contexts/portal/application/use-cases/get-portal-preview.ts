// Portal context — read the live preview of a Portal's guest page.
//
// Two sources: the draft (what the saved working copy would publish) and live
// (the active, verified version). Read-only, gated by `portal.read` in the
// Portal's Property like the other editor reads, and it writes nothing: no
// session, no rating, no click is recorded for a preview.
//
// Live applies the guest edge's approval cut-off to the addresses, but not its
// other admission facts (Portal Health, the Property's status, the public-read
// decision): the page shown is the version guests are served when the Portal
// is open to them, and says nothing about whether it is open. A snapshot that
// fails verification when it is read is treated as absent (`not_published`),
// as the repository returns it.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { buildPortalLinktreeView } from '../../domain/portal-linktree-view'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  buildDraftPortalPreview,
  buildLivePortalPreview,
  type PortalPreviewOutcome,
  type PortalPreviewSource,
} from '../portal-preview'
import { readPublishedPreviewInputs } from '../published-preview-inputs'
import { resolvePropertyLookMedia } from '../property-look-media'
import { listServableTileImageIds } from '../servable-tile-images'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { PortalLinkRepository } from '../ports/portal-link.repository'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { PortalRepository } from '../ports/portal.repository'

export type GetPortalPreviewInput = Readonly<{
  portalId: string
  source: PortalPreviewSource
}>

export type GetPortalPreviewDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  experienceRepo: Pick<
    PortalExperienceRepository,
    'getPropertyExperience' | 'listPortalOverrides'
  >
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'list' | 'listApprovedUris'>
  publicationRepo: Pick<PortalPublicationRepository, 'findActiveForPortal'>
  /**
   * Which images may still be served: a taken-down one is not shown, as the
   * tile's photo, the Property's photograph or its logo.
   */
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds' | 'findById'>
  propertyFacts: Pick<PropertyFactsPublicApi, 'getPropertyTimezone'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export const getPortalPreview =
  (deps: GetPortalPreviewDeps) =>
  async (
    input: GetPortalPreviewInput,
    ctx: AuthContext,
  ): Promise<PortalPreviewOutcome> => {
    const portal = await loadPortalOrThrow(deps, ctx, portalId(input.portalId), {
      permission: 'portal.read',
      forbiddenMessage: 'Insufficient permissions to preview this Portal',
    })
    if (input.source === 'live') {
      const snapshot = await deps.publicationRepo.findActiveForPortal(
        ctx.organizationId,
        portal.id,
      )
      if (!snapshot) {
        return { status: 'unavailable', source: 'live', reason: 'not_published' }
      }
      const { approvedUris, mediaUrls } = await readPublishedPreviewInputs(
        deps,
        { organizationId: ctx.organizationId, propertyId: portal.propertyId },
        snapshot,
      )
      return buildLivePortalPreview({
        snapshot,
        approvedUris,
        mediaUrls,
      })
    }

    // fallow-ignore-next-line code-duplication
    const [categories, links, texts, experience, overrides, destinations, timeZone] =
      await Promise.all([
        deps.portalLinkRepo.listCategories(ctx.organizationId, portal.id),
        deps.portalLinkRepo.listAllLinks(ctx.organizationId, portal.id),
        deps.portalLinkRepo.listLinkTexts(
          ctx.organizationId,
          portal.id,
          portal.primaryGuestLocale,
        ),
        deps.experienceRepo.getPropertyExperience(ctx.organizationId, portal.propertyId),
        deps.experienceRepo.listPortalOverrides(
          ctx.organizationId,
          portal.propertyId,
          portal.id,
        ),
        deps.destinationRepo.list(ctx.organizationId, portal.propertyId),
        deps.propertyFacts.getPropertyTimezone(ctx.organizationId, portal.propertyId),
      ])
    const [servable, media] = await Promise.all([
      listServableTileImageIds(
        deps.mediaRepo,
        ctx.organizationId,
        portal.propertyId,
        links,
      ),
      resolvePropertyLookMedia(
        deps,
        ctx.organizationId,
        portal.propertyId,
        experience.profile,
      ),
    ])
    const linktree = buildPortalLinktreeView({
      portal,
      categories,
      links,
      texts,
      titles: overrides,
      destinations,
      servableImageIds: servable,
    })
    return {
      status: 'ready',
      preview: buildDraftPortalPreview({
        portal,
        linktree,
        profile: experience.profile,
        media,
        content: experience.content,
        overrides,
        timeZone: timeZone ?? 'UTC',
      }),
    }
  }

export type GetPortalPreview = ReturnType<typeof getPortalPreview>
