import { createGoogleConnectionsRuntime } from './connections/connections-runtime.server'
import { createGoogleNotificationsRuntime } from './connections/notifications-runtime.server'
import { createGoogleImportClaimReaper } from './imports/google-import-claim-reaper.server'
import {
  completeImportsForRestore,
  type GoogleImportCompletionDeps,
} from './imports/import-completion.server'
import { registerGoogleBindingFollowUpConsumers } from './imports/google-binding-follow-up-consumers.server'
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
import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'
import type { GoogleConnectionStatus } from './domain/types'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  GoogleOAuthPort,
  GoogleOAuthProviderCallAuthorizer,
} from './connections/google-oauth.port.server'
import type { OAuthStateHandleService } from './application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from './connections/oauth-callback-abuse-gate.server'
import type { GoogleAuthorizedProviderExecutor } from './provider/google-client.port.server'
import type { GoogleImportReferenceStore } from './imports/durable-import-reference-store.port.server'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/public-api'
import {
  type GoogleConnectionStatusPort,
  type GoogleReviewApiPort,
  type TargetedGoogleReviewReferenceResolver,
  type ReviewQueuePort,
  type TargetedGoogleReviewQueuePort,
} from '#/contexts/reputation/public-api'
import { connectGoogleAccount } from './connections/connect-google-account.server'
import { disconnectGoogleAccount } from './connections/disconnect-google-account.server'
import { listGoogleConnections } from './connections/list-google-connections.server'
import { refreshGoogleToken } from './connections/refresh-google-token.server'
import { getGoogleAuthUrl } from './connections/get-google-auth-url.server'
import {
  handleGbpNotification,
  type HandleGbpNotification,
} from './review-sync/handle-gbp-notification.server'
import { createGbpSubscribeBackfill } from './application/use-cases/gbp-subscribe-backfill'
import { type ReconcileGbpNotificationSubscriptions } from './connections/reconcile-gbp-notification-subscriptions.server'
import { prepareGoogleConnectorDeparture } from './connections/prepare-google-connector-departure.server'
import { createGoogleConnectionRepository } from './connections/google-connection-repository.server'
import { createImportStore } from './imports/import-store.server'
import { createGoogleImportQueue } from './imports/google-import-queue.server'
import type { GoogleImportStore } from './imports/import-store.port.server'
import {
  registerGoogleImportDispatchConsumer,
  registerProviderAuthorizationInvalidationConsumer,
} from './imports/google-import-outbox-consumers.server'
import { registerGoogleReviewPushDispatchConsumer } from './review-sync/google-review-push-outbox-consumers.server'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { createGoogleOAuthExchangeRecoveryRepository } from './connections/google-oauth-exchange-recovery-repository.server'
import type { GoogleDisconnectRevokeStore } from './connections/google-disconnect-revoke.server'
import { createGoogleOAuthAdapter } from './connections/google-oauth.adapter.server'
import { createTokenEncryptionAdapter } from './connections/token-encryption.adapter.server'
import { createSingle401RefreshExecutor } from './provider/google-client.server'
import type { GoogleRefreshCoordination } from './connections/google-refresh-coordination.port.server'
import type { GoogleImportContentAuthorizer } from './imports/google-import-command-authorizer.server'
import { createGoogleImportDiscovery } from './imports/google-import-discovery.server'
import { createGoogleImportTransaction } from './imports/google-import-transaction.server'
import type { GoogleImportProcessor } from './imports/google-import-processor.server'
import { createGoogleImportLifecycle } from './imports/google-import-lifecycle.server'
import { createGoogleImportRuntime } from './imports/import-runtime.server'
import { createGoogleReviewSyncRuntime } from './review-sync/google-review-sync-runtime.server'
import {
  createGooglePerformanceRuntime,
  type GooglePerformanceRuntime,
} from './performance/google-performance-runtime.server'
import type { PerformanceContentAuthorizer } from './performance/google-performance-authorizer.server'
import type { GoogleReviewSyncContentAuthorizer } from './review-sync/google-review-sync-authorizer.server'
import type { GoogleReplyPublicationContentAuthorizer } from './review-sync/google-reply-publication-authorizer.server'
import { createActiveMemberAuthResolver } from './provider/active-member-auth.adapter.server'
import type { PortalPublicDisplayNameDefaultPublicApi } from '#/contexts/portal/public-api'
import {
  reconcileGoogleProviderRecovery,
  type ReconcileGoogleProviderRecovery,
} from './connections/reconcile-google-provider-recovery.server'

