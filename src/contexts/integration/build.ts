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
import type { GbpQueuePort } from './application/ports/gbp-queue.port'
import type { ImportPropertyJobData } from './application/ports/gbp-queue.port'
import type { PropertyQueryPort } from './application/ports/property-query.port'
import type { PropertyFkCleanupPort } from './application/ports/property-fk-cleanup.port'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
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
  listGbpLocations,
  startPropertyImport,
  getImportStatus,
  importProperty,
  getGoogleAuthUrl,
  manageNotifications,
  handleGbpNotification,
} from './application/use-cases'
import type { GetGoogleAuthUrl, HandleGbpNotification } from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGbpCacheRepository } from './infrastructure/repositories/gbp-cache.repository'
import { createGbpImportRepository } from './infrastructure/repositories/gbp-import.repository'
import { createPropertyImportRepository } from './infrastructure/repositories/property-import.repository'
import { createAtomicIntegrationCommandStore } from './infrastructure/integration-command-store'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createGbpApiAdapter } from './infrastructure/adapters/gbp-api.adapter'
import { createMyBusinessNotificationsAdapter } from './infrastructure/adapters/mybusiness-notifications.adapter'
import { createGoogleReviewApiAdapter } from './infrastructure/adapters/google-review-api.adapter'
import { getEnv } from '#/shared/config/env'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import {
  gbpImportJobId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  googleConnectionId as toConnectionId,
} from '#/shared/domain/ids'
import { randomUUID, createHash } from 'crypto'
import type { SourceContentPurge } from '#/contexts/review/application/public-api'
import type { ProviderEndpoints } from '#/shared/routing/processing-router'

type IntegrationContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  jobQueue: Queue | undefined
  propertyApi: PropertyPublicApi
  logger: LoggerPort
  /** BQC-1.7: bounded lifecycle purge of a revoked connection's source
   * content. Constructed once by the composition root (the only layer that
   * may import review infrastructure) and shared across contexts. */
  sourceContentPurge: SourceContentPurge
  /** BQC-4.3: provider endpoint construction config resolved ONCE by the
   * composition root from the cell's logical provider reference
   * (ProcessingTarget.provider). Adapters never hardcode URLs. */
  providerEndpoints: ProviderEndpoints
}>

export type IntegrationContextApi = Readonly<{
  publicApi: Record<string, never>
  internal: Readonly<{
    repos: Readonly<{
      connectionRepo: ReturnType<typeof createGoogleConnectionRepository>
      encryptionPort: ReturnType<typeof createTokenEncryptionAdapter>
      oauthPort: ReturnType<typeof createGoogleOAuthAdapter>
    }>
    /** BQC-5.2: the Google review API adapter (integration-owned), typed by
     * review's port — consumed by the review context build. */
    googleReviewApi: GoogleReviewApiPort
    /** BQC-5.2: webhook binder — the root supplies the review-owned queue at
     * container assembly (review builds after integration). */
    gbpNotificationHandler: (deps: {
      reviewQueue: ReviewQueuePort
    }) => HandleGbpNotification
    useCases: Readonly<{
      connectGoogleAccount: ReturnType<typeof connectGoogleAccount>
      disconnectGoogleAccount: ReturnType<typeof disconnectGoogleAccount>
      listGoogleConnections: ReturnType<typeof listGoogleConnections>
      updateConnectionVisibility: ReturnType<typeof updateConnectionVisibility>
      refreshGoogleToken: ReturnType<typeof refreshGoogleToken>
      listGbpLocations: ReturnType<typeof listGbpLocations>
      startPropertyImport: ReturnType<typeof startPropertyImport>
      getImportStatus: ReturnType<typeof getImportStatus>
      importProperty: ReturnType<typeof importProperty>
      getGoogleAuthUrl: GetGoogleAuthUrl
    }>
  }>
}>

