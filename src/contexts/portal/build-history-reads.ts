// Portal context — the publication, History and review reads' wiring.
//
// Split out of build.ts so the context build stays under its file-length
// ratchet: the publication history, the merged History, the versions rail, one
// version, and Review & publish are wired here from the repositories
// buildPortalContext already made.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  PropertyGoogleReviewDestinationPublicApi,
  PropertyLifecyclePublicApi,
} from '#/contexts/property/application/public-api'
import type { PortalRepository } from './publication/portal-repository.port.server'
import type { PortalLinkRepository } from './links/portal-link-repository.port.server'
import type { PortalExperienceRepository } from './editor/portal-experience-repository.port.server'
import type { PortalPublicationRepository } from './publication/portal-publication-repository.port.server'
import type { PortalHistoryRepository } from './workspace/portal-history-repository.port.server'
import type { PortalHealthRepository } from './health/portal-health-repository.port.server'
import type { PortalActorDirectory } from './workspace/portal-actor-directory.port.server'
import type { PortalTokenRepository } from './addresses/portal-token-repository.port.server'
import type { PortalApprovedDestinationRepository } from './destinations/portal-approved-destination-repository.port.server'
import type { PortalMediaAssetRepository } from './media/portal-media-asset-repository.port.server'
import { getPortalPublicationHistory } from './workspace/get-portal-publication-history.server'
import { getPortalHistory } from './workspace/get-portal-history.server'
import { getPortalVersions } from './workspace/get-portal-versions.server'
import { getPortalVersion } from './workspace/get-portal-version.server'
import { getPortalVersionPreview } from './preview/get-portal-version-preview.server'
import { getPortalReview } from './publication/get-portal-review.server'

export type PortalHistoryReadDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  experienceRepo: PortalExperienceRepository
  publicationRepo: PortalPublicationRepository
  historyRepo: PortalHistoryRepository
  healthRepo: PortalHealthRepository
  actorDirectory: PortalActorDirectory
  portalTokenRepo: PortalTokenRepository
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'listApprovedUris'>
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds'>
  propertyApi: PropertyGoogleReviewDestinationPublicApi & PropertyLifecyclePublicApi
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>

export function buildPortalHistoryReads(deps: PortalHistoryReadDeps) {
  const { portalRepo, publicationRepo, historyRepo, actorDirectory, staffPublicApi } =
    deps
  return {
    getPortalPublicationHistory: getPortalPublicationHistory({
      portalRepo,
      publicationRepo,
      staffPublicApi,
      actorDirectory,
    }),
    getPortalHistory: getPortalHistory({
      portalRepo,
      staffPublicApi,
      historyRepo,
      healthRepo: deps.healthRepo,
      actorDirectory,
    }),
    getPortalVersions: getPortalVersions({
      portalRepo,
      staffPublicApi,
      historyRepo,
      publicationRepo,
      actorDirectory,
    }),
    getPortalVersion: getPortalVersion({
      portalRepo,
      staffPublicApi,
      publicationRepo,
      actorDirectory,
    }),
    getPortalVersionPreview: getPortalVersionPreview({
      portalRepo,
      staffPublicApi,
      publicationRepo,
      destinationRepo: deps.destinationRepo,
      mediaRepo: deps.mediaRepo,
      clock: deps.clock,
    }),
    getPortalReview: getPortalReview({
      portalRepo,
      portalLinkRepo: deps.portalLinkRepo,
      experienceRepo: deps.experienceRepo,
      publicationRepo,
      historyRepo,
      actorDirectory,
      portalTokenRepo: deps.portalTokenRepo,
      propertyGoogleReviewDestinationApi: deps.propertyApi,
      propertyLifecycleApi: deps.propertyApi,
      staffPublicApi,
      clock: deps.clock,
    }),
  }
}
