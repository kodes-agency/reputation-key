import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import type {
  PortalContactRequestManagerAuthorityPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import type {
  IdentityAccountAdminAuthorityPublicApi,
  IdentityManagerFactsPublicApi,
} from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Clock } from '#/shared/domain/clock'
import type { GuestSnippetReadPort } from './application/ports/guest-snippet-read.port'
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
import { qualifiedScanId, scanEventId } from '#/shared/domain/ids'
import { createFeedbackPortalAttributionLookup } from './infrastructure/feedback-portal-attribution'
import type { GuestFeedbackAttributionPublicApi } from './application/public-api'
import type { GuestResponseIntegrityPublicApi } from './application/public-api'
import { getPortalResponseIntegritySummary } from './application/use-cases/get-portal-response-integrity-summary'
import type { PrimaryStaffAttributionResolver } from './application/ports/primary-staff-attribution.port'
import { createGuestNetworkPressureStore } from './infrastructure/guest-network-pressure.store'
import { consumeGuestNetworkPressure } from './application/use-cases/consume-guest-network-pressure'
import {
  createGuestObservationLossMonitor,
  type GuestObservationLossRedisPort,
} from './infrastructure/guest-observation-loss-monitor'
import { reportGuestObservationLoss } from './application/use-cases/report-observation-loss'
import { createGuestNetworkPseudonymHasher } from './server/hash-ip.server'
import { createContactRequestResponseAuthorityAdapter } from './infrastructure/adapters/contact-request-response-authority.adapter'
import { createContactRequestManagerAuthorityAdapter } from './infrastructure/adapters/contact-request-manager-authority.adapter'
import { createContactRequestRetentionRepository } from './infrastructure/repositories/contact-request.repository'
import { createGuestOrganizationExportContributor } from './infrastructure/adapters/guest-organization-export.adapter'
import { createGuestOrganizationLifecycleContributor } from './infrastructure/adapters/guest-organization-lifecycle.adapter'
import { contactRequestRetentionSweep } from './application/use-cases/contact-request-retention'

type GuestContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: Clock
  idGen: () => string
  monotonicNow: () => number
  portalApi: PortalPublicApi & PortalContactRequestManagerAuthorityPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  identityAccountAdminAuthority: IdentityAccountAdminAuthorityPublicApi
  staffApi: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
  logger: LoggerPort
  storage: StoragePort
  sessionSecret: string
  publicOrigin: string
  secureCookies: boolean
  resolvePrimaryStaffAttribution: PrimaryStaffAttributionResolver
  observationLossRedis?: GuestObservationLossRedisPort
}>

