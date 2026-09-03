// Metric context — quarantined rollup job handlers.
//
// Job names remain registered so readiness and quarantine tooling can identify
// legacy work while scheduling is denied pending CNV-01 contraction.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'

export const JOB_NAMES = {
  refreshDailyMetrics: 'refresh-daily-metrics',
  refreshWeeklyMetrics: 'refresh-weekly-metrics',
  refreshDailyInboxMetrics: 'refresh-daily-inbox-metrics',
} as const

export const createQuarantinedRollupHandler =
  (jobName: string, logger: Pick<LoggerPort, 'warn'>) =>
  async (_job: Job): Promise<void> => {
    logger.warn(
      { job: jobName },
      'quarantined rollup job invoked; no mutation (CNV-01 contraction pending)',
    )
  }
