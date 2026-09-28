import type { Database } from '#/shared/db'
import type {
  PortalContactRequestManagerAuthorityPublicApi,
  PortalPublicApi,
} from '#/contexts/portal/application/public-api'
import type {
  IdentityAccountAdminAuthorityPublicApi,
  IdentityManagerFactsPublicApi,
} from '#/contexts/identity/application/public-api'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Clock } from '#/shared/domain/clock'
import { createGuestInteractionRepository } from './infrastructure/repositories/guest-interaction.repository'
import { createGuestResponseRepository } from './infrastructure/repositories/guest-response.repository'
import type { GuestResponseContentFilter } from './application/ports/guest-response.repository'
import type { LegacyFeedbackContentFilter } from './application/ports/guest-interaction.repository'
import { createAtomicGuestResponseCommandStore } from './infrastructure/guest-response-command-store'
import { createAtomicGuestObservationStore } from './infrastructure/guest-observation-store'
import { createPortalContextResolver } from './infrastructure/resolvers/portal-context-resolver'
import { createPublicPortalLookup } from './infrastructure/resolvers/public-portal-lookup'
import { recordScan } from './application/use-cases/record-scan'
import { trackReviewLinkClick } from './application/use-cases/track-review-link-click'
import { resolveLinkAndTrack } from './application/use-cases/resolve-link-and-track'
import { resolvePortalContext } from './application/use-cases/resolve-portal-context'
import { getPublicPortal } from './application/use-cases/get-public-portal'
import {
  guestResponseLifecycle,
  type ResolvePrimaryStaffAttribution,
} from './application/use-cases/guest-response-lifecycle'
import { createGuestSessionManager } from './server/guest-session'
import {
  guestResponseId,
  organizationId,
  qualifiedScanId,
  scanEventId,
  unbrand,
  type FeedbackId,
  type OrganizationId,
} from '#/shared/domain/ids'
import { createFeedbackPortalAttributionLookup } from './infrastructure/feedback-portal-attribution'
import { getPortalResponseIntegritySummary } from './application/use-cases/get-portal-response-integrity-summary'
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
import { contactRequestRetentionSweep } from './application/use-cases/contact-request-retention'

type GuestContextDeps = Readonly<{
  db: Database
  clock: Clock
  idGen: () => string
  monotonicNow: () => number
  portalApi: PortalPublicApi & PortalContactRequestManagerAuthorityPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  identityAccountAdminAuthority: IdentityAccountAdminAuthorityPublicApi
  staffApi: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
  logger: LoggerPort
  sessionSecret: string
  publicOrigin: string
  secureCookies: boolean
  resolvePrimaryStaffAttribution: ResolvePrimaryStaffAttribution
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
    deps.clock,
  )
  const guestObservationStore = createAtomicGuestObservationStore(deps.db)
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
  const attributionPublicApi = {
    findPortalIdForFeedback,
  }
  const integrityPublicApi = {
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
  const snippets = Object.freeze({
    // The exposed signature stays string-in/string-out: composition.ts wires
    // this into Inbox's FeedbackId-branded lookup port (ARC-03-T11) and must
    // not be forced to change. Branding is internal, right at the repository call.
    findResponseSnippetsByIds: (ids: ReadonlyArray<string>, orgId: string) =>
      guestResponseRepo
        .findSnippetsForOrg(organizationId(orgId), ids.map(guestResponseId))
        .then((rows) => rows.map((row) => ({ ...row, id: unbrand(row.id) }))),
    findEligibleResponseIds: (orgId: string, filter: GuestResponseContentFilter) =>
      guestResponseRepo
        .findEligibleSnippetIdsForOrg(organizationId(orgId), filter)
        .then((ids) => ids.map(unbrand)),
    findLegacyFeedbackSnippetsByIds: (
      ids: ReadonlyArray<FeedbackId>,
      organizationId: OrganizationId,
    ) => guestRepo.findFeedbackSnippetsByIds(ids, organizationId),
    findEligibleLegacyFeedbackIds: (
      organizationId: OrganizationId,
      filter: LegacyFeedbackContentFilter,
    ) => guestRepo.findEligibleFeedbackIds(organizationId, filter),
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
  } as const
}
