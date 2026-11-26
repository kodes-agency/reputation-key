// Feed context — the recent-activity and operational-history half of the
// composition root; `build.ts` merges it with the notification half.

import type { Database } from '#/shared/db'
import type { ConsumerRegistry } from '#/shared/outbox'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { registerActivityOutboxConsumers } from './audit/activity-outbox-consumers.server'
import type { OperationalActionHistoryRecordId } from './domain/operational-action-history'
import { createOperationalActionHistoryStore } from './audit/operational-action-history-store.server'
import {
  exportOperationalActionHistory,
  listOperationalActionHistory,
  type OperationalHistoryAccessAuthority,
} from './audit/operational-action-history-access.server'

export type ActivityBuildInput = Readonly<{
  db: Database
  clock: () => Date
  logger: LoggerPort
  operationalHistoryAccessAuthority: OperationalHistoryAccessAuthority
  operationalHistoryIdGen: () => OperationalActionHistoryRecordId
}>

export const buildActivityFeed = (input: ActivityBuildInput) => {
  const operationalHistoryStore = createOperationalActionHistoryStore(input.db)
  const operationalHistoryIdGen = input.operationalHistoryIdGen
  const operationalHistoryAccess = {
    store: operationalHistoryStore,
    accessAuthority: input.operationalHistoryAccessAuthority,
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
  } as const
}
