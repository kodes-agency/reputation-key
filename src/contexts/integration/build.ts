// Integration context — build function.
// Wires integration repos, adapters, use cases, and the GbpQueuePort.
// Per ADR-0001: the composition root calls this and passes useCases to the container.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GbpQueuePort } from './application/ports/gbp-queue.port'
import type { ImportPropertyJobData } from './application/ports/gbp-queue.port'
import type { PropertyQueryPort } from './application/ports/property-query.port'
import type { PropertyFkCleanupPort } from './application/ports/property-fk-cleanup.port'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
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
} from './application/use-cases'
import type { GetGoogleAuthUrl } from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGbpCacheRepository } from './infrastructure/repositories/gbp-cache.repository'
import { createGbpImportRepository } from './infrastructure/repositories/gbp-import.repository'
import { createPropertyImportRepository } from './infrastructure/repositories/property-import.repository'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createGbpApiAdapter } from './infrastructure/adapters/gbp-api.adapter'
import { createMyBusinessNotificationsAdapter } from './infrastructure/adapters/mybusiness-notifications.adapter'
import { createPropertyEventAdapter } from './infrastructure/adapters/property-event.adapter'
import { getEnv } from '#/shared/config/env'
import type { PropertyLookupPort } from './application/ports/property-lookup.port'
import {
  gbpImportJobId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  googleConnectionId as toConnectionId,
} from '#/shared/domain/ids'
import { randomUUID, createHash } from 'crypto'

type IntegrationContextDeps = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox/infrastructure/outbox-repository').OutboxRepository
  clock: () => Date
  jobQueue: Queue | undefined
  propertyLookup: PropertyLookupPort
  propertyApi: PropertyPublicApi
  logger: LoggerPort
}>

export type IntegrationContextApi = Readonly<{
  publicApi: Record<string, never>
  internal: Readonly<{
    repos: Readonly<{
      connectionRepo: ReturnType<typeof createGoogleConnectionRepository>
      encryptionPort: ReturnType<typeof createTokenEncryptionAdapter>
      oauthPort: ReturnType<typeof createGoogleOAuthAdapter>
    }>
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

  // ── Adapters ──────────────────────────────────────────────────────
  const oauthPort = createGoogleOAuthAdapter({
    clientId: getEnv().GOOGLE_CLIENT_ID,
    clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
  })
  const encryptionPort = createTokenEncryptionAdapter(getEnv().ENCRYPTION_KEY)
  const gbpApiPort = createGbpApiAdapter()
  const notificationsPort = createMyBusinessNotificationsAdapter()
  const propertyImportRepo = createPropertyImportRepository(deps.propertyApi)
  const propertyEventPort = createPropertyEventAdapter(deps.events)

  // ── Queue Port ───────────────────────────────────────────────────
  if (!deps.jobQueue) throw new Error('jobQueue required')
  const jobQueue = deps.jobQueue

  const queuePort: GbpQueuePort = {
    addBulkImportJob: async (data: ImportPropertyJobData) => {
      await jobQueue.add('import-property', data, {
        jobId: data.jobId,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
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
      events: deps.events,
      clock: deps.clock,
      idGen: () => randomUUID(),
      callbackUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`,
    }),

    disconnectGoogleAccount: disconnectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      cacheRepo,
      events: deps.events,
      clock: deps.clock,
      logger: deps.logger,
      unsubscribeFromNotifications: manageNotificationsUseCase.unsubscribe,
    }),

    listGoogleConnections: listGoogleConnections({
      connectionRepo,
    }),

    updateConnectionVisibility: updateConnectionVisibility({
      connectionRepo,
      events: deps.events,
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
      events: propertyEventPort,
      eventBus: deps.events,
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

  return {
    publicApi,
    internal: {
      repos: {
        connectionRepo,
        encryptionPort,
        oauthPort,
      },
      useCases: {
        ...useCases,
      },
    },
  } as const
}
