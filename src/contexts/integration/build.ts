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
//   - reviewSync.googleReviewApi — the governed Google review API port, typed by
//     review's GoogleReviewApiPort.
//   - webhook.handleNotification — the authenticated GBP ingress handler.

import type { Database } from '#/shared/db'
import type { GoogleConnectionStatus } from './domain/types'
import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'
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
  type ReviewQueuePort,
  type TargetedGoogleReviewQueuePort,
} from '#/contexts/reputation/public-api'
import { handleGbpNotification } from './review-sync/handle-gbp-notification.server'
import { createImportStore } from './imports/import-store.server'
import { createGoogleImportQueue } from './imports/google-import-queue.server'
import {
  registerGoogleImportDispatchConsumer,
  registerProviderAuthorizationInvalidationConsumer,
} from './imports/google-import-outbox-consumers.server'
import { registerGoogleReviewPushDispatchConsumer } from './review-sync/google-review-push-outbox-consumers.server'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { GoogleDisconnectRevokeStore } from './connections/google-disconnect-revoke.server'
import type { GoogleRefreshCoordination } from './connections/google-refresh-coordination.port.server'
import type { GoogleImportContentAuthorizer } from './imports/google-import-command-authorizer.server'
import { createGoogleImportRuntime } from './imports/import-runtime.server'
import { createGoogleReviewSyncRuntime } from './review-sync/google-review-sync-runtime.server'
import { createGooglePerformanceRuntime } from './performance/google-performance-runtime.server'
import type { PerformanceContentAuthorizer } from './performance/google-performance-authorizer.server'
import type { GoogleReviewSyncContentAuthorizer } from './review-sync/google-review-sync-authorizer.server'
import type { GoogleReplyPublicationContentAuthorizer } from './review-sync/google-reply-publication-authorizer.server'
import { createActiveMemberAuthResolver } from './provider/active-member-auth.adapter.server'
import type { PortalPublicDisplayNameDefaultPublicApi } from '#/contexts/portal/public-api'
import { reconcileGoogleProviderRecovery } from './connections/reconcile-google-provider-recovery.server'

import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
import type { ProviderEphemeralStore } from '#/shared/provider-ephemeral/provider-ephemeral-store'
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
  oauthStateHandles?: OAuthStateHandleService
  oauthCallbackAbuseGate?: OAuthCallbackAbuseGate
  /** Redis-backed, renewable and generation-fenced refresh coordination. */
  googleRefreshCoordination?: GoogleRefreshCoordination
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

  const resolveActiveMember = createActiveMemberAuthResolver(deps.db)

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
    findLinkedPropertyIds: deps.propertyApi.findIdsByGoogleConnection,
    propertyBindingApi: deps.propertyBindingApi,
    executor: deps.googleAuthorizedProviderExecutor,
    authorizeReviewSyncContent: deps.authorizeGoogleReviewSyncContent,
    authorizeReplyPublicationContent: deps.authorizeGoogleReplyPublicationContent,
    providerEphemeralStore: deps.providerEphemeralStore,
    opaqueReferenceKeys: deps.googleOpaqueReferenceKeys,
    pushReferences: googleReviewPushReferences,
  })

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
    pubsubTopic: deps.config.pubsubTopic,
    pubsubNotificationTypes: deps.config.pubsubNotificationTypes,
    authority: googleNotificationAuthority,
  })

  const {
    lifecycle: googleImportLifecycle,
    processor: googleImportProcessor,
    discovery: googleImportDiscovery,
    transaction: googleImportTransaction,
    refreshBoundCategories: refreshBoundGoogleCategories,
  } = createGoogleImportRuntime({
    clock: deps.clock,
    logger: deps.logger,
    newId: deps.idGen,
    connectionRepo,
    tokenProvider: activeConnectionTokenProvider,
    store: googleImportStore,
    propertyApi: deps.propertyApi,
    propertyBindingApi: deps.propertyBindingApi,
    resolveActiveMember,
    providerExecutor: deps.googleAuthorizedProviderExecutor,
    providerTokenAccess: googleProviderTokenAccess,
    references: deps.googleImportReferences,
    replayKeys: deps.googleImportReplayKeys,
    authorizeContent: deps.authorizeGoogleImportContent,
  })

  const { getPropertyGooglePerformance, renewGooglePerformanceLease } =
    createGooglePerformanceRuntime({
      clock: deps.clock,
      logger: deps.logger,
      connectionRepo,
      tokenProvider: activeConnectionTokenProvider,
      providerTokenAccess: googleProviderTokenAccess,
      resolveActiveMember,
      propertyBindingApi: deps.propertyBindingApi,
      executor: deps.googleAuthorizedProviderExecutor,
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

  const findStatus = async (
    orgId: OrganizationId,
    id: GoogleConnectionId,
  ): Promise<GoogleConnectionStatus | null> =>
    (await connectionRepo.findById(orgId, id))?.status ?? null
  const googleConnectionStatus = Object.freeze({ findStatus })

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
      prepareDeparture: connectionCommands.prepareDeparture,
      cancelImportsForUser: googleImportLifecycle.cancelUser,
      resolveActiveMember,
      receipts: deps.outboxRepo,
    })
  }

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
    publicApi: Object.freeze({
      connections: Object.freeze({
        connect: connectionCommands.connect,
        resume: connectionCommands.resume,
        disconnect: connectionCommands.disconnect,
        list: connectionCommands.list,
        findStatus,
      }),
      oauth: Object.freeze({
        getAuthorizationUrl: connections.oauth.authorizationUrl,
        redeemState: connections.oauth.redeemState,
        admitPreState: connections.oauth.admitPreState,
        admitResolvedTenant: connections.oauth.admitResolvedTenant,
      }),
      imports: Object.freeze({
        discover: googleImportDiscovery,
        transact: googleImportTransaction,
        findInitiator: googleImportStore.findPropertyImportInitiator,
      }),
      performance: Object.freeze({
        get: getPropertyGooglePerformance,
        renewLease: renewGooglePerformanceLease,
      }),
    }),
    maintenance: Object.freeze({
      subscribeNotifications: gbpSubscribeBackfill,
      imports: Object.freeze({
        inspectBacklog: googleImportLifecycle.inspectBacklog,
        sweep: googleImportLifecycle.sweep,
      }),
    }),
    webhook: Object.freeze({ handleNotification: gbpNotificationHandler }),
    worker: Object.freeze({
      registerOutboxConsumers,
      recoverImports: createGoogleImportClaimReaper({
        store: googleImportStore,
        queue: googleImportQueue,
        processItem: async (input) => {
          await googleImportProcessor.process(input)
        },
        logger: deps.logger,
        newDeliveryId: deps.idGen,
        clock: deps.clock,
      }),
      completeImportsForRestore: (tx: import('#/shared/outbox/commit').Tx, now: Date) =>
        completeImportsForRestore(tx, googleImportCompletion, now),
      processImportItem: googleImportProcessor.process,
      sweepImportLifecycle: googleImportLifecycle.sweep,
      // The permit sweep's recovery pass, on the stores this build already
      // holds, including a composition-provided disconnect store.
      reconcileProviderRecovery: reconcileGoogleProviderRecovery({
        exchangeRecovery: googleOAuthExchangeRecovery,
        disconnectRevoke: googleDisconnectRevokeStore,
      }),
      reconcileNotificationSubscriptions,
    }),
    // The provider capabilities the Review context consumes.
    reviewSync: Object.freeze({
      googleReviewApi,
      googleConnectionStatus,
      googleReviewPushTargetResolver,
    }),
  }
}
