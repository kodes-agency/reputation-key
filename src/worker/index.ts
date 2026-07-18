// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import 'dotenv/config'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { runCapabilityBootGuard } from '#/shared/auth/capability-boot-guard'
import { createContainer } from '#/composition'
import { bootstrap } from '#/bootstrap'
import { createJobWorker } from '#/shared/jobs/worker'
import { createJobQueue, type Queue } from '#/shared/jobs/queue'
import { createGatedJobHandler } from '#/shared/jobs/delayed-execution-gate'
import { assertJobReadiness } from '#/shared/jobs/readiness'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'
import { createPublishReplyScopeResolver } from '#/contexts/review/infrastructure/jobs/publish-reply-scope-resolver'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { JOB_NAMES } from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { JOB_NAME as HEALTH_CHECK_JOB_NAME } from '#/shared/jobs/health-check.job'
import { JOB_NAME as REFRESH_EXPIRING_JOB_NAME } from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { JOB_NAME as PURGE_EXPIRED_JOB_NAME } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { RECONCILE_GOAL_JOB_NAME as RECONCILE_JOB_NAME } from '#/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job'
import { SPAWN_RECURRING_JOB_NAME as SPAWN_RECURRING_JOB_NAME } from '#/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'
import type { Worker } from 'bullmq'

