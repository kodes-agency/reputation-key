import { createGoogleNotificationRuntime } from './infrastructure/google-notification-runtime'
import { createGoogleImportV2ClaimReaper } from './application/google-import-v2-claim-reaper'
import { completeGoogleImportsForRestore } from './infrastructure/google-import-completion'
import { registerGoogleBindingFollowUpConsumers } from './infrastructure/google-binding-follow-up-consumers'
// Integration context — build function.
// Wires integration repos, adapters, use cases, and the import queue.
// Per ADR-0001: the composition root calls this and passes useCases to the container.
//
// Cross-context contributions exposed to the composition root (BQC-5.2):
//   - internal.googleReviewApi — the governed Google review API port, typed by
//     review's GoogleReviewApiPort.
//   - internal.gbpNotificationHandler — curried webhook binder; the root
//     supplies the review-owned queue at container assembly.

import type { Database } from '#/shared/db'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from './application/ports/google-oauth.port'
import type { OAuthStateHandleService } from './application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from './application/oauth-callback-abuse-gate'
import type { GoogleAuthorizedProviderExecutor } from './application/ports/google-authorized-provider-executor.port'
import type { GoogleImportReferenceStore } from './application/ports/google-import-reference-store.port'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import {
  googleReviewApiNotConfigured,
  type GoogleReviewApiPort,
  type TargetedGoogleReviewReferenceResolver,
  type ReviewQueuePort,
  type TargetedGoogleReviewQueuePort,
} from '#/contexts/review/application/public-api'
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  listGoogleConnections,
  refreshGoogleToken,
  getGoogleAuthUrl,
  manageNotifications,
  handleGbpNotification,
  type HandleGbpNotification,
  createGbpSubscribeBackfill,
  type ReconcileGbpNotificationSubscriptions,
  prepareGoogleConnectorDeparture,
} from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGoogleImportV2Store } from './infrastructure/google-import-v2-store'
import { createGoogleImportV2Queue } from './infrastructure/google-import-v2-queue'
import type { GoogleImportV2Store } from './application/ports/google-import-v2-store.port'
import { createAtomicIntegrationCommandStore } from './infrastructure/integration-command-store'
import { createGoogleConnectorDepartureStore } from './infrastructure/google-connector-departure.store'
import {
  registerGoogleImportDispatchConsumer,
  registerProviderAuthorizationInvalidationConsumer,
} from './infrastructure/outbox-consumers'
import { registerGoogleReviewPushDispatchConsumer } from './infrastructure/google-review-push-outbox-consumers'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { createGoogleOAuthExchangeRecoveryRepository } from './infrastructure/repositories/google-oauth-exchange-recovery.repository'
import { createGoogleDisconnectRevokeRepository } from './infrastructure/repositories/google-disconnect-revoke.repository'
import type { GoogleDisconnectRevokeStore } from './application/google-disconnect-revoke'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createMyBusinessNotificationsAdapter } from './infrastructure/adapters/mybusiness-notifications.adapter'
import { createGoogleReviewApiAdapter } from './infrastructure/adapters/google-review-api.adapter'
import { createGoogleAccountManagementAdapter } from './infrastructure/adapters/google-account-management.adapter'
import { createGoogleBusinessInformationAdapter } from './infrastructure/adapters/google-business-information.adapter'
import { createSingle401RefreshExecutor } from './provider/google-client.server'
import type { GoogleRefreshCoordination } from './application/ports/google-refresh-coordination.port'
import { createActiveConnectionTokenProvider } from './application/active-connection-token-provider'
import {
  createGoogleImportCommandAuthorizer,
  createGoogleImportReauthorizer,
  type GoogleImportContentAuthorizer,
} from './application/google-import-command-authorizer'
import { createGoogleImportPropertyClassifier } from './application/google-import-property-classifier'
import { createGoogleImportDiscovery } from './application/google-import-discovery'
import { createGoogleImportTransaction } from './application/google-import-transaction'
import {
  createGoogleImportV2Processor,
  type GoogleImportV2Processor,
} from './application/google-import-v2-processor'
import { createGoogleImportV2Lifecycle } from './application/google-import-v2-lifecycle'
import { createGetPropertyGooglePerformance } from './application/get-property-google-performance'
import { createRenewGooglePerformanceLease } from './application/renew-google-performance-lease'
import {
  createGooglePerformanceAuthorizer,
  type PerformanceContentAuthorizer,
} from './application/google-performance-authorizer'
import { createGoogleNotificationProviderAuthorizer } from './application/google-notification-provider-authorizer'
import {
  createGoogleReviewSyncAuthorizer,
  type GoogleReviewSyncContentAuthorizer,
} from './application/google-review-sync-authorizer'
import {
  createGoogleReplyPublicationAuthorizer,
  createReplyPublicationProviderCall,
  type GoogleReplyPublicationContentAuthorizer,
} from './application/google-reply-publication-authorizer'
import { createGooglePerformanceAdapter } from './infrastructure/adapters/google-performance.adapter'
import { getExecutionPolicy, type DecisionRequest } from '#/shared/auth/execution-policy'
import { createActiveMemberAuthResolver } from './infrastructure/active-member-auth.adapter'
import { parseGbpNotificationSubscriptionConfig } from './application/notification-subscription-config'
import type { PortalPublicDisplayNameDefaultPublicApi } from '#/contexts/portal/application/public-api'
import {
  reconcileGoogleProviderRecovery,
  type ReconcileGoogleProviderRecovery,
} from './application/use-cases/reconcile-google-provider-recovery'
import { createProviderAuthorizationInvalidationFanout } from '#/shared/provider-ephemeral/authorization-invalidation'

import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import {
  createGoogleReviewCursorStore,
  createUnavailableGoogleReviewCursorStore,
  type GoogleReviewCursorStore,
} from './infrastructure/google-review-cursor-store'
import {
  createUnavailableGoogleReviewPushReferenceStore,
  type GoogleReviewPushReferenceStore,
} from './application/ports/google-review-push-reference.port'
import { createGoogleReviewPushReferenceStore } from './infrastructure/google-review-push-reference-store'
import { createGbpReviewPushReceiptStore } from './infrastructure/gbp-review-push-receipt.store'
import { createGoogleReviewPushTargetResolver } from './infrastructure/adapters/google-review-push-target-resolver.adapter'
import type { GooglePerformanceDependencyDescriptor } from '#/shared/architecture/google-performance-live-boundary'
import { createIntegrationOrganizationLifecycleContributor } from './infrastructure/adapters/integration-organization-lifecycle.adapter'
import { createGoogleOrganizationClosureProvider } from './infrastructure/adapters/google-organization-closure-provider.adapter'
import { sameAuthorizationVectorExceptCredentialGeneration } from './application/google-authorization-vector'
import { createRefreshBoundGoogleCategories } from './application/refresh-bound-google-categories'
import { registerGoogleCategoryRefreshConsumer } from './infrastructure/google-category-refresh-outbox-consumers'

