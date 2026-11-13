import { createPortalScanPatternsReader } from './infrastructure/repositories/portal-scan-patterns.reader'
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
import { createGuestResponseRepository } from './responses/guest-response.repository.server'
import type { GuestResponseContentFilter } from './application/ports/guest-response.repository'
import { createAtomicGuestResponseCommandStore } from './responses/guest-response-command-store.server'
import {
  createGuestWithdrawalJournal,
  type GuestWithdrawalJournalConfig,
} from './infrastructure/guest-withdrawal-journal.server'
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
  type OperatorErasureAuthority,
} from './responses/guest-response-lifecycle.server'
import type { ResolvePrimaryStaffAttribution } from './responses/contracts'
import { createGuestSessionManager } from './server/guest-session'
import {
  guestResponseId,
  organizationId,
  qualifiedScanId,
  scanEventId,
  unbrand,
} from '#/shared/domain/ids'
import { createFeedbackPortalAttributionLookup } from './infrastructure/feedback-portal-attribution'
import { getPortalResponseIntegritySummary } from './application/use-cases/get-portal-response-integrity-summary'
import { getPortalRatingLanguages } from './application/use-cases/get-portal-rating-languages'
import { createGuestNetworkPressureStore } from './infrastructure/guest-network-pressure.store'
import { createResponseCeilingStore } from './infrastructure/response-ceiling-store.server'
import { createResponseCeiling } from './application/use-cases/response-ceiling.server'
import { consumeGuestNetworkPressure } from './application/use-cases/consume-guest-network-pressure'
import {
  createGuestObservationLossMonitor,
  type GuestObservationLossRedisPort,
} from './infrastructure/guest-observation-loss-monitor'
import { reportGuestObservationLoss } from './application/use-cases/report-observation-loss'
import { reportGuestNetworkBudgetExhausted } from './application/use-cases/report-network-budget-exhausted'
import { createGuestNetworkPseudonymHasher } from './server/hash-ip.server'
import type { ExecutionPolicy } from '#/shared/auth/execution-policy'
import {
  createContactRequestManagerAuthority,
  createContactRequestResponseAuthority,
} from './contact-requests/contact-request-authority.server'
import { createContactRequestEncryption } from './contact-requests/contact-request-encryption.server'
import {
  createContactRequestRepository,
  createContactRequestRetentionRepository,
} from './contact-requests/contact-request.repository.server'
import {
  contactRequestLifecycle,
  contactRequestRetentionSweep,
} from './contact-requests/contact-request-lifecycle.server'

const CONTACT_REQUEST_KEY_ID = 'v1'

type GuestContextDeps = Readonly<{
  db: Database
  clock: Clock
  idGen: () => string
  portalApi: PortalPublicApi & PortalContactRequestManagerAuthorityPublicApi
  identityManagerFacts: IdentityManagerFactsPublicApi
  identityAccountAdminAuthority: IdentityAccountAdminAuthorityPublicApi
  staffApi: Pick<StaffPublicApi, 'getAccessiblePropertyIds'>
  logger: LoggerPort
  executionPolicy: Pick<ExecutionPolicy, 'decide'>
  /** `enabled` is the launch switch; the sealing key is needed once it is on. */
  contactRequests: Readonly<{
    enabled: boolean
    encryptionKey?: string
    generateIv: () => Buffer
  }>
  sessionSecret: string
  publicOrigin: string
  secureCookies: boolean
  resolvePrimaryStaffAttribution: ResolvePrimaryStaffAttribution
  observationLossRedis?: GuestObservationLossRedisPort
  withdrawalJournalConfig?: GuestWithdrawalJournalConfig
  operatorErasureAuthority?: OperatorErasureAuthority
}>

export const buildGuestContext = (deps: GuestContextDeps) => {
  const guestResponseRepo = createGuestResponseRepository(deps.db, deps.clock)
  const guestResponseCommandStore = createAtomicGuestResponseCommandStore(
    deps.db,
    deps.clock,
    createGuestWithdrawalJournal({
      logger: deps.logger,
      idGen: deps.idGen,
      config: deps.withdrawalJournalConfig,
    }),
  )
  const guestObservationStore = createAtomicGuestObservationStore(deps.db)
  const guestNetworkPressureStore = createGuestNetworkPressureStore(deps.db, deps.idGen)
  const responseCeiling = createResponseCeiling({
    store: createResponseCeilingStore(deps.db, deps.sessionSecret),
    clock: deps.clock,
    logger: deps.logger,
  })
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
  const contactRequestResponseAuthority = createContactRequestResponseAuthority({
    sessions: guestSessions,
    responses: guestResponseRepo,
  })
  const contactRequestManagerAuthority = createContactRequestManagerAuthority({
    portal: deps.portalApi,
    managerFacts: deps.identityManagerFacts,
    accountAdminAuthority: deps.identityAccountAdminAuthority,
    staff: deps.staffApi,
  })
  const contactRequestRepo = (() => {
    const key = deps.contactRequests.encryptionKey
    if (!key) return undefined
    return createContactRequestRepository(
      deps.db,
      createContactRequestEncryption({
        activeKeyId: CONTACT_REQUEST_KEY_ID,
        keys: { [CONTACT_REQUEST_KEY_ID]: key },
        generateIv: deps.contactRequests.generateIv,
      }),
    )
  })()
  const contactRequests = contactRequestRepo
    ? contactRequestLifecycle({
        repo: contactRequestRepo,
        policy: deps.executionPolicy,
        managerAuthority: contactRequestManagerAuthority,
        responseAuthority: contactRequestResponseAuthority,
        isEnabled: () => deps.contactRequests.enabled,
        clock: deps.clock,
        idGen: deps.idGen,
        revealAuditIdGen: deps.idGen,
      })
    : undefined
  const contactRequestRetention = contactRequestRetentionSweep({
    repo: createContactRequestRetentionRepository(deps.db),
    clock: deps.clock,
  })
  const responseLifecycle = guestResponseLifecycle({
    repo: guestResponseRepo,
    clock: deps.clock,
    idGen: deps.idGen,
    commandStore: guestResponseCommandStore,
    operatorAuthority: deps.operatorErasureAuthority,
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
    responseCeiling,
    guestSessions,
    consumeGuestNetworkPressure: consumeGuestNetworkPressure({
      store: guestNetworkPressureStore,
      clock: deps.clock,
    }),
    reportObservationLoss,
    reportNetworkBudgetExhausted: reportGuestNetworkBudgetExhausted({
      logger: deps.logger,
    }),
    guestPublicRuntime: {
      expectedOrigin: deps.publicOrigin,
      hashNetworkPseudonym: createGuestNetworkPseudonymHasher(deps.sessionSecret),
    },
  } as const
  const attributionPublicApi = {
    findPortalIdForFeedback,
  }
  const integrityPublicApi = {
    getPortalScanPatterns: createPortalScanPatternsReader(deps.db),
    getPortalResponseIntegritySummary:
      getPortalResponseIntegritySummary(guestResponseRepo),
    getPortalRatingLanguages: getPortalRatingLanguages(guestResponseRepo),
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
  })

  return {
    publicApi,
    snippets,
    /** Health-snapshot gauge input; the monitor itself stays context-private. */
    observationLoss: Object.freeze({
      read: (asOf: Date) => guestObservationLossMonitor.read(asOf),
    }),
    /** Contact requests are off until the launch switch is on. `commands` is
     * absent without a sealing key; the retention sweep always runs. */
    contactRequestReadiness: Object.freeze({
      commands: contactRequests,
      retentionSweep: contactRequestRetention,
    }),
  } as const
}