// fallow-ignore-next-line complexity — worker wires 10+ job schedules, complexity is inherent
async function main() {
  const env = getEnv()
  const logger = getLogger()

  logger.info({ env: env.NODE_ENV }, 'Worker starting')

  // BQC-0.3: refuse boot if test-only capability overrides leak outside an
  // explicit test/CI identity; assert blocked caps; record policy manifest.
  runCapabilityBootGuard(env, logger)

  // Build the dependency container
  const container = createContainer({ enableJobs: true })

  // BQC-2.2: strong read of persisted policy state before any job runs —
  // worker decisions see DB truth from the start (allowlist/suspension).
  await container.refreshPolicyStore()

  // Register all event handlers and job handlers BEFORE starting the BullMQ
  // worker — otherwise early jobs (badge/leaderboard reconciliation fire
  // immediately) arrive with no handler registered yet.
  await bootstrap(container)

  // BQR-2.2: always register durable consumers when outbox is available so
  // the dispatcher is never started with an empty registry. Registration
  // alone does not process work — relay still requires the enable flag.
  if (container.outboxRepo) {
    container.registerOutboxConsumers()
    logger.info('Outbox consumers registered with dispatcher')
  }

  // Track workers for graceful shutdown
  let worker: Worker | undefined
  let backgroundWorker: Worker | undefined

  const registry = container.jobRegistry

  // BQC-3.6: fail the boot on catalogue/runtime mismatch — a missing handler
  // for an enabled job, a stale registered handler, or (only when the durable
  // dispatcher is enabled) an unregistered durable consumer. Readiness
  // failure is a deployment/config error per the failure taxonomy.
  assertJobReadiness(registry, logger, {
    dispatcherEnabled: Boolean(
      container.outboxRepo && env.REDIS_URL && env.OUTBOX_DISPATCHER_ENABLED,
    ),
  })

  // BQC-3.2: dispatch-time scope resolution for jobs whose envelope lacks the
  // property id (publish-reply carries replyId only — resolved via reply →
  // review → propertyId). Every other job name falls through to the payload.
  const resolveScope = createPublishReplyScopeResolver({ db: container.db })

  // BQC-3.6: the dead-letter quarantine queue — created here (same pattern
  // as the domain-events queue below), NEVER processed by a worker. Jobs
  // whose attempt budget is spent land here with a content-safe envelope.
  const quarantineQueue = createJobQueue(QUARANTINE_QUEUE_NAME)

  // ── Default queue — user-facing jobs (import, review sync, reply publish, etc.)
  // Higher concurrency so a single long-running job doesn't block user actions.
  if (container.jobQueue) {
    // BQC-3.2: every job authorizes through the delayed execution gate at
    // dispatch (current policy — a stale allow never overrides a deny).
    worker = createJobWorker(
      'default',
      createGatedJobHandler('default', registry, resolveScope),
      10,
      quarantineQueue,
    )

    if (worker) {
      logger.info('BullMQ worker started on default queue (concurrency: 10)')
    }
  } else {
    logger.warn('No Redis available — default worker not started')
  }

  // ── Background queue — cron-scheduled maintenance jobs ────────────
  // Separate queue so background work (metric refresh, badge/leaderboard
  // reconciliation) never blocks user-facing jobs. Lower concurrency.
  if (container.backgroundQueue) {
    backgroundWorker = createJobWorker(
      'background',
      createGatedJobHandler('background', registry, resolveScope),
      3,
      quarantineQueue,
    )

    if (backgroundWorker) {
      logger.info('BullMQ worker started on background queue (concurrency: 3)')
    }

    // Schedule health-check job every 5 minutes
    container.backgroundQueue
      .add(
        HEALTH_CHECK_JOB_NAME,
        {},
        {
          repeat: { every: 5 * 60 * 1000 },
          jobId: 'health-check-recurring',
          ...jobEnqueueOptions(HEALTH_CHECK_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Health-check job scheduled (every 5 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule health-check job (may already exist)')
      })

    // Schedule review retention jobs
    container.backgroundQueue
      .add(
        REFRESH_EXPIRING_JOB_NAME,
        {},
        {
          // BQC-1.5: hourly bounded sweep with cursor resume — keeps pace
          // with the refresh-due window at target scale (500-row batches,
          // budget 10/run, resumes when budget is exhausted or a run fails).
          repeat: { every: 60 * 60 * 1000 },
          jobId: 'refresh-expiring-reviews-recurring',
          ...jobEnqueueOptions(REFRESH_EXPIRING_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Refresh expiring reviews job scheduled (hourly, BQC-1.5)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule refresh-expiring-reviews job')
      })

    container.backgroundQueue
      .add(
        PURGE_EXPIRED_JOB_NAME,
        {},
        {
          repeat: { every: 24 * 60 * 60 * 1000, offset: 2 * 60 * 60 * 1000 },
          jobId: 'purge-expired-reviews-recurring',
          ...jobEnqueueOptions(PURGE_EXPIRED_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Purge expired reviews job scheduled (daily)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule purge-expired-reviews job')
      })

    // BQC-1.6: bounded retention with content-free evidence, daily (offset
    // from purge so deletion evidence lands after canonical purges).
    container.backgroundQueue
      .add(
        'retention-sweep',
        {},
        {
          repeat: { every: 24 * 60 * 60 * 1000, offset: 3 * 60 * 60 * 1000 },
          jobId: 'retention-sweep-recurring',
          ...jobEnqueueOptions('retention-sweep'),
        },
      )
      .then(() => {
        logger.info('Retention sweep job scheduled (daily)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule retention-sweep job')
      })

    // ── Metric materialized view refresh jobs ──────────────────────────
    type MetricSchedule = Readonly<{
      jobName: string
      every?: number
      pattern?: string
      label: string
    }>
    const metricSchedules: MetricSchedule[] = [
      { jobName: JOB_NAMES.refreshDailyMetrics, pattern: '0 * * * *', label: 'hourly' },
      {
        jobName: JOB_NAMES.refreshWeeklyMetrics,
        every: 24 * 60 * 60 * 1000,
        label: 'daily',
      },
      {
        jobName: JOB_NAMES.refreshDailyInboxMetrics,
        pattern: '5 * * * *',
        label: 'hourly',
      },
    ]
    for (const { jobName, every, pattern, label } of metricSchedules) {
      const repeat = pattern ? { pattern } : { every: every! }
      container.backgroundQueue
        .add(
          jobName,
          {},
          { repeat, jobId: `${jobName}-recurring`, ...jobEnqueueOptions(jobName) },
        )
        .then(() => logger.info({ jobName, label }, 'Job scheduled'))
        .catch((err: unknown) => logger.warn({ err, jobName }, 'Failed to schedule job'))
    }

    // ── Dark-context + outbound-email jobs (BQR-0 containment) ──────
    // Goal / badge / leaderboard / portal are dark for beta. Outbound email
    // is blocked (notification.send_email). Only schedule when the matching
    // capability is globally enabled (core). Non-core allowlists do not
    // re-enable background work until a later promotion path exists.
    type CapabilitySchedule = Readonly<{
      jobName: string
      every?: number
      pattern?: string
      label: string
      capability: 'goal.use' | 'badge.use' | 'leaderboard.use' | 'notification.send_email'
    }>
    const capabilitySchedules: CapabilitySchedule[] = [
      {
        jobName: RECONCILE_JOB_NAME,
        pattern: '10 * * * *',
        label: 'hourly',
        capability: 'goal.use',
      },
      {
        jobName: SPAWN_RECURRING_JOB_NAME,
        every: 24 * 60 * 60 * 1000,
        label: 'daily',
        capability: 'goal.use',
      },
      // Stagger: badge at minute 20, leaderboard at minute 30
      {
        jobName: 'badge.reconcile',
        pattern: '20 * * * *',
        label: 'hourly',
        capability: 'badge.use',
      },
      {
        jobName: 'leaderboard.reconcile',
        pattern: '30 * * * *',
        label: 'hourly',
        capability: 'leaderboard.use',
      },
      // Digest sends outbound email at each property's 8am local window (ADR 0011)
      {
        jobName: 'digest-notification',
        pattern: '0 * * * *',
        label: 'hourly',
        capability: 'notification.send_email',
      },
    ]
    for (const { jobName, every, pattern, label, capability } of capabilitySchedules) {
      if (!isCapabilityJobEnabled(capability)) {
        logger.info(
          { jobName, capability },
          'BQR-0: dark/blocked capability job NOT scheduled',
        )
        continue
      }
      const repeat = pattern ? { pattern } : { every: every! }
      container.backgroundQueue
        .add(
          jobName,
          {},
          { repeat, jobId: `${jobName}-recurring`, ...jobEnqueueOptions(jobName) },
        )
        .then(() => logger.info({ jobName, label, capability }, 'Job scheduled'))
        .catch((err: unknown) => logger.warn({ err, jobName }, 'Failed to schedule job'))
    }
  } else {
    logger.warn('No background queue available — cron jobs not scheduled')
  }

  // ── Outbox relay + dispatcher (PRE17A A3/A4) ─────────────────────
  // BQR-0 CONTAINMENT (still in force through BQR-2 exit): durable dispatch
  // stays off by default. BQR-2.1 fixed the envelope; BQR-2.2 registers
  // consumers on the worker so the registry is not empty when dispatch is
  // enabled. Remaining: atomic producers, no-op consumer bodies (2.3–2.4).
  // Enable only with OUTBOX_DISPATCHER_ENABLED=true in a controlled test
  // environment — not until BQR-2 exit criteria are green.
  let domainEventsWorker: Worker | undefined
  let stopRelay: (() => void) | undefined
  let domainEventsQueue: Queue | undefined

  if (container.outboxRepo && env.REDIS_URL && env.OUTBOX_DISPATCHER_ENABLED) {
    domainEventsQueue = createJobQueue('domain-events')

    if (domainEventsQueue) {
      const relay = createOutboxRelay(container.outboxRepo, domainEventsQueue)
      stopRelay = relay.start(5_000)
      const dispatchHandler = createDispatcherHandler(container.outboxRepo)
      domainEventsWorker = createJobWorker(
        'domain-events',
        dispatchHandler,
        20,
        quarantineQueue,
      )

      if (domainEventsWorker) {
        logger.warn(
          'Outbox relay + dispatcher started — OUTBOX_DISPATCHER_ENABLED is true. ' +
            'This is unsafe until BQR-2 is complete (atomic producers / no-op consumers).',
        )
      }
    }
  } else if (container.outboxRepo && env.REDIS_URL && !env.OUTBOX_DISPATCHER_ENABLED) {
    logger.info(
      'Outbox relay + dispatcher DISABLED (BQR-0 containment). ' +
        'Consumers are registered; events still deliver via in-process bus until BQR-2 exit.',
    )
  } else {
    logger.warn('Outbox relay not started — no outboxRepo or Redis')
  }

  // Graceful shutdown — drain in-progress jobs before exiting
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, draining workers')

    // Stop the outbox relay first (stop claiming new events)
    stopRelay?.()
    logger.info('Outbox relay stopped')

    for (const [label, w] of [
      ['default', worker],
      ['background', backgroundWorker],
      ['domain-events', domainEventsWorker],
    ] as const) {
      if (w) {
        try {
          await w.close()
          logger.info({ queue: label }, 'Worker drained successfully')
        } catch (err) {
          logger.error({ err, queue: label }, 'Error draining worker')
        }
      }
    }
    for (const [label, q] of [
      ['default', container.jobQueue],
      ['background', container.backgroundQueue],
      ['domain-events', domainEventsQueue],
      ['quarantine', quarantineQueue],
    ] as const) {
      if (q) {
        try {
          await q.close()
          logger.info({ queue: label }, 'Queue closed successfully')
        } catch (err) {
          logger.error({ err, queue: label }, 'Error closing queue')
        }
      }
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('Worker failed to start', err)
  process.exit(1)
})
