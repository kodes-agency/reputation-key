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
} from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGbpCacheRepository } from './infrastructure/repositories/gbp-cache.repository'
import { createGbpImportRepository } from './infrastructure/repositories/gbp-import.repository'
import { createPropertyImportRepository } from './infrastructure/repositories/property-import.repository'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createGbpApiAdapter } from './infrastructure/adapters/gbp-api.adapter'
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
  clock: () => Date
  jobQueue: Queue | undefined
  propertyLookup: PropertyLookupPort
  propertyApi: PropertyPublicApi
  logger: LoggerPort
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
  const importRepo = createGbpImportRepository(deps.db)

  // ── Adapters ──────────────────────────────────────────────────────
  const oauthPort = createGoogleOAuthAdapter({
    clientId: getEnv().GOOGLE_CLIENT_ID,
    clientSecret: getEnv().GOOGLE_CLIENT_SECRET,
  })
  const encryptionPort = createTokenEncryptionAdapter(getEnv().ENCRYPTION_KEY)
  const gbpApiPort = createGbpApiAdapter()
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
    }),

    getImportStatus: getImportStatus({
      importRepo,
    }),

    importProperty: importProperty({
      importRepo,
      propertyRepo: propertyImportRepo,
      events: propertyEventPort,
      toJobId: gbpImportJobId,
      toOrgId,
      clock: deps.clock,
      hashFn: (input: string) => createHash('sha256').update(input).digest('base64url'),
      logger: deps.logger,
    }),
  } as const

  return {
    useCases,
    connectionRepo,
    encryptionPort,
    oauthPort,
    refreshGoogleTokenUseCase,
  } as const
}
