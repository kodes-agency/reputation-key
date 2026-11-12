// Feed context — the recent-activity and operational-history half of the
// composition root; `build.ts` merges it with the notification half.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createRecentActivityRepository } from './infrastructure/recent-activity-repository.drizzle'
import { registerActivityOutboxConsumers } from './infrastructure/activity-outbox-consumers'
import type { OperationalActionHistoryRecordId } from './domain/operational-action-history'
import { createOperationalActionHistoryStore } from './infrastructure/operational-action-history-store'
import { createRecentActivityPrivacyStore } from './infrastructure/recent-activity-privacy-store'
import { redactRecentActivityActorLabels } from './application/use-cases/redact-recent-activity-actor-labels'
import {
  exportOperationalActionHistory,
  listOperationalActionHistory,
  type OperationalHistoryAccessAuthority,
} from './application/use-cases/operational-action-history-access'
import {
  appendOperationalAction,
  assessOperationalActionHistoryRetention,
  getOperationalActionHistoryReadiness,
  placeOperationalActionHistoryLegalHold,
  redactOperationalActionHistorySubject,
  releaseOperationalActionHistoryLegalHold,
} from './application/use-cases/operational-action-history-lifecycle'

export type ActivityBuildInput = Readonly<{
  db: Database
  outboxRepo?: OutboxRepository
  clock: () => Date
  logger: LoggerPort
  operationalHistoryAccessAuthority?: OperationalHistoryAccessAuthority
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
  operationalHistoryHoldIdGen: () => string
}>

export const buildActivityFeed = (input: ActivityBuildInput) => {
  const repo = createRecentActivityRepository(input.db)
  const privacyStore = createRecentActivityPrivacyStore(input.db)
  const operationalHistoryStore = createOperationalActionHistoryStore(input.db)
  const operationalHistoryIdGen = input.operationalHistoryIdGen
  const operationalHistoryLifecycle = {
    store: operationalHistoryStore,
    clock: input.clock,
    idGen: operationalHistoryIdGen,
    holdIdGen: input.operationalHistoryHoldIdGen,
  }
  const operationalHistoryAccess = {
    store: operationalHistoryStore,
    accessAuthority:
      input.operationalHistoryAccessAuthority ??
      ({ isCurrentAccountAdmin: async () => false } as const),
    clock: input.clock,
    idGen: operationalHistoryIdGen,
  }
  const listHistory = listOperationalActionHistory(operationalHistoryAccess)
  const exportHistory = exportOperationalActionHistory(operationalHistoryAccess)

  const publicApi = {
    listOperationalActionHistory: listHistory,
    exportOperationalActionHistory: exportHistory,
  }

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) =>
    registerActivityOutboxConsumers(consumerRegistry, {
      clock: input.clock,
      operationalHistoryDeliveryStore: operationalHistoryStore,
      operationalHistoryIdGen,
    })

  return {
    publicApi,
    worker: Object.freeze({ registerOutboxConsumers }),
    internal: {
      repos: {
        recentActivityRepo: repo,
        operationalActionHistoryStore: operationalHistoryStore,
      },
      useCases: {
        redactRecentActivityActorLabels: redactRecentActivityActorLabels({
          store: privacyStore,
          clock: input.clock,
        }),
        listOperationalActionHistory: listHistory,
        exportOperationalActionHistory: exportHistory,
        appendOperationalAction: appendOperationalAction({
          store: operationalHistoryStore,
          clock: input.clock,
          idGen: operationalHistoryIdGen,
        }),
        getOperationalActionHistoryReadiness: getOperationalActionHistoryReadiness({
          store: operationalHistoryStore,
        }),
        assessOperationalActionHistoryRetention: assessOperationalActionHistoryRetention(
          operationalHistoryLifecycle,
        ),
        placeOperationalActionHistoryLegalHold: placeOperationalActionHistoryLegalHold(
          operationalHistoryLifecycle,
        ),
        releaseOperationalActionHistoryLegalHold:
          releaseOperationalActionHistoryLegalHold(operationalHistoryLifecycle),
        redactOperationalActionHistorySubject: redactOperationalActionHistorySubject(
          operationalHistoryLifecycle,
        ),
      },
    },
  } as const
}