export {
  createGoogleAuthorizedProviderExecutor,
  createGoogleProviderCredentialAdmission,
  permitAdmissionCode,
} from './provider/google-client.server'

export type GoogleProviderEndpoints = Readonly<{
  gbpApiBaseUrl: string
  gbpAccountManagementBaseUrl: string
  gbpPerformanceBaseUrl: string
  reviewsApiBaseUrl: string
  notificationsApiBaseUrl: string
  oauthTokenUrl: string
  oauthJwksUrl: string
  oauthRevokeUrl: string
}>

/**
 * ADR 0050 §10: the live Google Performance path may not depend on a write
 * repository, a queue/job, a server cache, or Metric. This array is the machine-
 * readable statement of what the real wiring below actually injects into
 * `createGetPropertyGooglePerformance` (see the block that assigns
 * `getPropertyGooglePerformance`) — one entry per injected dependency, naming
 * the property it is injected as and the module specifier it comes from.
 *
 * `src/shared/architecture/google-performance-live-boundary.test.ts` asserts
 * `validateGooglePerformanceLiveDependencies` over this array AND parses the
 * real call site to require the injected property names to match `injectedAs`
 * exactly, so a new injected dependency cannot be added without appearing here
 * (and therefore without facing the validator). The same test walks the use
 * case's transitive runtime module graph against the forbidden module paths, so
 * a forbidden dependency reached indirectly also fails.
 */
export type GooglePerformanceWiringDescriptor = GooglePerformanceDependencyDescriptor &
  Readonly<{ injectedAs: string }>

export const GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS: readonly GooglePerformanceWiringDescriptor[] =
  Object.freeze([
    // Interactive authorization seam (ExecutionPolicy + Google Content authority
    // + property binding read); no durable Performance write.
    Object.freeze({
      injectedAs: 'authorize',
      kind: 'execution_policy',
      modulePath: '#/contexts/integration/application/google-performance-authorizer',
    }),
    // Request-lifetime provider read adapter. It is under infrastructure/ but is
    // an adapter, not a repositories/jobs/queues/cache module.
    Object.freeze({
      injectedAs: 'fetchReport',
      kind: 'google_performance_source',
      modulePath:
        '#/contexts/integration/infrastructure/adapters/google-performance.adapter',
    }),
    Object.freeze({
      injectedAs: 'issueLease',
      kind: 'provider_content_lease',
      modulePath: '#/shared/provider-ephemeral/authorization-lease',
    }),
    Object.freeze({
      injectedAs: 'clock',
      kind: 'clock',
      modulePath: '#/shared/domain/clock',
    }),
  ])

type IntegrationContextDeps = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  clock: () => Date
  idGen: () => string
  invalidationOwnerGen: () => string
  jobQueue: Queue | undefined
  propertyApi: PropertyPublicApi
  propertyBindingApi?: PropertyGoogleBindingPublicApi
  enqueueReviewSync?: ReviewQueuePort['addSyncJob']
  prepareImportSync: import('#/contexts/review/application/public-api').PrepareGoogleImportSync
  enqueueTargetedReviewFetch?: TargetedGoogleReviewQueuePort['addTargetedFetchJob']
  /** Starts an imported Property's public display name as its confirmed name. */
  defaultPublicDisplayName?: PortalPublicDisplayNameDefaultPublicApi['ensureDefaultPublicDisplayName']
  logger: LoggerPort
  /** Google provider endpoint configuration resolved once by composition. */
  providerEndpoints: GoogleProviderEndpoints
  /**
   * Parsed once by the process composition boundary. Integration construction
   * must be deterministic and must not re-read ambient process configuration.
   */
  config: Readonly<{
    nodeEnv: 'development' | 'production' | 'test'
    googleClientId: string
    googleClientSecret: string
    encryptionKey: string
    /** `${BETTER_AUTH_URL}/api/auth/google/callback`, the address Google must list. */
    googleCallbackUrl: string
    pubsubTopic: string
    pubsubNotificationTypes: string
  }>
  /** BQC-6.1: optional deterministic adapter overrides (simulations/tests
   * inject in-memory providers; absent = the real env-driven HTTP adapters). */
  googleOAuth?: GoogleOAuthPort
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  googleDisconnectRevokeStore?: GoogleDisconnectRevokeStore
  authorizeGoogleOAuthProviderCall?: GoogleOAuthProviderCallAuthorizer
  googleImportReferences?: GoogleImportReferenceStore
  authorizeGoogleImportContent?: GoogleImportContentAuthorizer
  authorizeGoogleReviewSyncContent?: GoogleReviewSyncContentAuthorizer
  authorizeGoogleReplyPublicationContent?: GoogleReplyPublicationContentAuthorizer
  googleImportReplayKeys?: VersionedHmacKeyring
  authorizeGooglePerformanceContent?: PerformanceContentAuthorizer
  googlePerformancePrincipalKeys?: VersionedHmacKeyring
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  providerEphemeralStore?: ProviderEphemeralStore
  googleOpaqueReferenceKeys?: VersionedHmacKeyring
  googleReviewCursorStore?: GoogleReviewCursorStore
  oauthStateHandles?: OAuthStateHandleService
  oauthCallbackAbuseGate?: OAuthCallbackAbuseGate
  /** Static policy observation awaited before provider/effect authorization. */
  refreshPolicyStoreRequired?: () => Promise<void>
  /** Redis-backed, renewable and generation-fenced refresh coordination. */
  googleRefreshCoordination?: GoogleRefreshCoordination
}>

