// Metric context — incremental rollup refresh job handlers
// PRE17C: Replaced REFRESH MATERIALIZED VIEW with incremental rollup
// computation. Only partitions with new data since the last watermark
// are recomputed — O(changed) instead of O(total).
//
// Job names are exported as constants so worker/index.ts and bootstrap.ts
// share a single source of truth.

import type { Job } from 'bullmq'
import type { Database } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import {
  refreshDailyMetricsIncrementally,
  refreshWeeklyMetricsIncrementally,
  refreshDailyInboxMetricsIncrementally,
} from '../incremental-rollup'

export type RefreshRollupDeps = Readonly<{
  db: Database
}>

export const JOB_NAMES = {
  refreshDailyMetrics: 'refresh-daily-metrics',
  refreshWeeklyMetrics: 'refresh-weekly-metrics',
  refreshDailyInboxMetrics: 'refresh-daily-inbox-metrics',
} as const

const refreshFns = {
  dailyMetrics: refreshDailyMetricsIncrementally,
  weeklyMetrics: refreshWeeklyMetricsIncrementally,
  dailyInboxMetrics: refreshDailyInboxMetricsIncrementally,
} as const

export const createRefreshRollupHandler =
  (deps: RefreshRollupDeps, rollupType: keyof typeof refreshFns) => async (_job: Job) => {
    const logger = getLogger()
    const result = await refreshFns[rollupType](deps.db)
    logger.info({ rollupType, result }, 'Incrementally refreshed rollup table')
  }
