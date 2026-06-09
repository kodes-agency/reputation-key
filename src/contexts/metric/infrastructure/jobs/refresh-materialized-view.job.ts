// Metric context — factory for materialized view refresh job handlers
// All metric MV refreshes follow the same pattern: execute REFRESH, log.
// Job names are exported as constants so worker/index.ts and bootstrap.ts
// share a single source of truth.

import type { Job } from 'bullmq'
import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type RefreshMatViewDeps = Readonly<{
  db: Database
}>

const REFRESH_QUERIES: Readonly<Record<string, SQL>> = {
  // F164: CONCURRENTLY avoids locking readers during MV refresh.
  // Requires the MV to have a UNIQUE index; refresh may take longer but won't block reads.
  dailyMetrics: sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_metrics`,
  weeklyMetrics: sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_weekly_metrics`,
  dailyInboxMetrics: sql`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_inbox_metrics`,
}

export const JOB_NAMES = {
  refreshDailyMetrics: 'refresh-daily-metrics',
  refreshWeeklyMetrics: 'refresh-weekly-metrics',
  refreshDailyInboxMetrics: 'refresh-daily-inbox-metrics',
} as const

export const createRefreshMatViewHandler = (
  deps: RefreshMatViewDeps,
  queryKey: keyof typeof REFRESH_QUERIES,
) => {
  const query = REFRESH_QUERIES[queryKey]
  return async (_job: Job) => {
    return trace(`job.refreshMatView.${queryKey}`, async () => {
      const logger = getLogger()
      await deps.db.execute(query)
      logger.info({ queryKey }, 'Refreshed materialized view')
    })
  }
}