export type IntegrationContextApi = Readonly<{
  /** Request-facing Integration capabilities grouped by workflow. */
  publicApi: Readonly<{
    connections: Readonly<{
      connect: ReturnType<typeof connectGoogleAccount>
      resume: ReturnType<typeof connectGoogleAccount>['resume']
      disconnect: ReturnType<typeof disconnectGoogleAccount>
      list: ReturnType<typeof listGoogleConnections>
    }>
    oauth: Readonly<{
      getAuthorizationUrl: ReturnType<typeof getGoogleAuthUrl>
      redeemState: OAuthStateHandleService['redeem']
      admitPreState: OAuthCallbackAbuseGate['admitPreState']
      admitResolvedTenant: OAuthCallbackAbuseGate['admitResolvedTenant']
    }>
    imports: Readonly<{
      discover: ReturnType<typeof createGoogleImportDiscovery> | null
      transact: ReturnType<typeof createGoogleImportTransaction> | null
      /** Who asked for the import that produced a Property; null when nobody did. */
      findInitiator: GoogleImportV2Store['findPropertyImportInitiator']
    }>
    performance: Readonly<{
      get: ReturnType<typeof createGetPropertyGooglePerformance> | null
      renewLease: ReturnType<typeof createRenewGooglePerformanceLease> | null
    }>
  }>
  /** Operator-only subscription and import recovery interfaces. */
  maintenance: Readonly<{
    subscribeNotifications: ReturnType<typeof createGbpSubscribeBackfill>
    imports: Readonly<{
      inspectBacklog:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectBacklog'] | null
      inspectScope:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectScope'] | null
      inspectRequest:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectRequest'] | null
      cancelRequest:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelRequest'] | null
      sweep: ReturnType<typeof createGoogleImportV2Lifecycle>['sweep'] | null
    }>
  }>
  /** Cross-context account/import teardown authority. */
  lifecycle: Readonly<{
    prepareConnectorDeparture: ReturnType<typeof prepareGoogleConnectorDeparture>
    cancelImportsForConnection:
      ReturnType<typeof createGoogleImportV2Lifecycle>['cancelConnection'] | null
    cancelImportsForUser:
      ReturnType<typeof createGoogleImportV2Lifecycle>['cancelUser'] | null
    cancelImportsForOrganization:
      ReturnType<typeof createGoogleImportV2Lifecycle>['cancelOrganization'] | null
    preparePropertyDeletion:
      ReturnType<typeof createGoogleImportV2Lifecycle>['preparePropertyDeletion'] | null
    finalizePropertyDeletion:
      ReturnType<typeof createGoogleImportV2Lifecycle>['finalizePropertyDeletion'] | null
  }>
  /** Authenticated GBP notification ingress. */
  webhook: Readonly<{ handleNotification: HandleGbpNotification }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
    recoverImports: ReturnType<typeof createGoogleImportV2ClaimReaper>
    completeImportsForRestore: (
      tx: import('#/shared/outbox/commit').Tx,
      now: Date,
    ) => Promise<{ items: number; parents: number }>
    processImportItem: GoogleImportV2Processor['process'] | null
    sweepImportLifecycle: ReturnType<typeof createGoogleImportV2Lifecycle>['sweep'] | null
    /** One bounded pass of both provider recovery stores; counts only. */
    reconcileProviderRecovery: ReconcileGoogleProviderRecovery
    /** The daily GBP push reconciliation across every tenant; counts only. */
    reconcileNotificationSubscriptions: ReconcileGbpNotificationSubscriptions
  }>
  /** ARC-03-T12: the named provider capabilities the Review build consumes. */
  reviewSync: Readonly<{
    /** BQC-5.2: the Google review API adapter, typed by Review's port. */
    googleReviewApi: GoogleReviewApiPort
    /** Identifier-only reference resolver consumed by Review's targeted job. */
    googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver
  }>
  internal: Readonly<{
    repos: Readonly<{
      connectionRepo: ReturnType<typeof createGoogleConnectionRepository>
      encryptionPort: ReturnType<typeof createTokenEncryptionAdapter>
      oauthPort: ReturnType<typeof createGoogleOAuthAdapter>
      googleOAuthExchangeRecovery: ReturnType<
        typeof createGoogleOAuthExchangeRecoveryRepository
      >
    }>
    /** BQC-5.2: the Google review API adapter (integration-owned), typed by
     * review's port — consumed by the review context build. */
    googleReviewApi: GoogleReviewApiPort
    /** Identifier-only reference resolver consumed by Review's targeted job. */
    googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver
    /** Authenticated ingress handler; receipt + outbox fact commit atomically. */
    gbpNotificationHandler: HandleGbpNotification
    useCases: Readonly<{
      connectGoogleAccount: ReturnType<typeof connectGoogleAccount>
      resumeGoogleAccountConnection: ReturnType<typeof connectGoogleAccount>['resume']
      disconnectGoogleAccount: ReturnType<typeof disconnectGoogleAccount>
      listGoogleConnections: ReturnType<typeof listGoogleConnections>
      refreshGoogleToken: ReturnType<typeof refreshGoogleToken>
      prepareGoogleConnectorDeparture: ReturnType<typeof prepareGoogleConnectorDeparture>
      googleImportDiscovery: ReturnType<typeof createGoogleImportDiscovery> | null
      googleImportTransaction: ReturnType<typeof createGoogleImportTransaction> | null
      processGoogleImportV2Item: GoogleImportV2Processor['process'] | null
      getPropertyGooglePerformance: ReturnType<
        typeof createGetPropertyGooglePerformance
      > | null
      renewGooglePerformanceLease: ReturnType<
        typeof createRenewGooglePerformanceLease
      > | null
      admitGoogleOAuthCallbackTenant: OAuthCallbackAbuseGate['admitResolvedTenant']
      sweepGoogleImportV2Lifecycle:
        ReturnType<typeof createGoogleImportV2Lifecycle>['sweep'] | null
      inspectGoogleImportV2Lifecycle:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectBacklog'] | null
      inspectGoogleImportV2LifecycleScope:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectScope'] | null
      cancelGoogleImportV2ForConnection:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelConnection'] | null
      cancelGoogleImportV2ForUser:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelUser'] | null
      cancelGoogleImportV2ForOrganization:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelOrganization'] | null
      prepareGoogleImportV2PropertyDeletion:
        ReturnType<typeof createGoogleImportV2Lifecycle>['preparePropertyDeletion'] | null
      finalizeGoogleImportV2PropertyDeletion:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['finalizePropertyDeletion']
        | null
      cancelGoogleImportV2Request:
        ReturnType<typeof createGoogleImportV2Lifecycle>['cancelRequest'] | null
      inspectGoogleImportV2Request:
        ReturnType<typeof createGoogleImportV2Lifecycle>['inspectRequest'] | null
    }>
  }>
}>

