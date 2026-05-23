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
import type { PropertyFkCleanupPort } from './application/ports/property-fk-cleanup.port'
import { gbpImportJobId, organizationId as toOrgId } from '#/shared/domain/ids'
import { properties } from '#/shared/db/schema/property.schema'
import { randomUUID, createHash } from 'crypto'
// eslint-disable-next-line no-restricted-imports -- wiring layer implements cross-context ports with shared schema
import { and, eq } from 'drizzle-orm'

type IntegrationContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  jobQueue: Queue | undefined
  propertyLookup: PropertyLookupPort
  logger: LoggerPort
}>

export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  // ── Cross-context port implementations (wiring layer) ──────────
  // These implementations query the Property context's tables directly.
  // This is the wiring layer — it has access to the shared DB schema.
  // The application layer only sees the port interfaces.

  const propertyFkCleanup: PropertyFkCleanupPort = {
    clearGoogleConnectionRef: async (orgId, connectionId) => {
      await deps.db
        .update(properties)
        .set({ googleConnectionId: null, updatedAt: new Date() })
        .where(
          and(
            eq(properties.organizationId, orgId),
            eq(properties.googleConnectionId, connectionId),
          ),
        )
    },
  }

  const propertyQuery: PropertyQueryPort = {
    belongsToOrg: async (propertyId, orgId) => {
      const rows = await deps.db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
        .limit(1)
      return rows.length > 0
    },
    findIdsByGoogleConnection: async (connectionId, orgId) => {
      const rows = await deps.db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.googleConnectionId, connectionId),
            eq(properties.organizationId, orgId),
          ),
        )
      return rows.map((r) => r.id)
    },
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
  const propertyImportRepo = createPropertyImportRepository(deps.db)
  const propertyEventPort = createPropertyEventAdapter(deps.events)

  // ── Queue Port ───────────────────────────────────────────────────
  const queuePort: GbpQueuePort = deps.jobQueue
    ? {
        addBulkImportJob: async (data: ImportPropertyJobData) => {
          await deps.jobQueue!.add('import-property', data, {
            jobId: data.jobId,
            removeOnComplete: { count: 100 },
            removeOnFail: { count: 50 },
          })
        },
      }
    : {
        addBulkImportJob: async () => {
          throw new Error('Job queue not available — Redis not configured')
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
