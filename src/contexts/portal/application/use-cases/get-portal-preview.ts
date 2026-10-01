// Portal context — read the live preview of a Portal's guest page.
//
// Two sources: the draft (what the saved working copy would publish) and live
// (the verified version guests can open now). Read-only, gated by `portal.read`
// in the Portal's Property like the other editor reads, and it writes nothing:
// no session, no rating, no click is recorded for a preview.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyFactsPublicApi } from '#/contexts/property/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import { portalId } from '#/shared/domain/ids'
import { IMMERSIVE_HUB_SCHEMA_VERSION } from '../../domain/portal-publication-snapshot'
import { buildPortalLinktreeView } from '../../domain/portal-linktree-view'
import { loadPortalOrThrow } from '../load-accessible-portal'
import {
  buildDraftPortalPreview,
  buildLivePortalPreview,
  type PortalPreviewOutcome,
  type PortalPreviewSource,
} from '../portal-preview'
import type { PortalApprovedDestinationRepository } from '../ports/portal-approved-destination.repository'
import type { PortalExperienceRepository } from '../ports/portal-experience.repository'
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
  propertyFacts: Pick<PropertyFactsPublicApi, 'getPropertyTimezone'>
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

// The guest edge stops serving an address whose approval was last validated
// longer ago than this (two revalidation intervals). The preview applies the
// same cut-off, so a tile that has lapsed for guests is missing here too.
const APPROVAL_MAX_VALIDATION_AGE_MS = 30 * 60 * 1_000

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
      const urls =
        snapshot.configuration.schemaVersion === IMMERSIVE_HUB_SCHEMA_VERSION &&
        snapshot.configuration.linktree.enabled
          ? snapshot.configuration.links.map((link) => link.url)
          : []
      const approved =
        urls.length === 0
          ? []
          : await deps.destinationRepo.listApprovedUris(
              ctx.organizationId,
              portal.propertyId,
              urls,
              new Date(deps.clock().getTime() - APPROVAL_MAX_VALIDATION_AGE_MS),
            )
      return buildLivePortalPreview({ snapshot, approvedUris: new Set(approved) })
    }

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
    const linktree = buildPortalLinktreeView({
      portal,
      categories,
      links,
      texts,
      titles: overrides,
      destinations,
    })
    return {
      status: 'ready',
      preview: buildDraftPortalPreview({
        portal,
        linktree,
        profile: experience.profile,
        content: experience.content,
        overrides,
        timeZone: timeZone ?? 'UTC',
      }),
    }
  }

export type GetPortalPreview = ReturnType<typeof getPortalPreview>