// Accepted residual: this is the integration context's composition root, and
// its 47 code paths are 47 optional dependencies, not 47 decisions — the same
// per-dependency override shape createContainer carries in src/composition.ts.
// Already over both thresholds on main; this branch added only wiring
// (`gbpSubscribeBackfill`, and `subscribeToNotifications` passed into the
// import processor), no new branching. Extraction here does not reduce
// complexity, it scatters it: the value of a composition root is that every
// binding is legible in ONE place, and splitting it into per-area builders
// would trade a high metric for real indirection while a reviewer's question
// ("what is this port wired to?") gets harder to answer.
// Revisit when this function starts making POLICY decisions rather than
// choosing implementations — branching on tenant state or request shape is the
// signal it has stopped being wiring.
// fallow-ignore-next-line complexity
export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  // ── Repositories ─────────────────────────────────────────────────
  const connectionRepo = createGoogleConnectionRepository(deps.db, deps.clock)
  const googleOAuthExchangeRecovery = createGoogleOAuthExchangeRecoveryRepository(deps.db)
  const googleDisconnectRevokeStore =
    deps.googleDisconnectRevokeStore ?? createGoogleDisconnectRevokeRepository(deps.db)
  const commandStore = createAtomicIntegrationCommandStore(deps.db, deps.clock)
  const connectorDepartureStore = createGoogleConnectorDepartureStore(deps.db)

  // ── Adapters ──────────────────────────────────────────────────────
  // Every Google endpoint comes from composition-resolved providerEndpoints.
  // BQC-6.1: injected provider overrides win; absent slots build the real
  // env-driven adapters exactly as before.
  const oauthPort =
    deps.googleOAuth ??
    createGoogleOAuthAdapter({
      clientId: deps.config.googleClientId,
      clientSecret: deps.config.googleClientSecret,
      jwksUrl: deps.providerEndpoints.oauthJwksUrl,
      clock: deps.clock,
      executor: deps.googleAuthorizedProviderExecutor,
      nowMs: () => deps.clock().getTime(),
    })
  // One key today. The version prefix exists so a second can be added here
  // without making the rows sealed by the first unreadable.
  const encryptionPort = createTokenEncryptionAdapter({
    activeVersion: 'v1',
    keys: { v1: deps.config.encryptionKey },
  })
  const googleImportCompletion: Parameters<typeof createGoogleImportV2Store>[2] = {
    readReceipt: (...args) => {
      if (!deps.propertyBindingApi) throw new Error('Property receipt reader unavailable')
      return deps.propertyBindingApi.readReceipt(...args)
    },
    prepareImportSync: deps.prepareImportSync,
    ensureImportFollowUps: (...args) => {
      if (!deps.propertyBindingApi)
        throw new Error('Property follow-up recovery unavailable')
      return deps.propertyBindingApi.ensureImportFollowUps(...args)
    },
  }
  const googleImportV2Store = createGoogleImportV2Store(deps.db, deps.clock, {
    ...googleImportCompletion,
  })
  const googleReviewPushReferences: GoogleReviewPushReferenceStore =
    deps.providerEphemeralStore && deps.googleOpaqueReferenceKeys
      ? createGoogleReviewPushReferenceStore({
          store: deps.providerEphemeralStore,
          keys: deps.googleOpaqueReferenceKeys,
          nowMs: () => deps.clock().getTime(),
        })
      : createUnavailableGoogleReviewPushReferenceStore()
  const gbpReviewPushReceipts = createGbpReviewPushReceiptStore(deps.db)
  const targetedGoogleReviewQueue: TargetedGoogleReviewQueuePort | null =
    deps.enqueueTargetedReviewFetch
      ? { addTargetedFetchJob: deps.enqueueTargetedReviewFetch }
      : null
  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  const googleImportV2Queue = createGoogleImportV2Queue(jobQueue)

  const invalidationReferences = deps.googleImportReferences
  const providerAuthorizationInvalidation =
    deps.providerEphemeralStore && invalidationReferences
      ? createProviderAuthorizationInvalidationFanout({
          store: deps.providerEphemeralStore,
          receipts: deps.outboxRepo,
          randomOwner: deps.invalidationOwnerGen,
          handlers: [
            {
              id: 'google_import_references',
              invalidate: async (event) => {
                const results = await Promise.all([
                  event.propertyId
                    ? invalidationReferences.invalidateProperty({
                        organizationId: event.organizationId,
                        propertyId: event.propertyId,
                      })
                    : Promise.resolve(true),
                  event.connectionId
                    ? invalidationReferences.invalidateConnection({
                        organizationId: event.organizationId,
                        connectionId: event.connectionId,
                      })
                    : Promise.resolve(true),
                ])
                if (results.some((result) => !result)) {
                  throw new Error('Google import reference invalidation failed')
                }
              },
            },
          ],
        })
      : null

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    registerGoogleBindingFollowUpConsumers(consumerRegistry, {
      propertyBindingApi: deps.propertyBindingApi,
      enqueueReviewSync: deps.enqueueReviewSync,
      defaultPublicDisplayName: deps.defaultPublicDisplayName,
      subscribe: manageNotificationsUseCase.subscribe,
      receipts: deps.outboxRepo,
      newDeliveryId: deps.idGen,
    })
    registerGoogleCategoryRefreshConsumer(consumerRegistry, {
      findConnection: connectionRepo.findById,
      resolveActor: resolveActiveMember,
      refresh: async (connection, actor, refreshEventId) => {
        if (!refreshBoundGoogleCategories) {
          throw new Error('Google category refresh unavailable')
        }
        await refreshBoundGoogleCategories(connection, actor, refreshEventId)
      },
      receipts: deps.outboxRepo,
    })
    registerGoogleImportDispatchConsumer(consumerRegistry, {
      store: googleImportV2Store,
      queue: googleImportV2Queue,
      receipts: deps.outboxRepo,
    })
    if (providerAuthorizationInvalidation) {
      registerProviderAuthorizationInvalidationConsumer(consumerRegistry, {
        fanout: providerAuthorizationInvalidation,
        receipts: deps.outboxRepo,
        nowMs: () => deps.clock().getTime(),
      })
    }
    if (targetedGoogleReviewQueue) {
      registerGoogleReviewPushDispatchConsumer(consumerRegistry, {
        queue: targetedGoogleReviewQueue,
        receipts: deps.outboxRepo,
      })
    }
  }

  // ── Use Cases ────────────────────────────────────────────────────
  const refreshGoogleTokenUseCase = refreshGoogleToken({
    connectionRepo,
    commandStore,
    oauth: oauthPort,
    encryption: encryptionPort,
    clock: deps.clock,
    authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
    ...(deps.googleRefreshCoordination === undefined
      ? {}
      : { coordination: deps.googleRefreshCoordination }),
  })
  const activeConnectionTokenProvider = createActiveConnectionTokenProvider({
    connectionRepo,
    encryption: encryptionPort,
    clock: deps.clock,
    refreshGoogleToken: refreshGoogleTokenUseCase,
  })
  const googleProviderTokenAccess: Pick<
    Parameters<typeof createSingle401RefreshExecutor>[0],
    'refreshAccessToken' | 'getAccessToken'
  > = {
    refreshAccessToken: ({ authorization }) =>
      activeConnectionTokenProvider.forceRefreshAccessToken(
        authorization.organizationId,
        authorization.connectionId,
        authorization.expectedCredentialGeneration,
      ),
    getAccessToken: ({ authorization }) =>
      activeConnectionTokenProvider.getAccessToken(
        authorization.organizationId,
        authorization.connectionId,
      ),
  }
  let reauthorizeGoogleImportProviderCall:
    Parameters<typeof createSingle401RefreshExecutor>[0]['reauthorize'] | undefined
  let reauthorizeGoogleNotificationProviderCall:
    Parameters<typeof createSingle401RefreshExecutor>[0]['reauthorize'] | undefined
  let authorizeGoogleNotificationProviderCall:
    Parameters<typeof manageNotifications>[0]['authorizeProviderCall'] | undefined
  const googleImportProviderExecutor = deps.googleAuthorizedProviderExecutor
    ? createSingle401RefreshExecutor({
        executor: deps.googleAuthorizedProviderExecutor,
        ...googleProviderTokenAccess,
        reauthorize: async (input) => {
          if (!reauthorizeGoogleImportProviderCall) {
            throw new Error('Google provider reauthorization is unavailable')
          }
          return reauthorizeGoogleImportProviderCall(input)
        },
      })
    : undefined

  const googleNotificationProviderExecutor = deps.googleAuthorizedProviderExecutor
    ? createSingle401RefreshExecutor({
        executor: deps.googleAuthorizedProviderExecutor,
        ...googleProviderTokenAccess,
        reauthorize: async (input) => {
          if (!reauthorizeGoogleNotificationProviderCall) {
            throw new Error('Google notification reauthorization is unavailable')
          }
          return reauthorizeGoogleNotificationProviderCall(input)
        },
      })
    : undefined
  const notificationsPort = googleNotificationProviderExecutor
    ? createMyBusinessNotificationsAdapter({
        executor: googleNotificationProviderExecutor,
        nowMs: () => deps.clock().getTime(),
      })
    : Object.freeze({
        subscribe: async () => {
          throw new Error('Governed Google notification subscription is unavailable')
        },
        unsubscribe: async () => {
          throw new Error('Governed Google notification subscription is unavailable')
        },
      })
  const notificationConfig = parseGbpNotificationSubscriptionConfig(
    deps.config.pubsubTopic,
    deps.config.pubsubNotificationTypes,
  )

  const {
    management: manageNotificationsUseCase,
    backfill: gbpSubscribeBackfill,
    reconcile: reconcileNotificationSubscriptions,
  } = createGoogleNotificationRuntime({
    db: deps.db,
    clock: deps.clock,
    connectionRepo,
    propertyApi: deps.propertyApi,
    propertyBindingApi: deps.propertyBindingApi,
    authorizeProviderCall: async (organizationIdValue, connectionIdValue, accountId) =>
      authorizeGoogleNotificationProviderCall
        ? authorizeGoogleNotificationProviderCall(
            organizationIdValue,
            connectionIdValue,
            accountId,
          )
        : { ok: false, code: 'authorization_unavailable' },
    notifications: notificationsPort,
    pubsubTopic: notificationConfig.pubsubTopic,
    notificationTypes: notificationConfig.notificationTypes,
    logger: deps.logger,
  })

  let googleImportDiscovery: ReturnType<typeof createGoogleImportDiscovery> | null = null
  let googleImportTransaction: ReturnType<typeof createGoogleImportTransaction> | null =
    null
  let googleImportV2Processor: GoogleImportV2Processor | null = null
  let refreshBoundGoogleCategories:
    ReturnType<typeof createRefreshBoundGoogleCategories> | undefined
  const resolveActiveMember = createActiveMemberAuthResolver(deps.db)
  const googleImportV2Lifecycle = deps.propertyBindingApi
    ? createGoogleImportV2Lifecycle({
        store: googleImportV2Store,
        propertyBindingApi: deps.propertyBindingApi,
        clock: deps.clock,
        newEventId: deps.idGen,
        references: deps.googleImportReferences,
      })
    : null
  if (deps.propertyBindingApi) {
    const propertyBindingApi = deps.propertyBindingApi
    const decideGoogleImport = async (request: DecisionRequest) => {
      await deps.refreshPolicyStoreRequired?.()
      return getExecutionPolicy().decide(request)
    }
    const authorizeGoogleImportCommand = createGoogleImportCommandAuthorizer({
      connectionRepo,
      tokenProvider: activeConnectionTokenProvider,
      decide: decideGoogleImport,
      authorizeGoogleContent:
        deps.authorizeGoogleImportContent ??
        (async () => ({ ok: false as const, code: 'runtime_unavailable' as const })),
      readProperty: propertyBindingApi.readInternal,
      clock: deps.clock,
      // The refusal is otherwise invisible: six checks share the
      // `authorization_changed` outcome code and the persisted item row cannot
      // say which fired. Content-free fields (version counters, a sha256); no tenant
      // identifier, which BANNED_LOG_KEYS forbids as a log field.
      warn: (fields, message) => deps.logger.warn(fields, message),
    })
    if (googleImportProviderExecutor) {
      refreshBoundGoogleCategories = createRefreshBoundGoogleCategories({
        findPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
        binding: propertyBindingApi,
        authorize: authorizeGoogleImportCommand,
        locations: createGoogleBusinessInformationAdapter({
          executor: googleImportProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        clock: deps.clock,
      })
    }
    reauthorizeGoogleImportProviderCall = createGoogleImportReauthorizer({
      resolveActor: resolveActiveMember,
      authorize: authorizeGoogleImportCommand,
    })
    googleImportV2Processor = createGoogleImportV2Processor({
      store: googleImportV2Store,
      propertyBindingApi,
      authorizeGoogleImportCommand,
      resolveActor: resolveActiveMember,
      clock: deps.clock,
      newClaimFence: deps.idGen,
      logger: deps.logger,
    })
    if (googleImportProviderExecutor && deps.googleImportReferences) {
      googleImportDiscovery = createGoogleImportDiscovery({
        authorizeGoogleImportCommand,
        classifyCandidates: createGoogleImportPropertyClassifier({
          readByLocationIds: propertyBindingApi.readByLocationIds,
          isAllowed: async ({ actor, action, propertyId }) =>
            (
              await decideGoogleImport({
                principal: { kind: 'user', ctx: actor },
                action,
                capability: 'property.import_gbp_v2',
                organizationId: actor.organizationId,
                ...(propertyId ? { propertyId } : {}),
                executionKind: 'interactive',
                now: deps.clock(),
              })
            ).allowed,
        }),
        references: deps.googleImportReferences,
        accounts: createGoogleAccountManagementAdapter({
          executor: googleImportProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        locations: createGoogleBusinessInformationAdapter({
          executor: googleImportProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        nowMs: () => deps.clock().getTime(),
        logger: deps.logger,
      })
    }
    if (deps.googleImportReferences && deps.googleImportReplayKeys) {
      googleImportTransaction = createGoogleImportTransaction({
        store: googleImportV2Store,
        references: deps.googleImportReferences,
        authorizeGoogleImportCommand,
        replayKeys: deps.googleImportReplayKeys,
        clock: deps.clock,
        logger: deps.logger,
        idGen: deps.idGen,
        ...(googleImportV2Lifecycle
          ? { cancelImportSaga: googleImportV2Lifecycle.cancelRequest }
          : {}),
      })
    }
  }
  let getPropertyGooglePerformance: ReturnType<
    typeof createGetPropertyGooglePerformance
  > | null = null
  let renewGooglePerformanceLease: ReturnType<
    typeof createRenewGooglePerformanceLease
  > | null = null
  if (
    deps.propertyBindingApi &&
    deps.googleAuthorizedProviderExecutor &&
    deps.authorizeGooglePerformanceContent &&
    deps.googlePerformancePrincipalKeys &&
    deps.providerAuthorizationLeases
  ) {
    const performanceTokenProvider = createActiveConnectionTokenProvider({
      connectionRepo,
      encryption: encryptionPort,
      clock: deps.clock,
      refreshGoogleToken: refreshGoogleTokenUseCase,
    })
    const authorize = createGooglePerformanceAuthorizer({
      resolveActor: createActiveMemberAuthResolver(deps.db),
      readBinding: deps.propertyBindingApi.readInternal,
      findConnection: connectionRepo.findById,
      getAccessToken: performanceTokenProvider.getAccessToken,
      decide: (request) => getExecutionPolicy().decide(request),
      authorizeGoogleContent: deps.authorizeGooglePerformanceContent,
      principalKeys: deps.googlePerformancePrincipalKeys,
      clock: deps.clock,
      logger: deps.logger,
    })
    const performanceProviderExecutor = createSingle401RefreshExecutor({
      executor: deps.googleAuthorizedProviderExecutor,
      refreshAccessToken: ({ authorization }) =>
        performanceTokenProvider.forceRefreshAccessToken(
          authorization.organizationId,
          authorization.connectionId,
          authorization.expectedCredentialGeneration,
        ),
      getAccessToken: ({ authorization }) =>
        performanceTokenProvider.getAccessToken(
          authorization.organizationId,
          authorization.connectionId,
        ),
      reauthorize: async ({ authorization }) => {
        if (
          authorization.capability !== 'property.read_gbp_performance' ||
          authorization.propertyId === null ||
          authorization.initiatorUserId === null
        ) {
          throw new Error('Google Performance reauthorization is unavailable')
        }
        const actor = await resolveActiveMember(
          authorization.organizationId,
          authorization.initiatorUserId,
        )
        if (!actor) {
          throw new Error('Google Performance reauthorization is unavailable')
        }
        const refreshed = await authorize({
          actor,
          propertyId: authorization.propertyId,
          phase: 'before_provider',
          requireAccessToken: false,
        })
        if (!refreshed.ok) {
          throw new Error('Google Performance reauthorization is unavailable')
        }
        if (
          !sameAuthorizationVectorExceptCredentialGeneration(
            refreshed.snapshot.authorizationVector,
            authorization.authorizationVector,
          )
        ) {
          throw new Error('Google Performance reauthorization changed')
        }
        return {
          capability: 'property.read_gbp_performance',
          organizationId: refreshed.snapshot.organizationId,
          propertyId: refreshed.snapshot.propertyId,
          connectionId: refreshed.snapshot.connectionId,
          initiatorUserId: actor.userId,
          expectedCredentialGeneration: refreshed.snapshot.credentialGeneration,
          authorizationVector: refreshed.snapshot.authorizationVector,
        }
      },
    })
    const source = createGooglePerformanceAdapter({
      executor: performanceProviderExecutor,
      nowMs: () => deps.clock().getTime(),
    })
    // ADR 0050 §10 live boundary. Every property injected here MUST have a
    // matching entry in GOOGLE_PERFORMANCE_LIVE_DEPENDENCY_DESCRIPTORS above;
    // the architecture test parses this call and fails on any drift.
    getPropertyGooglePerformance = createGetPropertyGooglePerformance({
      authorize,
      fetchReport: (input, actor, snapshot, accessToken) =>
        source.fetchReport(input, accessToken, {
          capability: 'property.read_gbp_performance',
          organizationId: snapshot.organizationId,
          propertyId: snapshot.propertyId,
          connectionId: snapshot.connectionId,
          initiatorUserId: actor.userId,
          expectedCredentialGeneration: snapshot.credentialGeneration,
          authorizationVector: snapshot.authorizationVector,
        }),
      issueLease: ({ actor, snapshot, absoluteDeadlineMs, nowMs }) =>
        deps.providerAuthorizationLeases!.issue({
          audience: 'performance',
          capability: 'property.read_gbp_performance',
          organizationId: snapshot.organizationId,
          initiatorUserId: actor.userId,
          propertyId: snapshot.propertyId,
          connectionId: snapshot.connectionId,
          principalHmacKeyVersion: snapshot.principalHmacKeyVersion,
          principalHmac: snapshot.principalHmac,
          authorizationFenceSha256: snapshot.authorizationFenceSha256,
          absoluteDeadlineMs,
          nowMs,
        }),
      clock: deps.clock,
    })
    renewGooglePerformanceLease = createRenewGooglePerformanceLease({
      authorize,
      renew: deps.providerAuthorizationLeases.renew,
      clock: deps.clock,
      logger: deps.logger,
    })
  }

  const oauthCallbackAbuseGate =
    deps.oauthCallbackAbuseGate ??
    Object.freeze({
      admitPreState: async () =>
        deps.config.nodeEnv === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
      admitResolvedTenant: async () =>
        deps.config.nodeEnv === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
    })
  if (!deps.oauthStateHandles) {
    throw new Error('Opaque OAuth state service is required')
  }
  const getOpaqueGoogleAuthUrl = getGoogleAuthUrl({
    clientId: deps.config.googleClientId,
    callbackUrl: deps.config.googleCallbackUrl,
    clock: deps.clock,
    stateHandles: deps.oauthStateHandles,
  })

  const googleConnectionCeremony = connectGoogleAccount({
    connectionRepo,
    oauth: oauthPort,
    encryption: encryptionPort,
    commandStore,
    exchangeRecovery: googleOAuthExchangeRecovery,
    clock: deps.clock,
    idGen: deps.idGen,
    callbackUrl: deps.config.googleCallbackUrl,
    authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
  })

  const useCases = {
    connectGoogleAccount: googleConnectionCeremony,
    resumeGoogleAccountConnection: googleConnectionCeremony.resume,

    disconnectGoogleAccount: disconnectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      commandStore,
      clock: deps.clock,
      logger: deps.logger,
      authorizeProviderCall: deps.authorizeGoogleOAuthProviderCall,
      disconnectRevokeStore: googleDisconnectRevokeStore,
      idGen: deps.idGen,
      unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
      cancelGoogleImportsForConnection: googleImportV2Lifecycle
        ? async (organizationIdValue, connectionId) => {
            await googleImportV2Lifecycle.cancelConnection(
              organizationIdValue,
              connectionId,
            )
          }
        : undefined,
    }),

    listGoogleConnections: listGoogleConnections({
      connectionRepo,
    }),

    refreshGoogleToken: refreshGoogleTokenUseCase,

    prepareGoogleConnectorDeparture: prepareGoogleConnectorDeparture({
      store: connectorDepartureStore,
      cancelGoogleImportsForConnection: async (organizationIdValue, connectionId) => {
        if (!googleImportV2Lifecycle) {
          throw new Error('Google import lifecycle unavailable')
        }
        return googleImportV2Lifecycle.cancelConnection(organizationIdValue, connectionId)
      },
      clock: deps.clock,
    }),

    /** gbp-subscribe backfill — ops:gbp-subscribe and the daily reconciliation. */
    gbpSubscribeBackfill,

    googleImportDiscovery,
    googleImportTransaction,
    processGoogleImportV2Item: googleImportV2Processor?.process ?? null,
    getPropertyGooglePerformance,
    renewGooglePerformanceLease,
    sweepGoogleImportV2Lifecycle: googleImportV2Lifecycle?.sweep ?? null,
    inspectGoogleImportV2Lifecycle: googleImportV2Lifecycle?.inspectBacklog ?? null,
    inspectGoogleImportV2LifecycleScope: googleImportV2Lifecycle?.inspectScope ?? null,
    cancelGoogleImportV2ForConnection: googleImportV2Lifecycle?.cancelConnection ?? null,
    cancelGoogleImportV2ForUser: googleImportV2Lifecycle?.cancelUser ?? null,
    cancelGoogleImportV2ForOrganization:
      googleImportV2Lifecycle?.cancelOrganization ?? null,
    prepareGoogleImportV2PropertyDeletion:
      googleImportV2Lifecycle?.preparePropertyDeletion ?? null,
    finalizeGoogleImportV2PropertyDeletion:
      googleImportV2Lifecycle?.finalizePropertyDeletion ?? null,
    cancelGoogleImportV2Request: googleImportV2Lifecycle?.cancelRequest ?? null,
    inspectGoogleImportV2Request: googleImportV2Lifecycle?.inspectRequest ?? null,

    getGoogleAuthUrl: getOpaqueGoogleAuthUrl,
    redeemGoogleOAuthState: deps.oauthStateHandles?.redeem,
    admitGoogleOAuthCallbackPreState: oauthCallbackAbuseGate.admitPreState,
    admitGoogleOAuthCallbackTenant: oauthCallbackAbuseGate.admitResolvedTenant,
  } as const

  // ── Public API — request boundary ───────────────────────────────
  const publicApi = Object.freeze({
    connections: Object.freeze({
      connect: useCases.connectGoogleAccount,
      resume: useCases.resumeGoogleAccountConnection,
      disconnect: useCases.disconnectGoogleAccount,
      list: useCases.listGoogleConnections,
    }),
    oauth: Object.freeze({
      getAuthorizationUrl: useCases.getGoogleAuthUrl,
      redeemState: useCases.redeemGoogleOAuthState,
      admitPreState: useCases.admitGoogleOAuthCallbackPreState,
      admitResolvedTenant: useCases.admitGoogleOAuthCallbackTenant,
    }),
    imports: Object.freeze({
      discover: useCases.googleImportDiscovery,
      transact: useCases.googleImportTransaction,
      findInitiator: googleImportV2Store.findPropertyImportInitiator,
    }),
    performance: Object.freeze({
      get: useCases.getPropertyGooglePerformance,
      renewLease: useCases.renewGooglePerformanceLease,
    }),
  })

  // ── Review-facing adapter + webhook binder (BQC-5.2) ────────────

  const googleReviewCursorStore =
    deps.googleReviewCursorStore ??
    (deps.providerEphemeralStore && deps.googleOpaqueReferenceKeys
      ? createGoogleReviewCursorStore({
          store: deps.providerEphemeralStore,
          keys: deps.googleOpaqueReferenceKeys,
          nowMs: () => deps.clock().getTime(),
        })
      : createUnavailableGoogleReviewCursorStore())

  const googleReviewSyncAuthorizer =
    deps.propertyBindingApi && deps.authorizeGoogleReviewSyncContent
      ? createGoogleReviewSyncAuthorizer({
          readBinding: deps.propertyBindingApi.readInternal,
          findConnection: connectionRepo.findById,
          getAccessToken: activeConnectionTokenProvider.getAccessToken,
          authorizeGoogleContent: deps.authorizeGoogleReviewSyncContent,
          warn: (fields, message) => deps.logger.warn(fields, message),
        })
      : null
  if (googleReviewSyncAuthorizer && deps.propertyBindingApi) {
    const propertyBindingApi = deps.propertyBindingApi
    authorizeGoogleNotificationProviderCall = createGoogleNotificationProviderAuthorizer({
      findConnection: connectionRepo.findById,
      findLinkedPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
      readBinding: propertyBindingApi.readInternal,
      authorizeSystemCall: googleReviewSyncAuthorizer,
    })
    reauthorizeGoogleNotificationProviderCall = async ({ authorization }) => {
      if (
        authorization.capability !== 'property.connect_gbp' ||
        authorization.initiatorUserId !== null
      ) {
        throw new Error('Google notification reauthorization is unavailable')
      }
      const refreshed = await googleReviewSyncAuthorizer({
        organizationId: authorization.organizationId,
        propertyId: authorization.propertyId,
        connectionId: authorization.connectionId,
        sourceEpoch: Number(authorization.authorizationVector.propertySourceEpoch),
        operationKey: 'notifications.manage',
      })
      if (
        !refreshed.ok ||
        !sameAuthorizationVectorExceptCredentialGeneration(
          refreshed.authorization.authorizationVector,
          authorization.authorizationVector,
        )
      ) {
        throw new Error('Google notification reauthorization changed')
      }
      return refreshed.authorization
    }
  }
  const googleReplyPublicationAuthorizer =
    deps.propertyBindingApi && deps.authorizeGoogleReplyPublicationContent
      ? createGoogleReplyPublicationAuthorizer({
          readBinding: deps.propertyBindingApi.readInternal,
          findConnection: connectionRepo.findById,
          getAccessToken: activeConnectionTokenProvider.getAccessToken,
          authorizeGoogleContent: deps.authorizeGoogleReplyPublicationContent,
          warn: (fields, message) => deps.logger.warn(fields, message),
        })
      : null
  const authorizeGoogleReviewSyncProviderCall:
    | Parameters<
        typeof createGoogleReviewApiAdapter
      >[0]['authorizeReviewSyncProviderCall']
    | undefined = googleReviewSyncAuthorizer
    ? async (input) => {
        const authorized = await googleReviewSyncAuthorizer(input)
        if (!authorized.ok) {
          throw Object.assign(
            new Error(
              `Google review provider authorization is unavailable: ${authorized.code}`,
            ),
            { code: authorized.code },
          )
        }
        return authorized
      }
    : undefined
  const authorizeGoogleReplyPublicationProviderCall:
    | Parameters<
        typeof createGoogleReviewApiAdapter
      >[0]['authorizeReplyPublicationProviderCall']
    | undefined = googleReplyPublicationAuthorizer
    ? createReplyPublicationProviderCall(googleReplyPublicationAuthorizer)
    : undefined
  const googleReviewProviderExecutor = deps.googleAuthorizedProviderExecutor
    ? createSingle401RefreshExecutor({
        executor: deps.googleAuthorizedProviderExecutor,
        ...googleProviderTokenAccess,
        reauthorize: async ({ authorization }) => {
          if (authorization.initiatorUserId !== null) {
            throw new Error('Google review provider reauthorization is unavailable')
          }
          const refreshed =
            authorization.capability === 'property.connect_gbp' &&
            googleReviewSyncAuthorizer
              ? await googleReviewSyncAuthorizer({
                  organizationId: authorization.organizationId,
                  propertyId: authorization.propertyId,
                  connectionId: authorization.connectionId,
                  sourceEpoch: Number(
                    authorization.authorizationVector.propertySourceEpoch,
                  ),
                })
              : authorization.capability === 'property.publish_reply' &&
                  googleReplyPublicationAuthorizer
                ? await googleReplyPublicationAuthorizer({
                    organizationId: authorization.organizationId,
                    propertyId: authorization.propertyId,
                    connectionId: authorization.connectionId,
                    sourceEpoch: authorization.publication.sourceEpoch,
                    reviewId: authorization.publication.reviewId,
                    materialReviewRevision:
                      authorization.publication.materialReviewRevision,
                    replyId: authorization.publication.replyId,
                    publicationCycle: authorization.publication.publicationCycle,
                    attemptNumber: authorization.publication.attemptNumber,
                  })
                : null
          if (
            !refreshed ||
            !refreshed.ok ||
            !sameAuthorizationVectorExceptCredentialGeneration(
              refreshed.authorization.authorizationVector,
              authorization.authorizationVector,
            )
          ) {
            throw new Error('Google review provider reauthorization changed')
          }
          return refreshed.authorization
        },
      })
    : undefined

  const refuseWithoutProvider = (): Promise<never> =>
    Promise.reject(googleReviewApiNotConfigured())
  const googleReviewApi: GoogleReviewApiPort = googleReviewProviderExecutor
    ? createGoogleReviewApiAdapter({
        connectionRepo,
        logger: deps.logger,
        executor: googleReviewProviderExecutor,
        authorizeReviewSyncProviderCall: authorizeGoogleReviewSyncProviderCall,
        authorizeReplyPublicationProviderCall:
          authorizeGoogleReplyPublicationProviderCall,
        nowMs: () => deps.clock().getTime(),
        cursorStore: googleReviewCursorStore,
      })
    : Object.freeze({
        listReviewsPage: refuseWithoutProvider,
        readReviewsHead: refuseWithoutProvider,
        getReview: refuseWithoutProvider,
        discardReviewCursors: refuseWithoutProvider,
        replyToReview: refuseWithoutProvider,
      })

  const googleReviewPushTargetResolver: TargetedGoogleReviewReferenceResolver =
    deps.propertyBindingApi
      ? createGoogleReviewPushTargetResolver({
          readBinding: deps.propertyBindingApi.readInternal,
          references: googleReviewPushReferences,
        })
      : Object.freeze({
          resolve: async () => ({ status: 'obsolete' as const }),
        })

  // The JWT-verified GBP webhook may resolve the canonical location ID without
  // an organization ID. The lookup still delegates through the Property public API.
  const gbpNotificationHandler = handleGbpNotification({
    propertyLookup: { listByGbpLocationId: deps.propertyApi.listByGbpLocationId },
    references: googleReviewPushReferences,
    receipts: gbpReviewPushReceipts,
    clock: deps.clock,
    logger: deps.logger,
  })

  return {
    publicApi,
    maintenance: Object.freeze({
      subscribeNotifications: useCases.gbpSubscribeBackfill,
      imports: Object.freeze({
        inspectBacklog: useCases.inspectGoogleImportV2Lifecycle,
        inspectScope: useCases.inspectGoogleImportV2LifecycleScope,
        inspectRequest: useCases.inspectGoogleImportV2Request,
        cancelRequest: useCases.cancelGoogleImportV2Request,
        sweep: useCases.sweepGoogleImportV2Lifecycle,
      }),
    }),
    lifecycle: Object.freeze({
      // LIF-01-T12/T13/T14: the three destructive lifecycle phases. This is the
      // `integration` argument to buildOrganizationLifecycleContributors
      // (composition/organization-export-contributors.ts): unlike the other
      // contributors it is not a pure `(db)`, because revoking Google
      // credentials and subscriptions needs the provider port wired here.
      // Exposing it does NOT arm it — the coordinator that calls `purge` is
      // composed only under an explicitly reviewed composition, and nothing
      // here reaches a request surface.
      organizationLifecycleContributor: createIntegrationOrganizationLifecycleContributor(
        {
          db: deps.db,
          provider: createGoogleOrganizationClosureProvider({
            oauth: oauthPort,
            encryption: encryptionPort,
            unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
          }),
        },
      ),
      prepareConnectorDeparture: useCases.prepareGoogleConnectorDeparture,
      cancelImportsForConnection: useCases.cancelGoogleImportV2ForConnection,
      cancelImportsForUser: useCases.cancelGoogleImportV2ForUser,
      cancelImportsForOrganization: useCases.cancelGoogleImportV2ForOrganization,
      preparePropertyDeletion: useCases.prepareGoogleImportV2PropertyDeletion,
      finalizePropertyDeletion: useCases.finalizeGoogleImportV2PropertyDeletion,
    }),
    webhook: Object.freeze({ handleNotification: gbpNotificationHandler }),
    worker: Object.freeze({
      registerOutboxConsumers,
      recoverImports: createGoogleImportV2ClaimReaper({
        store: googleImportV2Store,
        queue: googleImportV2Queue,
        processItem: async (input) => {
          if (!useCases.processGoogleImportV2Item)
            throw new Error('Google import processor unavailable')
          await useCases.processGoogleImportV2Item(input)
        },
        logger: deps.logger,
        newDeliveryId: deps.idGen,
        clock: deps.clock,
      }),
      completeImportsForRestore: (tx: import('#/shared/outbox/commit').Tx, now: Date) =>
        completeGoogleImportsForRestore(tx, googleImportCompletion, now),
      processImportItem: useCases.processGoogleImportV2Item,
      sweepImportLifecycle: useCases.sweepGoogleImportV2Lifecycle,
      // The permit sweep's recovery pass, on the stores this build already
      // holds, including a composition-provided disconnect store.
      reconcileProviderRecovery: reconcileGoogleProviderRecovery({
        exchangeRecovery: googleOAuthExchangeRecovery,
        disconnectRevoke: googleDisconnectRevokeStore,
      }),
      reconcileNotificationSubscriptions,
    }),
    // ARC-03-T12: the two provider capabilities the Review context consumes.
    // The root forwards this named group instead of reaching into `internal`.
    reviewSync: Object.freeze({
      googleReviewApi,
      googleReviewPushTargetResolver,
    }),
    internal: {
      repos: {
        connectionRepo,
        googleOAuthExchangeRecovery,
        encryptionPort,
        oauthPort,
      },
      googleReviewApi,
      googleReviewPushTargetResolver,
      gbpNotificationHandler,
      useCases: {
        ...useCases,
      },
    },
  }
}
