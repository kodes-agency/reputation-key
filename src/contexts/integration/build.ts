import { createGoogleConnectionsRuntime } from './connections/connections-runtime.server'
import { createGoogleNotificationsRuntime } from './connections/notifications-runtime.server'
import { createGoogleImportClaimReaper } from './application/google-import-claim-reaper'
import {
  completeImportsForRestore,
  type GoogleImportCompletionDeps,
} from './imports/import-completion.server'
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
  handleGbpNotification,
  type HandleGbpNotification,
  createGbpSubscribeBackfill,
  type ReconcileGbpNotificationSubscriptions,
  prepareGoogleConnectorDeparture,
} from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createImportStore } from './imports/import-store.server'
import { createGoogleImportQueue } from './infrastructure/google-import-queue'
import type { GoogleImportStore } from './application/ports/google-import-store.port'
import {
  registerGoogleImportDispatchConsumer,
  registerProviderAuthorizationInvalidationConsumer,
} from './infrastructure/outbox-consumers'
import { registerGoogleReviewPushDispatchConsumer } from './infrastructure/google-review-push-outbox-consumers'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { createGoogleOAuthExchangeRecoveryRepository } from './infrastructure/repositories/google-oauth-exchange-recovery.repository'
import type { GoogleDisconnectRevokeStore } from './application/google-disconnect-revoke'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createSingle401RefreshExecutor } from './provider/google-client.server'
import type { GoogleRefreshCoordination } from './application/ports/google-refresh-coordination.port'
import type { GoogleImportContentAuthorizer } from './application/google-import-command-authorizer'
import { createGoogleImportDiscovery } from './application/google-import-discovery'
import { createGoogleImportTransaction } from './application/google-import-transaction'
import type { GoogleImportProcessor } from './application/google-import-processor'
import { createGoogleImportLifecycle } from './application/google-import-lifecycle'
import { createGoogleImportRuntime } from './imports/import-runtime.server'
import { createGoogleReviewSyncRuntime } from './review-sync/google-review-sync-runtime.server'
import {
  createGooglePerformanceRuntime,
  type GooglePerformanceRuntime,
} from './performance/google-performance-runtime.server'
import type { PerformanceContentAuthorizer } from './application/google-performance-authorizer'
import type { GoogleReviewSyncContentAuthorizer } from './application/google-review-sync-authorizer'
import type { GoogleReplyPublicationContentAuthorizer } from './application/google-reply-publication-authorizer'
import { createActiveMemberAuthResolver } from './infrastructure/active-member-auth.adapter'
import type { PortalPublicDisplayNameDefaultPublicApi } from '#/contexts/portal/application/public-api'
import {
  reconcileGoogleProviderRecovery,
  type ReconcileGoogleProviderRecovery,
} from './application/use-cases/reconcile-google-provider-recovery'
import { createProviderAuthorizationInvalidationFanout } from '#/shared/provider-ephemeral/authorization-invalidation'

