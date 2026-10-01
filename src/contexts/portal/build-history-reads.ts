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
import type { PortalRepository } from './application/ports/portal.repository'
import type { PortalLinkRepository } from './application/ports/portal-link.repository'
import type { PortalExperienceRepository } from './application/ports/portal-experience.repository'
import type { PortalPublicationRepository } from './application/ports/portal-publication.repository'
import type { PortalHistoryRepository } from './application/ports/portal-history.repository'
import type { PortalHealthRepository } from './application/ports/portal-health.repository'
import type { PortalActorDirectory } from './application/ports/portal-actor-directory.port'
import type { PortalTokenRepository } from './application/ports/portal-token.repository'
import { getPortalPublicationHistory } from './application/use-cases/get-portal-publication-history'
import { getPortalHistory } from './application/use-cases/get-portal-history'
import { getPortalVersions } from './application/use-cases/get-portal-versions'
import { getPortalVersion } from './application/use-cases/get-portal-version'
import { getPortalReview } from './application/use-cases/get-portal-review'

export type PortalHistoryReadDeps = Readonly<{
  portalRepo: PortalRepository
  portalLinkRepo: PortalLinkRepository
  experienceRepo: PortalExperienceRepository
  publicationRepo: PortalPublicationRepository
  historyRepo: PortalHistoryRepository
  healthRepo: PortalHealthRepository
  actorDirectory: PortalActorDirectory
  portalTokenRepo: PortalTokenRepository
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
