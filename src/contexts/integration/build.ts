// Integration context — build function.
// Wires integration repos, adapters, use cases, and the GbpQueuePort.
// Per ADR-0001: the composition root calls this and passes useCases to the container.
//
// Cross-context contributions exposed to the composition root (BQC-5.2):
//   - internal.googleReviewApi — the Google review API adapter, typed by
//     review's GoogleReviewApiPort (integration owns connection/token/refresh).
//   - internal.gbpNotificationHandler — curried webhook binder; the root
//     supplies the review-owned queue at container assembly.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import type { GoogleImportV2QueuePort } from './application/ports/gbp-queue.port'
import type { GoogleOAuthPort } from './application/ports/google-oauth.port'
import type { OAuthStateHandleService } from './application/oauth-state-handle'
import type { OAuthCallbackAbuseGate } from './application/oauth-callback-abuse-gate'
import type { GbpApiPort } from './application/ports/gbp-api.port'
import type { GoogleAuthorizedProviderExecutor } from './application/ports/google-authorized-provider-executor.port'
import type { GoogleImportReferenceStore } from './application/ports/google-import-reference-store.port'
import type { PropertyFkCleanupPort } from './application/ports/property-fk-cleanup.port'
import type {
  PropertyGoogleBindingPublicApi,
  PropertyPublicApi,
} from '#/contexts/property/application/public-api'
import type {
  GoogleReviewApiPort,
  ReviewQueuePort,
} from '#/contexts/review/application/public-api'
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  listGoogleConnections,
  updateConnectionVisibility,
  refreshGoogleToken,
  getGoogleAuthUrl,
  manageNotifications,
  handleGbpNotification,
} from './application/use-cases'
import type { HandleGbpNotification } from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGoogleImportV2Store } from './infrastructure/google-import-v2-store'
import { createImportItemRoutingLoader } from './infrastructure/import-item-routing.adapter'
import { createAtomicIntegrationCommandStore } from './infrastructure/integration-command-store'
import { registerGoogleImportDispatchConsumer } from './infrastructure/outbox-consumers'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { GOOGLE_PROPERTY_IMPORT_ITEM_JOB } from './application/google-import-v2-contract'
import { createCredentialLifecycleRepository } from './infrastructure/repositories/credential-lifecycle.repository'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createGbpApiAdapter } from './infrastructure/adapters/gbp-api.adapter'
import { createMyBusinessNotificationsAdapter } from './infrastructure/adapters/mybusiness-notifications.adapter'
import { createGoogleReviewApiAdapter } from './infrastructure/adapters/google-review-api.adapter'
import { createGoogleAccountManagementAdapter } from './infrastructure/adapters/google-account-management.adapter'
import { createGoogleBusinessInformationAdapter } from './infrastructure/adapters/google-business-information.adapter'
import { createActiveConnectionTokenProvider } from './application/active-connection-token-provider'
import {
  createGoogleImportCommandAuthorizer,
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
import { createGooglePerformanceAdapter } from './infrastructure/adapters/google-performance.adapter'
import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { createActiveMemberAuthResolver } from './infrastructure/active-member-auth.adapter'
import { getEnv } from '#/shared/config/env'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'
import { randomUUID } from 'node:crypto'

import type { VersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import type { ProviderAuthorizationLeaseService } from '#/shared/provider-ephemeral/authorization-lease'
type IntegrationContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  jobQueue: Queue | undefined
  propertyApi: PropertyPublicApi
  propertyBindingApi?: PropertyGoogleBindingPublicApi
  logger: LoggerPort
  /** BQC-1.7: bounded lifecycle purge of a revoked connection's source
   * content. Constructed once by the composition root (the only layer that
   * may import review infrastructure) and shared across contexts. */
  sourceContentPurge: SourceContentPurge
  /** BQC-4.3: provider endpoint construction config resolved ONCE by the
   * composition root from the cell's logical provider reference
   * (ProcessingTarget.provider). Adapters never hardcode URLs. */
  providerEndpoints: ProviderEndpoints
  /** BQC-6.1: optional deterministic adapter overrides (simulations/tests
   * inject in-memory providers; absent = the real env-driven HTTP adapters). */
  googleOAuth?: GoogleOAuthPort
  gbpApi?: GbpApiPort
  googleAuthorizedProviderExecutor?: GoogleAuthorizedProviderExecutor
  googleImportReferences?: GoogleImportReferenceStore
  authorizeGoogleImportContent?: GoogleImportContentAuthorizer
  googleImportReplayKeys?: VersionedHmacKeyring
  authorizeGooglePerformanceContent?: PerformanceContentAuthorizer
  googlePerformancePrincipalKeys?: VersionedHmacKeyring
  providerAuthorizationLeases?: ProviderAuthorizationLeaseService
  oauthStateHandles?: OAuthStateHandleService
  oauthCallbackAbuseGate?: OAuthCallbackAbuseGate
}>

export type IntegrationContextApi = Readonly<{
  publicApi: Record<string, never>
  internal: Readonly<{
    repos: Readonly<{
      connectionRepo: ReturnType<typeof createGoogleConnectionRepository>
      encryptionPort: ReturnType<typeof createTokenEncryptionAdapter>
      oauthPort: ReturnType<typeof createGoogleOAuthAdapter>
      /** BQC-6.1: exposed (like oauthPort) so build-level tests can prove
       * provider overrides are honored. */
      credentialLifecycle: ReturnType<typeof createCredentialLifecycleRepository>
      gbpApiPort: GbpApiPort
      loadImportItemRouting: ReturnType<typeof createImportItemRoutingLoader>
    }>
    /** BQC-5.2: the Google review API adapter (integration-owned), typed by
     * review's port — consumed by the review context build. */
    googleReviewApi: GoogleReviewApiPort
    /** BQC-5.2: webhook binder — the root supplies the review-owned queue at
     * container assembly (review builds after integration). */
    gbpNotificationHandler: (deps: {
      reviewQueue: ReviewQueuePort
    }) => HandleGbpNotification
    registerOutboxConsumers: () => void
    useCases: Readonly<{
      connectGoogleAccount: ReturnType<typeof connectGoogleAccount>
      disconnectGoogleAccount: ReturnType<typeof disconnectGoogleAccount>
      listGoogleConnections: ReturnType<typeof listGoogleConnections>
      updateConnectionVisibility: ReturnType<typeof updateConnectionVisibility>
      refreshGoogleToken: ReturnType<typeof refreshGoogleToken>
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
        | ReturnType<typeof createGoogleImportV2Lifecycle>['sweep']
        | null
      inspectGoogleImportV2Lifecycle:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['inspectBacklog']
        | null
      inspectGoogleImportV2LifecycleScope:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['inspectScope']
        | null
      cancelGoogleImportV2ForConnection:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['cancelConnection']
        | null
      cancelGoogleImportV2ForUser:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['cancelUser']
        | null
      cancelGoogleImportV2ForOrganization:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['cancelOrganization']
        | null
      prepareGoogleImportV2PropertyDeletion:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['preparePropertyDeletion']
        | null
      finalizeGoogleImportV2PropertyDeletion:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['finalizePropertyDeletion']
        | null
      cancelGoogleImportV2Request:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['cancelRequest']
        | null
      inspectGoogleImportV2Request:
        | ReturnType<typeof createGoogleImportV2Lifecycle>['inspectRequest']
        | null
    }>
  }>
}>

export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  // ── Cross-context port implementations (wiring layer) ──────────
  // Delegated through PropertyPublicApi — no direct schema imports.

  const propertyFkCleanup: PropertyFkCleanupPort = {
    clearGoogleConnectionRef: deps.propertyApi.clearGoogleConnectionRef,
  }

  // ── Repositories ─────────────────────────────────────────────────
  const connectionRepo = createGoogleConnectionRepository(deps.db, propertyFkCleanup)
  // BQC-3.5: every integration state mutation + fact commits atomically here.
  const credentialLifecycle = createCredentialLifecycleRepository(deps.db)
  const commandStore = createAtomicIntegrationCommandStore(deps.db, deps.events)

  // ── Adapters ──────────────────────────────────────────────────────
  // BQC-4.3: every Google endpoint comes from the composition-resolved
  // providerEndpoints (the cell's approved provider ref) — nowhere else.
  // BQC-6.1: injected provider overrides win; absent slots build the real
  // env-driven adapters exactly as before.
  const oauthPort =
    deps.googleOAuth ??
    createGoogleOAuthAdapter({
      clientId: getEnv().GOOGLE_CLIENT_ID,
      clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
      tokenUrl: deps.providerEndpoints.oauthTokenUrl,
      jwksUrl: deps.providerEndpoints.oauthJwksUrl,
      revokeUrl: deps.providerEndpoints.oauthRevokeUrl,
    })
  const encryptionPort = createTokenEncryptionAdapter(getEnv().ENCRYPTION_KEY)
  const gbpApiPort =
    deps.gbpApi ??
    createGbpApiAdapter({
      baseUrl: deps.providerEndpoints.gbpAccountManagementBaseUrl,
    })
  const notificationsPort = createMyBusinessNotificationsAdapter({
    baseUrl: deps.providerEndpoints.notificationsApiBaseUrl,
  })
  const loadImportItemRouting = createImportItemRoutingLoader({ db: deps.db })

  const googleImportV2Store = createGoogleImportV2Store(deps.db)
  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  const googleImportV2Queue: GoogleImportV2QueuePort = {
    addImportItemJobs: async (jobs) => {
      if (jobs.length === 0) return
      const options = jobEnqueueOptions(GOOGLE_PROPERTY_IMPORT_ITEM_JOB)
      await jobQueue.addBulk(
        jobs.map((job) => {
          const execution = createJobExecutionEnvelope({
            organizationId: job.organizationId,
            capability: 'property.import_gbp_v2',
            initiator: {
              kind: 'system',
              id: 'outbox:google-property-import-dispatch',
            },
          })
          return {
            name: GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
            data: { ...job, ...execution },
            opts: {
              jobId: job.jobId,
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 50 },
              ...options,
            },
          }
        }),
      )
    },
  }

  const registerOutboxConsumers = () =>
    registerGoogleImportDispatchConsumer({
      store: googleImportV2Store,
      queue: googleImportV2Queue,
      receipts: createOutboxRepository(deps.db),
    })

  // ── Use Cases ────────────────────────────────────────────────────
  const refreshGoogleTokenUseCase = refreshGoogleToken({
    connectionRepo,
    oauth: oauthPort,
    encryption: encryptionPort,
    clock: deps.clock,
  })

  const manageNotificationsUseCase = manageNotifications({
    connectionRepo,
    encryption: encryptionPort,
    refreshGoogleToken: refreshGoogleTokenUseCase,
    gbpApi: gbpApiPort,
    notifications: notificationsPort,
    pubsubTopic: getEnv().GBP_PUBSUB_TOPIC,
    notificationTypes: getEnv().GBP_PUBSUB_NOTIFICATION_TYPES.split(',').filter(Boolean),
    clock: deps.clock,
    logger: deps.logger,
  })

  let googleImportDiscovery: ReturnType<typeof createGoogleImportDiscovery> | null = null
  let googleImportTransaction: ReturnType<typeof createGoogleImportTransaction> | null =
    null
  let googleImportV2Processor: GoogleImportV2Processor | null = null
  const googleImportV2Lifecycle = deps.propertyBindingApi
    ? createGoogleImportV2Lifecycle({
        store: googleImportV2Store,
        propertyBindingApi: deps.propertyBindingApi,
        clock: deps.clock,
        newEventId: randomUUID,
        references: deps.googleImportReferences,
      })
    : null
  const sweepGoogleImportV2Lifecycle = googleImportV2Lifecycle?.sweep ?? null
  if (deps.propertyBindingApi) {
    const propertyBindingApi = deps.propertyBindingApi
    const decideGoogleImport = (
      request: Parameters<ReturnType<typeof getExecutionPolicy>['decide']>[0],
    ) => getExecutionPolicy().decide(request)
    const activeConnectionTokenProvider = createActiveConnectionTokenProvider({
      connectionRepo,
      encryption: encryptionPort,
      clock: deps.clock,
      refreshGoogleToken: refreshGoogleTokenUseCase,
    })
    const authorizeGoogleImportCommand = createGoogleImportCommandAuthorizer({
      connectionRepo,
      tokenProvider: activeConnectionTokenProvider,
      decide: decideGoogleImport,
      authorizeGoogleContent:
        deps.authorizeGoogleImportContent ??
        (async () => ({ ok: false as const, code: 'runtime_unavailable' as const })),
      readProperty: async (organizationId, propertyId) => {
        const property = await propertyBindingApi.readInternal(organizationId, propertyId)
        return property
          ? {
              propertyId: property.propertyId,
              sourceEpoch: property.sourceEpoch,
              profileVersion: property.profileVersion,
              lifecycleState: property.lifecycleState,
              deletedAt: property.deletedAt,
            }
          : null
      },
      clock: deps.clock,
    })
    googleImportV2Processor = createGoogleImportV2Processor({
      store: googleImportV2Store,
      propertyBindingApi,
      authorizeGoogleImportCommand,
      resolveActor: createActiveMemberAuthResolver(deps.db),
      clock: deps.clock,
      newClaimFence: randomUUID,
    })
    if (deps.googleAuthorizedProviderExecutor && deps.googleImportReferences) {
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
          executor: deps.googleAuthorizedProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        locations: createGoogleBusinessInformationAdapter({
          executor: deps.googleAuthorizedProviderExecutor,
          nowMs: () => deps.clock().getTime(),
        }),
        nowMs: () => deps.clock().getTime(),
      })
    }
    if (deps.googleImportReferences && deps.googleImportReplayKeys) {
      googleImportTransaction = createGoogleImportTransaction({
        store: googleImportV2Store,
        references: deps.googleImportReferences,
        propertyBindingApi,
        authorizeGoogleImportCommand,
        replayKeys: deps.googleImportReplayKeys,
        clock: deps.clock,
        idGen: randomUUID,
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
    })
    const source = createGooglePerformanceAdapter({
      executor: deps.googleAuthorizedProviderExecutor,
      nowMs: () => deps.clock().getTime(),
    })
    getPropertyGooglePerformance = createGetPropertyGooglePerformance({
      authorize,
      fetchReport: (input, actor, snapshot, accessToken) =>
        source.fetchReport(input, accessToken, {
          capability: 'property.read_gbp_performance',
          organizationId: snapshot.organizationId,
          propertyId: snapshot.propertyId,
          connectionId: snapshot.connectionId,
          initiatorUserId: actor.userId,
          approvalBindingId: snapshot.approvalBindingId,
          authorizationVector: snapshot.authorizationVector,
        }),
      issueLease: ({ snapshot, absoluteDeadlineMs, nowMs }) =>
        deps.providerAuthorizationLeases!.issue({
          audience: 'performance',
          capability: 'property.read_gbp_performance',
          organizationId: snapshot.organizationId,
          propertyId: snapshot.propertyId,
          connectionId: snapshot.connectionId,
          approvalBindingId: snapshot.approvalBindingId,
          principalHmacKeyVersion: snapshot.principalHmacKeyVersion,
          principalHmac: snapshot.principalHmac,
          authorizationVectorSha256: snapshot.authorizationVectorSha256,
          absoluteDeadlineMs,
          nowMs,
        }),
      clock: deps.clock,
    })
    renewGooglePerformanceLease = createRenewGooglePerformanceLease({
      authorize,
      renew: deps.providerAuthorizationLeases.renew,
      clock: deps.clock,
    })
  }

  const oauthCallbackAbuseGate =
    deps.oauthCallbackAbuseGate ??
    Object.freeze({
      admitPreState: async () =>
        getEnv().NODE_ENV === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
      admitResolvedTenant: async () =>
        getEnv().NODE_ENV === 'production'
          ? ({ ok: false, code: 'quota_unavailable' } as const)
          : ({ ok: true } as const),
    })
  if (!deps.oauthStateHandles) {
    throw new Error('Opaque OAuth state service is required')
  }
  const getOpaqueGoogleAuthUrl = getGoogleAuthUrl({
    clientId: getEnv().GOOGLE_CLIENT_ID,
    callbackUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`,
    clock: deps.clock,
    stateHandles: deps.oauthStateHandles,
  })

  const useCases = {
    connectGoogleAccount: connectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      commandStore,
      clock: deps.clock,
      idGen: () => randomUUID(),
      callbackUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`,
    }),

    disconnectGoogleAccount: disconnectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      commandStore,
      clock: deps.clock,
      logger: deps.logger,
      unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
      sourceContentPurge: deps.sourceContentPurge,
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

    updateConnectionVisibility: updateConnectionVisibility({
      connectionRepo,
      commandStore,
      clock: deps.clock,
    }),

    refreshGoogleToken: refreshGoogleTokenUseCase,

    googleImportDiscovery,
    googleImportTransaction,
    processGoogleImportV2Item: googleImportV2Processor?.process ?? null,
    getPropertyGooglePerformance,
    renewGooglePerformanceLease,
    sweepGoogleImportV2Lifecycle,
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

  // ── Public API — cross-context boundary ─────────────────────────
  const publicApi: Record<string, never> = {}

  // ── Review-facing adapter + webhook binder (BQC-5.2) ────────────
  // The JWT-verified GBP webhook may resolve the canonical location ID without
  // an organization ID. The lookup still delegates through the Property public API.
  const propertyLookup: PropertyLookupPort = {
    findByGbpLocationId: deps.propertyApi.findByGbpLocationId,
  }

  // Integration owns the Google review API adapter (connection repo + token
  // encryption + refresh); the review context consumes it via its port.
  const googleReviewApi: GoogleReviewApiPort = createGoogleReviewApiAdapter({
    connectionRepo,
    encryption: encryptionPort,
    refreshToken: refreshGoogleTokenUseCase,
    logger: deps.logger,
    baseUrl: deps.providerEndpoints.reviewsApiBaseUrl,
  })

  // The review queue is review-owned and builds after integration — the
  // composition root supplies it at container assembly.
  const gbpNotificationHandler = (handlerDeps: { reviewQueue: ReviewQueuePort }) =>
    handleGbpNotification({
      propertyLookup,
      reviewQueue: handlerDeps.reviewQueue,
      logger: deps.logger,
    })

  return {
    publicApi,
    internal: {
      repos: {
        connectionRepo,
        credentialLifecycle,
        encryptionPort,
        oauthPort,
        gbpApiPort,
        loadImportItemRouting,
      },
      googleReviewApi,
      gbpNotificationHandler,
      registerOutboxConsumers,
      useCases: {
        ...useCases,
      },
    },
  }
}