import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
import type { GoogleReviewCursorStore } from './infrastructure/google-review-cursor-store'
import {
  createUnavailableGoogleReviewPushReferenceStore,
  type GoogleReviewPushReferenceStore,
} from './application/ports/google-review-push-reference.port'
import { createGoogleReviewPushReferenceStore } from './infrastructure/google-review-push-reference-store'
import { createGbpReviewPushReceiptStore } from './infrastructure/gbp-review-push-receipt.store'
import { registerMemberDepartureConsumers } from './infrastructure/member-departure-outbox-consumers'
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
      inspectBacklog:
        ReturnType<typeof createGoogleImportLifecycle>['inspectBacklog'] | null
      inspectScope: ReturnType<typeof createGoogleImportLifecycle>['inspectScope'] | null
      inspectRequest:
        ReturnType<typeof createGoogleImportLifecycle>['inspectRequest'] | null
      cancelRequest:
        ReturnType<typeof createGoogleImportLifecycle>['cancelRequest'] | null
      sweep: ReturnType<typeof createGoogleImportLifecycle>['sweep'] | null
    }>
  }>
  /** Cross-context account/import teardown authority. */
  lifecycle: Readonly<{
    cancelImportsForConnection:
      ReturnType<typeof createGoogleImportLifecycle>['cancelConnection'] | null
    cancelImportsForOrganization:
      ReturnType<typeof createGoogleImportLifecycle>['cancelOrganization'] | null
    preparePropertyDeletion:
      ReturnType<typeof createGoogleImportLifecycle>['preparePropertyDeletion'] | null
    finalizePropertyDeletion:
      ReturnType<typeof createGoogleImportLifecycle>['finalizePropertyDeletion'] | null
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
    processImportItem: GoogleImportProcessor['process'] | null
    sweepImportLifecycle: ReturnType<typeof createGoogleImportLifecycle>['sweep'] | null
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
      processGoogleImportItem: GoogleImportProcessor['process'] | null
      getPropertyGooglePerformance: GooglePerformanceRuntime['getPropertyGooglePerformance']
      renewGooglePerformanceLease: GooglePerformanceRuntime['renewGooglePerformanceLease']
      admitGoogleOAuthCallbackTenant: OAuthCallbackAbuseGate['admitResolvedTenant']
      sweepGoogleImportLifecycle:
        ReturnType<typeof createGoogleImportLifecycle>['sweep'] | null
      inspectGoogleImportLifecycle:
        ReturnType<typeof createGoogleImportLifecycle>['inspectBacklog'] | null
      inspectGoogleImportLifecycleScope:
        ReturnType<typeof createGoogleImportLifecycle>['inspectScope'] | null
      cancelGoogleImportForConnection:
        ReturnType<typeof createGoogleImportLifecycle>['cancelConnection'] | null
      cancelGoogleImportForUser:
        ReturnType<typeof createGoogleImportLifecycle>['cancelUser'] | null
      cancelGoogleImportForOrganization:
        ReturnType<typeof createGoogleImportLifecycle>['cancelOrganization'] | null
      prepareGoogleImportPropertyDeletion:
        ReturnType<typeof createGoogleImportLifecycle>['preparePropertyDeletion'] | null
      finalizeGoogleImportPropertyDeletion:
        ReturnType<typeof createGoogleImportLifecycle>['finalizePropertyDeletion'] | null
      cancelGoogleImportRequest:
        ReturnType<typeof createGoogleImportLifecycle>['cancelRequest'] | null
      inspectGoogleImportRequest:
        ReturnType<typeof createGoogleImportLifecycle>['inspectRequest'] | null
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
  const targetedGoogleReviewQueue: TargetedGoogleReviewQueuePort | null =
    deps.enqueueTargetedReviewFetch
      ? { addTargetedFetchJob: deps.enqueueTargetedReviewFetch }
      : null
  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  const googleImportQueue = createGoogleImportQueue(jobQueue)

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
      store: googleImportStore,
      queue: googleImportQueue,
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
    registerMemberDepartureConsumers(consumerRegistry, {
      prepareDeparture: useCases.prepareGoogleConnectorDeparture,
      cancelImportsForUser: async (organizationIdValue, userIdValue) => {
        if (!googleImportLifecycle) {
          throw new Error('Google import lifecycle unavailable')
        }
        return googleImportLifecycle.cancelUser(organizationIdValue, userIdValue)
      },
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
    refreshPolicyStoreRequired: deps.refreshPolicyStoreRequired,
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
    cancelImportsForConnection: googleImportLifecycle
      ? async (organizationIdValue, connectionId) => {
          await googleImportLifecycle.cancelConnection(organizationIdValue, connectionId)
        }
      : undefined,
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
    processGoogleImportItem: googleImportProcessor?.process ?? null,
    getPropertyGooglePerformance,
    renewGooglePerformanceLease,
    sweepGoogleImportLifecycle: googleImportLifecycle?.sweep ?? null,
    inspectGoogleImportLifecycle: googleImportLifecycle?.inspectBacklog ?? null,
    inspectGoogleImportLifecycleScope: googleImportLifecycle?.inspectScope ?? null,
    cancelGoogleImportForConnection: googleImportLifecycle?.cancelConnection ?? null,
    cancelGoogleImportForUser: googleImportLifecycle?.cancelUser ?? null,
    cancelGoogleImportForOrganization: googleImportLifecycle?.cancelOrganization ?? null,
    prepareGoogleImportPropertyDeletion:
      googleImportLifecycle?.preparePropertyDeletion ?? null,
    finalizeGoogleImportPropertyDeletion:
      googleImportLifecycle?.finalizePropertyDeletion ?? null,
    cancelGoogleImportRequest: googleImportLifecycle?.cancelRequest ?? null,
    inspectGoogleImportRequest: googleImportLifecycle?.inspectRequest ?? null,

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
        inspectScope: useCases.inspectGoogleImportLifecycleScope,
        inspectRequest: useCases.inspectGoogleImportRequest,
        cancelRequest: useCases.cancelGoogleImportRequest,
        sweep: useCases.sweepGoogleImportLifecycle,
      }),
    }),
    lifecycle: Object.freeze({
      cancelImportsForConnection: useCases.cancelGoogleImportForConnection,
      cancelImportsForOrganization: useCases.cancelGoogleImportForOrganization,
      preparePropertyDeletion: useCases.prepareGoogleImportPropertyDeletion,
      finalizePropertyDeletion: useCases.finalizeGoogleImportPropertyDeletion,
    }),
    webhook: Object.freeze({ handleNotification: gbpNotificationHandler }),
    worker: Object.freeze({
      registerOutboxConsumers,
      recoverImports: createGoogleImportClaimReaper({
        store: googleImportStore,
        queue: googleImportQueue,
        processItem: async (input) => {
          if (!useCases.processGoogleImportItem)
            throw new Error('Google import processor unavailable')
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
