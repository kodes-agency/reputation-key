import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import type { LinkResolverPort } from '#/contexts/portal/application/public-api'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createGuestInteractionRepository } from './infrastructure/repositories/guest-interaction.repository'
import { createPortalContextResolver } from './infrastructure/resolvers/portal-context-resolver'
import { createPublicPortalLookup } from './infrastructure/resolvers/public-portal-lookup'
import { recordScan } from './application/use-cases/record-scan'
import { recordScanWithRef } from './application/use-cases/record-scan-with-ref'
import { submitRating } from './application/use-cases/submit-rating'
import { submitFeedback } from './application/use-cases/submit-feedback'
import { trackReviewLinkClick } from './application/use-cases/track-review-link-click'
import { resolveLinkAndTrack } from './application/use-cases/resolve-link-and-track'
import { resolvePortalContext } from './application/use-cases/resolve-portal-context'
import { getPublicPortal } from './application/use-cases/get-public-portal'
import { getStaffIdForSession } from './application/use-cases/get-staff-id-for-session'
import { scanEventId, ratingId, feedbackId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type GuestContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  linkResolver: LinkResolverPort
  staffApi: StaffPublicApi
  portalApi: PortalPublicApi
  logger: LoggerPort
}>

export const buildGuestContext = (deps: GuestContextDeps) => {
  const guestRepo = createGuestInteractionRepository(deps.db)
  const portalContextResolver = createPortalContextResolver(deps.portalApi)
  const publicPortalLookup = createPublicPortalLookup(deps.portalApi)

  const useCases = {
    recordScan: recordScan({
      guestRepo,
      events: deps.events,
      idGen: () => scanEventId(randomUUID()),
      clock: deps.clock,
      logger: deps.logger,
    }),
    recordScanWithRef: recordScanWithRef({
      staffRepo: deps.staffApi,
      guestRepo,
      events: deps.events,
      idGen: () => scanEventId(randomUUID()),
      clock: deps.clock,
      logger: deps.logger,
    }),
    submitRating: submitRating({
      guestRepo,
      events: deps.events,
      idGen: () => ratingId(randomUUID()),
      clock: deps.clock,
    }),
    submitFeedback: submitFeedback({
      guestRepo,
      events: deps.events,
      idGen: () => feedbackId(randomUUID()),
      clock: deps.clock,
    }),
    trackReviewLinkClick: trackReviewLinkClick({
      events: deps.events,
      clock: deps.clock,
      logger: deps.logger,
    }),
    resolveLinkAndTrack: resolveLinkAndTrack({
      linkResolver: deps.linkResolver,
      trackClick: trackReviewLinkClick({
        events: deps.events,
        clock: deps.clock,
        logger: deps.logger,
      }),
    }),
    resolvePortalContext: resolvePortalContext({
      portalContextResolver,
    }),
    getPublicPortal: getPublicPortal({ publicPortalLookup }),
    getStaffIdForSession: getStaffIdForSession({ guestRepo }),
  } as const

  return { useCases, guestRepo, portalContextResolver, publicPortalLookup } as const
}