export const buildGuestContext = (deps: GuestContextDeps) => {
  const guestRepo = createGuestInteractionRepository(deps.db, {
    logger: deps.logger,
    monotonicNow: deps.monotonicNow,
  })
  const guestResponseRepo = createGuestResponseRepository(deps.db, deps.clock)
  const guestResponseCommandStore = createAtomicGuestResponseCommandStore(
    deps.db,
    deps.events,
    deps.clock,
  )
  const guestObservationStore = createAtomicGuestObservationStore(deps.db, deps.events)
  const guestNetworkPressureStore = createGuestNetworkPressureStore(deps.db, deps.idGen)
  const guestObservationLossMonitor = createGuestObservationLossMonitor(
    deps.observationLossRedis,
  )
  const reportObservationLoss = reportGuestObservationLoss({
    monitor: guestObservationLossMonitor,
    clock: deps.clock,
    logger: deps.logger,
  })
  const findPortalIdForFeedback = createFeedbackPortalAttributionLookup(
    deps.db,
    deps.clock,
  )
  const guestSessions = createGuestSessionManager({
    secret: deps.sessionSecret,
    secureCookies: deps.secureCookies,
    clock: deps.clock,
    randomId: deps.idGen,
  })
  const contactRequestResponseAuthority = createContactRequestResponseAuthorityAdapter({
    sessions: guestSessions,
    responses: guestResponseRepo,
  })
  const contactRequestManagerAuthority = createContactRequestManagerAuthorityAdapter({
    portal: deps.portalApi,
    managerFacts: deps.identityManagerFacts,
    accountAdminAuthority: deps.identityAccountAdminAuthority,
    staff: deps.staffApi,
  })
  const contactRequestRetention = contactRequestRetentionSweep({
    repo: createContactRequestRetentionRepository(deps.db),
    clock: deps.clock,
  })
  const responseLifecycle = guestResponseLifecycle({
    repo: guestResponseRepo,
    storage: deps.storage,
    clock: deps.clock,
    idGen: deps.idGen,
    commandStore: guestResponseCommandStore,
    resolvePrimaryStaffAttribution: deps.resolvePrimaryStaffAttribution,
  })
  const portalContextResolver = createPortalContextResolver(deps.portalApi)
  const publicPortalLookup = createPublicPortalLookup(deps.portalApi)
  const trackClick = trackReviewLinkClick({
    observationStore: guestObservationStore,
    clock: deps.clock,
    reportObservationLoss,
  })

  const useCases = {
    recordScan: recordScan({
      observationStore: guestObservationStore,
      accessArtifacts: deps.portalApi,
      idGen: () => scanEventId(deps.idGen()),
      qualifiedScanIdGen: () => qualifiedScanId(deps.idGen()),
      clock: deps.clock,
      resolvePrimaryStaffAttribution: deps.resolvePrimaryStaffAttribution,
      reportObservationLoss,
    }),
    trackReviewLinkClick: trackClick,
    resolveLinkAndTrack: resolveLinkAndTrack({
      publicPortalLookup,
      trackClick,
      reportObservationLoss,
    }),
    resolvePortalContext: resolvePortalContext({
      portalContextResolver,
    }),
    getPublicPortal: getPublicPortal({ publicPortalLookup }),
    responseLifecycle,
    guestSessions,
    consumeGuestNetworkPressure: consumeGuestNetworkPressure({
      store: guestNetworkPressureStore,
      clock: deps.clock,
    }),
    reportObservationLoss,
    guestPublicRuntime: {
      expectedOrigin: deps.publicOrigin,
      hashNetworkPseudonym: createGuestNetworkPseudonymHasher(deps.sessionSecret),
    },
  } as const
  const attributionPublicApi: GuestFeedbackAttributionPublicApi = {
    findPortalIdForFeedback,
  }
  const integrityPublicApi: GuestResponseIntegrityPublicApi = {
    getPortalResponseIntegritySummary:
      getPortalResponseIntegritySummary(guestResponseRepo),
  }
  const publicApi = {
    /** Public-edge request capabilities, including the session and abuse
     * controls that must stay composed with Guest-owned persistence. */
    requests: Object.freeze(useCases),
    getPublicPortal: useCases.getPublicPortal,
    resolvePortalContext: useCases.resolvePortalContext,
    ...attributionPublicApi,
    ...integrityPublicApi,
  }

  // ARC-03-T11: the two named Guest capabilities the composition root consumes.
  // Both used to be Guest repository reach-throughs from the root.
  const snippets: GuestSnippetReadPort = Object.freeze({
    findResponseSnippetsByIds: (ids, organizationId) =>
      guestResponseRepo.findSnippetsForOrg(organizationId, ids),
    findEligibleResponseIds: (organizationId, filter) =>
      guestResponseRepo.findEligibleSnippetIdsForOrg(organizationId, filter),
    findLegacyFeedbackSnippetsByIds: (ids, organizationId) =>
      guestRepo.findFeedbackSnippetsByIds(ids, organizationId),
    findEligibleLegacyFeedbackIds: (organizationId, filter) =>
      guestRepo.findEligibleFeedbackIds(organizationId, filter),
  })

  return {
    publicApi,
    snippets,
    /** Health-snapshot gauge input; the monitor itself stays context-private. */
    observationLoss: Object.freeze({
      read: (asOf: Date) => guestObservationLossMonitor.read(asOf),
    }),
    /** Contact Request stays dark; the retention sweep is the only capability
     * a running deployable consumes, and it operates on rows that can only
     * exist once the dark capability is turned on. */
    contactRequestReadiness: Object.freeze({
      responseAuthority: contactRequestResponseAuthority,
      managerAuthority: contactRequestManagerAuthority,
      retentionSweep: contactRequestRetention,
    }),
    /** LIF-01: the Guest-owned Organization Export contributor. It stays out
     * of `publicApi` on purpose — Guest is a dark context, and an export slice
     * is lifecycle composition input, not a product capability any
     * request-facing surface may reach. The contributor does not read Contact
     * Request, so wiring it here activates nothing. */
    organizationExportContributor: createGuestOrganizationExportContributor(deps.db),
    /** LIF-01-T12/T13/T14: the Guest-owned Organization lifecycle
     * contributor. Like the export slice it stays out of `publicApi`: the
     * purge phase must remain unreachable by default, and it may only ever be
     * reached through an explicitly reviewed composition of the lifecycle
     * coordinator, never through a request-facing surface. Its Closing phase
     * mutates nothing and it never reads Contact Request content, so wiring it
     * here activates nothing. */
    organizationLifecycleContributor: createGuestOrganizationLifecycleContributor(
      deps.db,
    ),
  } as const
}
