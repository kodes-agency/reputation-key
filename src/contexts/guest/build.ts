import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import type { PortalPublicApi } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createGuestInteractionRepository } from './infrastructure/repositories/guest-interaction.repository'
import { createGuestResponseRepository } from './infrastructure/repositories/guest-response.repository'
import { createAtomicGuestResponseCommandStore } from './infrastructure/guest-response-command-store'
import { createAtomicGuestObservationStore } from './infrastructure/guest-observation-store'
import { createPortalContextResolver } from './infrastructure/resolvers/portal-context-resolver'
import { createPublicPortalLookup } from './infrastructure/resolvers/public-portal-lookup'
import { recordScan } from './application/use-cases/record-scan'
import { trackReviewLinkClick } from './application/use-cases/track-review-link-click'
import { resolveLinkAndTrack } from './application/use-cases/resolve-link-and-track'
import { resolvePortalContext } from './application/use-cases/resolve-portal-context'
import { getPublicPortal } from './application/use-cases/get-public-portal'
import { guestResponseLifecycle } from './application/use-cases/guest-response-lifecycle'
import { createGuestSessionManager } from './server/guest-session'
import type { StoragePort } from '#/contexts/portal/application/public-api'
import { scanEventId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import { createFeedbackPortalAttributionLookup } from './infrastructure/feedback-portal-attribution'
import type { GuestFeedbackAttributionPublicApi } from './application/public-api'
import type { GuestResponseIntegrityPublicApi } from './application/public-api'
import { getPortalResponseIntegritySummary } from './application/use-cases/get-portal-response-integrity-summary'

type GuestContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  portalApi: PortalPublicApi
  logger: LoggerPort
  storage: StoragePort
  sessionSecret?: string
  secureCookies?: boolean
}>

export const buildGuestContext = (deps: GuestContextDeps) => {
  const guestRepo = createGuestInteractionRepository(deps.db)
  const guestResponseRepo = createGuestResponseRepository(deps.db, deps.clock)
  const guestResponseCommandStore = createAtomicGuestResponseCommandStore(
    deps.db,
    deps.events,
  )
  const guestObservationStore = createAtomicGuestObservationStore(deps.db, deps.events)
  const findPortalIdForFeedback = createFeedbackPortalAttributionLookup(
    deps.db,
    deps.clock,
  )
  const sessionSecret =
    deps.sessionSecret ??
    (process.env.NODE_ENV === 'production' ? null : 'dev-test-guest-session-secret')
  if (!sessionSecret) {
    throw new Error('Guest session secret is required in production')
  }
  const guestSessions = createGuestSessionManager({
    secret: sessionSecret,
    secureCookies: deps.secureCookies ?? process.env.NODE_ENV === 'production',
    clock: deps.clock,
  })
  const responseLifecycle = guestResponseLifecycle({
    repo: guestResponseRepo,
    storage: deps.storage,
    clock: deps.clock,
    idGen: randomUUID,
    commandStore: guestResponseCommandStore,
  })
  const portalContextResolver = createPortalContextResolver(deps.portalApi)
  const publicPortalLookup = createPublicPortalLookup(deps.portalApi)

  const useCases = {
    recordScan: recordScan({
      observationStore: guestObservationStore,
      idGen: () => scanEventId(randomUUID()),
      clock: deps.clock,
      logger: deps.logger,
    }),
    trackReviewLinkClick: trackReviewLinkClick({
      observationStore: guestObservationStore,
      clock: deps.clock,
      logger: deps.logger,
    }),
    resolveLinkAndTrack: resolveLinkAndTrack({
      publicPortalLookup,
      trackClick: trackReviewLinkClick({
        observationStore: guestObservationStore,
        clock: deps.clock,
        logger: deps.logger,
      }),
      reportObservationFailure: (error) =>
        deps.logger.warn(
          { err: error },
          'Review link click qualification failed — analytics suppressed',
        ),
    }),
    resolvePortalContext: resolvePortalContext({
      portalContextResolver,
    }),
    getPublicPortal: getPublicPortal({ publicPortalLookup }),
    responseLifecycle,
    guestSessions,
  } as const
  const attributionPublicApi: GuestFeedbackAttributionPublicApi = {
    findPortalIdForFeedback,
  }
  const integrityPublicApi: GuestResponseIntegrityPublicApi = {
    getPortalResponseIntegritySummary:
      getPortalResponseIntegritySummary(guestResponseRepo),
  }
  const publicApi = {
    getPublicPortal: useCases.getPublicPortal,
    resolvePortalContext: useCases.resolvePortalContext,
    ...attributionPublicApi,
    ...integrityPublicApi,
  }

  return {
    publicApi,
    internal: {
      repos: {
        guestRepo,
        guestResponseRepo,
        guestResponseCommandStore,
        guestObservationStore,
        portalContextResolver,
      },
      useCases,
    },
  } as const
}
