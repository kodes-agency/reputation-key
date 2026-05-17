// Integration context — build function.
// Wires integration repos, adapters, use cases, and the GbpQueuePort.
// Per ADR-0001: the composition root calls this and passes useCases to the container.

import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { GbpQueuePort } from './application/ports/gbp-queue.port'
import type { ImportPropertyJobData } from './application/ports/gbp-queue.port'
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  listGoogleConnections,
  updateConnectionVisibility,
  refreshGoogleToken,
  listGbpLocations,
  startPropertyImport,
  getImportStatus,
} from './application/use-cases'
import { createGoogleConnectionRepository } from './infrastructure/repositories/google-connection.repository'
import { createGbpCacheRepository } from './infrastructure/repositories/gbp-cache.repository'
import { createGbpImportRepository } from './infrastructure/repositories/gbp-import.repository'
import { createGoogleOAuthAdapter } from './infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from './infrastructure/adapters/token-encryption.adapter'
import { createGbpApiAdapter } from './infrastructure/adapters/gbp-api.adapter'
import { getEnv } from '#/shared/config/env'

type IntegrationContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  jobQueue: Queue | undefined
}>

export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  // ── Repositories ─────────────────────────────────────────────────
  const connectionRepo = createGoogleConnectionRepository(deps.db)
  const cacheRepo = createGbpCacheRepository(deps.db)
  const importRepo = createGbpImportRepository(deps.db)

  // ── Adapters ──────────────────────────────────────────────────────
  const oauthPort = createGoogleOAuthAdapter()
  const encryptionPort = createTokenEncryptionAdapter()
  const gbpApiPort = createGbpApiAdapter()

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
  })

  const useCases = {
    connectGoogleAccount: connectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      events: deps.events,
      clock: deps.clock,
      callbackUrl: `${getEnv().BETTER_AUTH_URL}/api/auth/google/callback`,
    }),

    disconnectGoogleAccount: disconnectGoogleAccount({
      connectionRepo,
      oauth: oauthPort,
      encryption: encryptionPort,
      cacheRepo,
      events: deps.events,
      clock: deps.clock,
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
      refreshGoogleToken: refreshGoogleTokenUseCase,
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
  } as const

  return { useCases, connectionRepo, encryptionPort, oauthPort, refreshGoogleTokenUseCase } as const
}
