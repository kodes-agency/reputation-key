// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import 'dotenv/config'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { createContainer } from '#/composition'
import { bootstrap } from '#/bootstrap'
import { createJobWorker } from '#/shared/jobs/worker'
import { JOB_NAMES } from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { JOB_NAME as HEALTH_CHECK_JOB_NAME } from '#/shared/jobs/health-check.job'
import { JOB_NAME as REFRESH_EXPIRING_JOB_NAME } from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { JOB_NAME as PURGE_EXPIRED_JOB_NAME } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { RECONCILE_GOAL_JOB_NAME as RECONCILE_JOB_NAME } from '#/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job'
import { SPAWN_RECURRING_JOB_NAME as SPAWN_RECURRING_JOB_NAME } from '#/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job'
import type { Worker } from 'bullmq'

function main() {
  const env = getEnv()
  const logger = getLogger()

  logger.info({ env: env.NODE_ENV }, 'Worker starting')

  // Build the dependency container
  const container = createContainer({ enableJobs: true })

  // Register all event handlers and job handlers
  bootstrap(container)

  // Track the worker for graceful shutdown
  let worker: Worker | undefined

  // Start BullMQ worker for the default queue
  if (container.jobQueue) {
    const registry = container.jobRegistry

    // NOTE: All job types (review sync, import, retention) share the 'default' queue.
    // At scale, consider separate queues per job type for isolation.
    // Single queue is acceptable for current traffic levels.
    worker = createJobWorker('default', async (job) => {
      const handler = registry.getHandler(job.name)
      if (!handler) {
        logger.warn({ jobName: job.name, jobId: job.id }, 'no handler registered for job')
        return
      }
      await handler(job)
    })

    if (worker) {
      logger.info('BullMQ worker started, processing jobs from default queue')
    }

    // Schedule health-check job every 5 minutes
    container.jobQueue
      .add(
        HEALTH_CHECK_JOB_NAME,
        {},
        {
          repeat: { every: 5 * 60 * 1000 },
          jobId: 'health-check-recurring',
        },
      )
      .then(() => {
        logger.info('Health-check job scheduled (every 5 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule health-check job (may already exist)')
      })

    // Schedule review retention jobs
    container.jobQueue
      .add(
        REFRESH_EXPIRING_JOB_NAME,
        {},
        {
          repeat: { every: 24 * 60 * 60 * 1000 },
          jobId: 'refresh-expiring-reviews-recurring',
        },
      )
      .then(() => {
        logger.info('Refresh expiring reviews job scheduled (daily)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule refresh-expiring-reviews job')
      })

    container.jobQueue
      .add(
        PURGE_EXPIRED_JOB_NAME,
        {},
        {
          repeat: { every: 24 * 60 * 60 * 1000, offset: 2 * 60 * 60 * 1000 },
          jobId: 'purge-expired-reviews-recurring',
        },
      )
      .then(() => {
        logger.info('Purge expired reviews job scheduled (daily)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule purge-expired-reviews job')
      })

    // ── Metric materialized view refresh jobs ──────────────────────────
    type MetricSchedule = Readonly<{
      jobName: string
      every: number
      label: string
    }>
    const metricSchedules: MetricSchedule[] = [
      { jobName: JOB_NAMES.refreshDailyMetrics, every: 60 * 60 * 1000, label: 'hourly' },
      {
        jobName: JOB_NAMES.refreshWeeklyMetrics,
        every: 24 * 60 * 60 * 1000,
        label: 'daily',
      },
      {
        jobName: JOB_NAMES.refreshDailyInboxMetrics,
        every: 60 * 60 * 1000,
        label: 'hourly',
      },
    ]
    for (const { jobName, every, label } of metricSchedules) {
      container.jobQueue
        .add(jobName, {}, { repeat: { every }, jobId: `${jobName}-recurring` })
        .then(() => logger.info({ jobName, label }, 'Job scheduled'))
        .catch((err: unknown) => logger.warn({ err, jobName }, 'Failed to schedule job'))
    }

    // ── Goal jobs ──────────────────────────────────────────────────
    type GoalSchedule = Readonly<{ jobName: string; every: number; label: string }>
    const goalSchedules: GoalSchedule[] = [
      { jobName: RECONCILE_JOB_NAME, every: 60 * 60 * 1000, label: 'hourly' },
      {
        jobName: SPAWN_RECURRING_JOB_NAME,
        every: 24 * 60 * 60 * 1000,
        label: 'daily',
      },
    ]
    for (const { jobName, every, label } of goalSchedules) {
      container.jobQueue
        .add(jobName, {}, { repeat: { every }, jobId: `${jobName}-recurring` })
        .then(() => logger.info({ jobName, label }, 'Job scheduled'))
        .catch((err: unknown) => logger.warn({ err, jobName }, 'Failed to schedule job'))
    }
  } else {
    logger.warn('No Redis available — worker running without job processing')
  }

  // Graceful shutdown — drain in-progress jobs before exiting
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, draining worker')
    if (worker) {
      try {
        await worker.close()
        logger.info('Worker drained successfully')
      } catch (err) {
        logger.error({ err }, 'Error draining worker')
      }
    }
    if (container.jobQueue) {
      try {
        await container.jobQueue.close()
        logger.info('Queue closed successfully')
      } catch (err) {
        logger.error({ err }, 'Error closing queue')
      }
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main()