export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  // ── Cross-context port implementations (wiring layer) ──────────
  // Delegated through PropertyPublicApi — no direct schema imports.

  const propertyFkCleanup: PropertyFkCleanupPort = {
    clearGoogleConnectionRef: deps.propertyApi.clearGoogleConnectionRef,
  }

  const propertyQuery: PropertyQueryPort = {
    belongsToOrg: async (propertyId, orgId) =>
      deps.propertyApi.propertyExists(toOrgId(orgId), toPropertyId(propertyId)),
    findIdsByGoogleConnection: async (connectionId, orgId) =>
      deps.propertyApi.findIdsByGoogleConnection(
        toConnectionId(connectionId),
        toOrgId(orgId),
      ),
  }

  // ── Repositories ─────────────────────────────────────────────────
  const connectionRepo = createGoogleConnectionRepository(deps.db, propertyFkCleanup)
  const cacheRepo = createGbpCacheRepository(deps.db, propertyQuery)
  const importRepo = createGbpImportRepository(deps.db, deps.clock)
  // BQC-3.5: every integration state mutation + fact commits atomically here.
  const commandStore = createAtomicIntegrationCommandStore(deps.db, deps.events)

  // ── Adapters ──────────────────────────────────────────────────────
  // BQC-4.3: every Google endpoint comes from the composition-resolved
  // providerEndpoints (the cell's approved provider ref) — nowhere else.
  const oauthPort = createGoogleOAuthAdapter({
    clientId: getEnv().GOOGLE_CLIENT_ID,
    clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
    tokenUrl: deps.providerEndpoints.oauthTokenUrl,
    userInfoUrl: deps.providerEndpoints.oauthUserInfoUrl,
    revokeUrl: deps.providerEndpoints.oauthRevokeUrl,
  })
  const encryptionPort = createTokenEncryptionAdapter(getEnv().ENCRYPTION_KEY)
  const gbpApiPort = createGbpApiAdapter({
    baseUrl: deps.providerEndpoints.gbpApiBaseUrl,
  })
  const notificationsPort = createMyBusinessNotificationsAdapter({
    baseUrl: deps.providerEndpoints.notificationsApiBaseUrl,
  })
  const propertyImportRepo = createPropertyImportRepository(deps.propertyApi)

  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  const queuePort: GbpQueuePort = {
    addBulkImportJob: async (data: ImportPropertyJobData) => {
      await jobQueue.add('import-property', data, {
        jobId: data.jobId,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue.
        ...jobEnqueueOptions('import-property'),
      })
    },
  }

  // ── Use Cases ────────────────────────────────────────────────────
  const refreshGoogleTokenUseCase = refreshGoogleToken({
    connectionRepo,
    oauth: oauthPort,
    encryption: encryptionPort,
    clock: deps.clock,
  })

  const manageNotificationsUseCase = manageNotifications({
    connectionRepo,
    gbpApi: gbpApiPort,
    encryption: encryptionPort,
    refreshGoogleToken: refreshGoogleTokenUseCase,
    notifications: notificationsPort,
    pubsubTopic: getEnv().GBP_PUBSUB_TOPIC,
    notificationTypes: getEnv().GBP_PUBSUB_NOTIFICATION_TYPES.split(',').filter(Boolean),
    clock: deps.clock,
    logger: deps.logger,
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
      cacheRepo,
      commandStore,
      clock: deps.clock,
      logger: deps.logger,
      unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
      sourceContentPurge: deps.sourceContentPurge,
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

    listGbpLocations: listGbpLocations({
      connectionRepo,
      encryption: encryptionPort,
      gbpApi: gbpApiPort,
      clock: deps.clock,
      refreshGoogleToken: refreshGoogleTokenUseCase,
      logger: deps.logger,
      propertyApi: deps.propertyApi,
    }),

    startPropertyImport: startPropertyImport({
      connectionRepo,
      importRepo,
      queue: queuePort,
      events: deps.events,
      clock: deps.clock,
      idGen: () => randomUUID(),
    }),

    getImportStatus: getImportStatus({
      importRepo,
    }),

    importProperty: importProperty({
      importRepo,
      propertyRepo: propertyImportRepo,
      commandStore,
      toJobId: gbpImportJobId,
      toOrgId,
      clock: deps.clock,
      hashFn: (input: string) => createHash('sha256').update(input).digest('base64url'),
      logger: deps.logger,
      onFirstPropertyImported: manageNotificationsUseCase.subscribe,
    }),

    getGoogleAuthUrl: getGoogleAuthUrl({
      clientId: getEnv().GOOGLE_CLIENT_ID,
      callbackUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`,
      stateSecret: getEnv().OAUTH_STATE_SECRET,
      clock: deps.clock,
      idGen: () => randomUUID(),
    }),
  } as const

  // ── Public API — cross-context boundary ─────────────────────────
  const publicApi: Record<string, never> = {}

  // ── Review-facing adapter + webhook binder (BQC-5.2) ────────────
  // The GBP webhook needs to find properties by gbpPlaceId without an
  // organizationId (push-based from Google). Delegates to Property context's
  // public API instead of querying the properties table directly (M4).
  const propertyLookup: PropertyLookupPort = {
    findByGbpPlaceId: deps.propertyApi.findByGbpPlaceId,
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
        encryptionPort,
        oauthPort,
      },
      googleReviewApi,
      gbpNotificationHandler,
      useCases: {
        ...useCases,
      },
    },
  } as const
}