import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { GoogleReviewCursorStore } from './review-sync/google-review-cursor-store.server'
import {
  createUnavailableGoogleReviewPushReferenceStore,
  type GoogleReviewPushReferenceStore,
} from './review-sync/google-review-push-reference-store.port.server'
import { createGoogleReviewPushReferenceStore } from './review-sync/google-review-push-reference-store.server'
import { createGbpReviewPushReceiptStore } from './review-sync/gbp-review-push-receipt-store.server'
import { registerMemberDepartureConsumers } from './connections/member-departure-outbox-consumers.server'
import { registerGoogleCategoryRefreshConsumer } from './imports/google-category-refresh-outbox-consumers.server'

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

type IntegrationContextDeps = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  clock: () => Date
  idGen: () => string
  jobQueue: Queue | undefined
  propertyApi: PropertyPublicApi
  propertyBindingApi: PropertyGoogleBindingPublicApi
  enqueueReviewSync: ReviewQueuePort['addSyncJob']
  prepareImportSync: import('#/contexts/reputation/public-api').PrepareGoogleImportSync
  enqueueTargetedReviewFetch: TargetedGoogleReviewQueuePort['addTargetedFetchJob']
  /** Starts an imported Property's public display name as its confirmed name. */
  defaultPublicDisplayName: PortalPublicDisplayNameDefaultPublicApi['ensureDefaultPublicDisplayName']
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
      /** The connection's current status; null when it does not exist. */
      findStatus: (
        orgId: OrganizationId,
        id: GoogleConnectionId,
      ) => Promise<GoogleConnectionStatus | null>
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
      findInitiator: GoogleImportStore['findPropertyImportInitiator']
    }>
    performance: Readonly<{
      get: GooglePerformanceRuntime['getPropertyGooglePerformance'] | null
      renewLease: GooglePerformanceRuntime['renewGooglePerformanceLease'] | null
    }>
  }>
  /** Operator-only subscription and import recovery interfaces. */
  maintenance: Readonly<{
    subscribeNotifications: ReturnType<typeof createGbpSubscribeBackfill>
    imports: Readonly<{
      inspectBacklog: ReturnType<typeof createGoogleImportLifecycle>['inspectBacklog']
      sweep: ReturnType<typeof createGoogleImportLifecycle>['sweep']
    }>
  }>
  /** Authenticated GBP notification ingress. */
  webhook: Readonly<{ handleNotification: HandleGbpNotification }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
    recoverImports: ReturnType<typeof createGoogleImportClaimReaper>
    completeImportsForRestore: (
      tx: import('#/shared/outbox/commit').Tx,
      now: Date,
    ) => Promise<{ items: number; parents: number }>
    processImportItem: GoogleImportProcessor['process']
    sweepImportLifecycle: ReturnType<typeof createGoogleImportLifecycle>['sweep']
    /** One bounded pass of both provider recovery stores; counts only. */
    reconcileProviderRecovery: ReconcileGoogleProviderRecovery
    /** The daily GBP push reconciliation across every tenant; counts only. */
    reconcileNotificationSubscriptions: ReconcileGbpNotificationSubscriptions
  }>
  /** ARC-03-T12: the named provider capabilities the Review build consumes. */
  reviewSync: Readonly<{
    /** BQC-5.2: the Google review API adapter, typed by Review's port. */
    googleReviewApi: GoogleReviewApiPort
    /** Where a Google connection stands, for the reply publish job. */
    googleConnectionStatus: GoogleConnectionStatusPort
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
      processGoogleImportItem: GoogleImportProcessor['process']
      getPropertyGooglePerformance: GooglePerformanceRuntime['getPropertyGooglePerformance']
      renewGooglePerformanceLease: GooglePerformanceRuntime['renewGooglePerformanceLease']
      admitGoogleOAuthCallbackTenant: OAuthCallbackAbuseGate['admitResolvedTenant']
      sweepGoogleImportLifecycle: ReturnType<typeof createGoogleImportLifecycle>['sweep']
      inspectGoogleImportLifecycle: ReturnType<
        typeof createGoogleImportLifecycle
      >['inspectBacklog']
      cancelGoogleImportForUser: ReturnType<
        typeof createGoogleImportLifecycle
      >['cancelUser']
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
  const connections = createGoogleConnectionsRuntime({
    db: deps.db,
    clock: deps.clock,
    idGen: deps.idGen,
    logger: deps.logger,
    config: deps.config,
    oauthJwksUrl: deps.providerEndpoints.oauthJwksUrl,
    googleOAuth: deps.googleOAuth,
    googleAuthorizedProviderExecutor: deps.googleAuthorizedProviderExecutor,
    googleDisconnectRevokeStore: deps.googleDisconnectRevokeStore,
    authorizeGoogleOAuthProviderCall: deps.authorizeGoogleOAuthProviderCall,
    oauthStateHandles: deps.oauthStateHandles,
    oauthCallbackAbuseGate: deps.oauthCallbackAbuseGate,
    googleRefreshCoordination: deps.googleRefreshCoordination,
  })
  const {
    connectionRepo,
    exchangeRecovery: googleOAuthExchangeRecovery,
    disconnectRevokeStore: googleDisconnectRevokeStore,
    encryptionPort,
    oauthPort,
    refreshToken: refreshGoogleTokenUseCase,
    tokenProvider: activeConnectionTokenProvider,
    providerTokenAccess: googleProviderTokenAccess,
  } = connections
  const googleImportCompletion: GoogleImportCompletionDeps = {
    readReceipt: deps.propertyBindingApi.readReceipt,
    prepareImportSync: deps.prepareImportSync,
    ensureImportFollowUps: deps.propertyBindingApi.ensureImportFollowUps,
  }
  const googleImportStore = createImportStore(deps.db, deps.clock, googleImportCompletion)
  const googleReviewPushReferences: GoogleReviewPushReferenceStore =
    deps.providerEphemeralStore && deps.googleOpaqueReferenceKeys
      ? createGoogleReviewPushReferenceStore({
          store: deps.providerEphemeralStore,
          keys: deps.googleOpaqueReferenceKeys,
          nowMs: () => deps.clock().getTime(),
        })
      : createUnavailableGoogleReviewPushReferenceStore()
  const gbpReviewPushReceipts = createGbpReviewPushReceiptStore(deps.db)
  const targetedGoogleReviewQueue: TargetedGoogleReviewQueuePort = {
    addTargetedFetchJob: deps.enqueueTargetedReviewFetch,
  }
  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  const googleImportQueue = createGoogleImportQueue(jobQueue)

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
      store: googleImportStore,
      queue: googleImportQueue,
      receipts: deps.outboxRepo,
    })
    if (deps.googleImportReferences) {
      registerProviderAuthorizationInvalidationConsumer(consumerRegistry, {
        references: deps.googleImportReferences,
        receipts: deps.outboxRepo,
      })
    }
    registerGoogleReviewPushDispatchConsumer(consumerRegistry, {
      queue: targetedGoogleReviewQueue,
      receipts: deps.outboxRepo,
    })
    registerMemberDepartureConsumers(consumerRegistry, {
      prepareDeparture: useCases.prepareGoogleConnectorDeparture,
      cancelImportsForUser: googleImportLifecycle.cancelUser,
      resolveActiveMember,
      receipts: deps.outboxRepo,
    })
  }

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

  const {
    management: manageNotificationsUseCase,
    backfill: gbpSubscribeBackfill,
    reconcile: reconcileNotificationSubscriptions,
  } = createGoogleNotificationsRuntime({
    db: deps.db,
    clock: deps.clock,
    logger: deps.logger,
    connectionRepo,
    propertyApi: deps.propertyApi,
    propertyBindingApi: deps.propertyBindingApi,
    executor: deps.googleAuthorizedProviderExecutor,
    providerTokenAccess: googleProviderTokenAccess,
    withSingle401Refresh: createSingle401RefreshExecutor,
    pubsubTopic: deps.config.pubsubTopic,
    pubsubNotificationTypes: deps.config.pubsubNotificationTypes,
    authority: () => googleNotificationAuthority,
  })

  const resolveActiveMember = createActiveMemberAuthResolver(deps.db)
  const googleImportRuntime = createGoogleImportRuntime({
    clock: deps.clock,
    logger: deps.logger,
    newId: deps.idGen,
    connectionRepo,
    tokenProvider: activeConnectionTokenProvider,
    store: googleImportStore,
    propertyApi: deps.propertyApi,
    propertyBindingApi: deps.propertyBindingApi,
    resolveActiveMember,
    providerExecutor: googleImportProviderExecutor,
    references: deps.googleImportReferences,
    replayKeys: deps.googleImportReplayKeys,
    authorizeContent: deps.authorizeGoogleImportContent,
  })
  const {
    lifecycle: googleImportLifecycle,
    processor: googleImportProcessor,
    discovery: googleImportDiscovery,
    transaction: googleImportTransaction,
  } = googleImportRuntime
  const {
    refreshBoundCategories: refreshBoundGoogleCategories,
    reauthorizeProviderCall: reauthorizeGoogleImportProviderCall,
  } = googleImportRuntime

  const { getPropertyGooglePerformance, renewGooglePerformanceLease } =
    createGooglePerformanceRuntime({
      clock: deps.clock,
      logger: deps.logger,
      connectionRepo,
      encryption: encryptionPort,
      refreshGoogleToken: refreshGoogleTokenUseCase,
      resolveActiveMember,
      propertyBindingApi: deps.propertyBindingApi,
      executor: deps.googleAuthorizedProviderExecutor,
      withSingle401Refresh: createSingle401RefreshExecutor,
      authorizeContent: deps.authorizeGooglePerformanceContent,
      principalKeys: deps.googlePerformancePrincipalKeys,
      leases: deps.providerAuthorizationLeases,
    })

  const connectionCommands = connections.commands({
    unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
    cancelImportsForConnection: async (organizationIdValue, connectionId) => {
      await googleImportLifecycle.cancelConnection(organizationIdValue, connectionId)
    },
  })

  const useCases = {
    connectGoogleAccount: connectionCommands.connect,
    resumeGoogleAccountConnection: connectionCommands.resume,
    disconnectGoogleAccount: connectionCommands.disconnect,
    listGoogleConnections: connectionCommands.list,
    refreshGoogleToken: refreshGoogleTokenUseCase,
    prepareGoogleConnectorDeparture: connectionCommands.prepareDeparture,

    /** gbp-subscribe backfill — ops:gbp-subscribe and the daily reconciliation. */
    gbpSubscribeBackfill,

    googleImportDiscovery,
    googleImportTransaction,
    processGoogleImportItem: googleImportProcessor.process,
    getPropertyGooglePerformance,
    renewGooglePerformanceLease,
    sweepGoogleImportLifecycle: googleImportLifecycle.sweep,
    inspectGoogleImportLifecycle: googleImportLifecycle.inspectBacklog,
    cancelGoogleImportForUser: googleImportLifecycle.cancelUser,

    getGoogleAuthUrl: connections.oauth.authorizationUrl,
    redeemGoogleOAuthState: connections.oauth.redeemState,
    admitGoogleOAuthCallbackPreState: connections.oauth.admitPreState,
    admitGoogleOAuthCallbackTenant: connections.oauth.admitResolvedTenant,
  } as const

  // ── Public API — request boundary ───────────────────────────────
  const publicApi = Object.freeze({
    connections: Object.freeze({
      connect: useCases.connectGoogleAccount,
      resume: useCases.resumeGoogleAccountConnection,
      disconnect: useCases.disconnectGoogleAccount,
      list: useCases.listGoogleConnections,
      findStatus: async (orgId: OrganizationId, id: GoogleConnectionId) =>
        (await connectionRepo.findById(orgId, id))?.status ?? null,
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
      findInitiator: googleImportStore.findPropertyImportInitiator,
    }),
    performance: Object.freeze({
      get: useCases.getPropertyGooglePerformance,
      renewLease: useCases.renewGooglePerformanceLease,
    }),
  })

  // ── Review-facing adapter + webhook binder ─────────────────────
  const {
    googleReviewApi,
    googleConnectionStatus,
    googleReviewPushTargetResolver,
    notification: googleNotificationAuthority,
  } = createGoogleReviewSyncRuntime({
    clock: deps.clock,
    logger: deps.logger,
    connectionRepo,
    getAccessToken: activeConnectionTokenProvider.getAccessToken,
    providerTokenAccess: googleProviderTokenAccess,
    withSingle401Refresh: createSingle401RefreshExecutor,
    findLinkedPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
    propertyBindingApi: deps.propertyBindingApi,
    executor: deps.googleAuthorizedProviderExecutor,
    authorizeReviewSyncContent: deps.authorizeGoogleReviewSyncContent,
    authorizeReplyPublicationContent: deps.authorizeGoogleReplyPublicationContent,
    cursorStore: deps.googleReviewCursorStore,
    providerEphemeralStore: deps.providerEphemeralStore,
    opaqueReferenceKeys: deps.googleOpaqueReferenceKeys,
    pushReferences: googleReviewPushReferences,
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
        inspectBacklog: useCases.inspectGoogleImportLifecycle,
        sweep: useCases.sweepGoogleImportLifecycle,
      }),
    }),
    webhook: Object.freeze({ handleNotification: gbpNotificationHandler }),
    worker: Object.freeze({
      registerOutboxConsumers,
      recoverImports: createGoogleImportClaimReaper({
        store: googleImportStore,
        queue: googleImportQueue,
        processItem: async (input) => {
          await useCases.processGoogleImportItem(input)
        },
        logger: deps.logger,
        newDeliveryId: deps.idGen,
        clock: deps.clock,
      }),
      completeImportsForRestore: (tx: import('#/shared/outbox/commit').Tx, now: Date) =>
        completeImportsForRestore(tx, googleImportCompletion, now),
      processImportItem: useCases.processGoogleImportItem,
      sweepImportLifecycle: useCases.sweepGoogleImportLifecycle,
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
      googleConnectionStatus,
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
