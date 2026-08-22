// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import 'dotenv/config'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { runCapabilityBootGuard } from '#/shared/auth/capability-boot-guard'
import { assertProductionSecrets } from '#/shared/config/production-secrets'
import { assertReleaseIdentity } from '#/shared/config/release-identity'
import {
  assertRestoreModeCompatible,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
} from '#/shared/config/restore-mode'
import { createContainer } from '#/composition'
import { bootstrap } from '#/bootstrap'
import {
  BACKGROUND_QUEUE_CONCURRENCY,
  createJobWorker,
  DEFAULT_QUEUE_CONCURRENCY,
} from '#/shared/jobs/worker'
import { createJobQueue, type Queue } from '#/shared/jobs/queue'
import {
  createGatedJobHandler,
  type JobRoutingGate,
} from '#/shared/jobs/delayed-execution-gate'
import { assertJobReadiness } from '#/shared/jobs/readiness'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { drainWorkerResources, namedCloseable } from './drain'
import {
  QUARANTINE_QUEUE_NAME,
  quarantineJobDirect,
} from '#/shared/jobs/failure-quarantine'
import { createPublishReplyScopeResolver } from '#/contexts/review/infrastructure/jobs/publish-reply-scope-resolver'
import { createProcessingRouter } from '#/shared/routing/processing-router'
import { createPropertyRoutingLoader } from '#/contexts/property/infrastructure/property-routing.adapter'
import { createImportItemRoutingLoader } from '#/contexts/integration/infrastructure/import-item-routing.adapter'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { JOB_NAMES } from '#/contexts/metric/infrastructure/jobs/refresh-materialized-view.job'
import { JOB_NAME as HEALTH_CHECK_JOB_NAME } from '#/shared/jobs/health-check.job'
import { JOB_NAME as REFRESH_EXPIRING_JOB_NAME } from '#/contexts/review/infrastructure/jobs/refresh-expiring-reviews.job'
import { JOB_NAME as DISCOVER_NEW_REVIEWS_JOB_NAME } from '#/contexts/review/infrastructure/jobs/discover-new-reviews.job'
import { JOB_NAME as PURGE_EXPIRED_JOB_NAME } from '#/contexts/review/infrastructure/jobs/purge-expired-reviews.job'
import { JOB_NAME as RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME } from '#/contexts/notification/infrastructure/jobs/reconcile-missing-notifications.job'
import { JOB_NAME as QUARANTINE_TTL_SWEEP_JOB_NAME } from '#/shared/jobs/quarantine-ttl-sweep.job'
import { JOB_NAME as PERMIT_START_DEADLINE_SWEEP_JOB_NAME } from '#/shared/jobs/permit-start-deadline-sweep.job'
import { JOB_NAME as GOOGLE_IMPORT_CLAIM_REAPER_JOB_NAME } from '#/contexts/integration/infrastructure/jobs/google-import-claim-reaper.job'
import { JOB_NAME as AI_EXECUTION_REAPER_JOB_NAME } from '#/shared/jobs/ai-operation-execution-reaper.job'
import { JOB_NAME as AI_BACKFILL_ADVANCE_JOB_NAME } from '#/shared/jobs/ai-review-analysis-backfill-advance.job'
import { JOB_NAME as RECONCILE_AMBIGUOUS_JOB_NAME } from '#/contexts/review/infrastructure/jobs/reconcile-ambiguous-publications.job'
import { isCapabilityJobEnabled } from '#/shared/auth/beta-capabilities'
import { SCHEDULE_PROPERTY_TRENDS_JOB_NAME } from '#/contexts/ai/infrastructure/jobs/schedule-property-trends.job'
import type { Worker } from 'bullmq'

// Worker entry wires 10+ job schedules — complexity is inherent to the
// registration seam. Owner: BQC-3 (returned by BQC-5.7).
// fallow-ignore-next-line complexity
async function main() {
  const env = getEnv()
  assertReleaseIdentity(env)
  const logger = getLogger()

  logger.info({ env: env.NODE_ENV, releaseSha: getReleaseSha(env) }, 'Worker starting')

  // BQC-0.3: refuse boot if test-only capability overrides leak outside an
  // explicit test/CI identity; assert blocked caps; record policy manifest.
  runCapabilityBootGuard(env, logger)

  // BQC-7.6: refuse boot when a known placeholder/test secret leaks into
  // production (web process runs the same assertion as a nitro plugin).
  assertProductionSecrets(env)

  // BQC-7.8: the restore drill is web + ops commands only — in
  // restore-isolated mode the worker REFUSES to boot (no schedules, no
  // BullMQ consumers, no outbox relay, no external effects, by
  // construction). Web runs the same assertion as a nitro plugin.
  if (isRestoreIsolated(env)) {
    logger.warn(RESTORE_ISOLATED_LOG_LINE)
  }
  assertRestoreModeCompatible(env, 'worker')

  // Build the dependency container
  const container = createContainer({ enableJobs: true })

  // BQC-2.2: strong read of persisted policy state before any job runs —
  // worker decisions see DB truth from the start (allowlist/suspension).
  await container.refreshPolicyStore()
  // Review provider-subject writers may start only after the decoded worker
  // key set exactly matches the database's masked active/rotation inventory.
  await container.refreshReviewProviderSubjectKeys()

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

  // BQC-7.3 (worker.*): registered-job count + runtime version at boot —
  // deployment/config drift shows up here before any job runs.
  logger.info(
    { registeredJobs: registry.getAll().size, runtimeVersion: process.version },
    'worker runtime ready',
  )

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

  // BQC-4.2: the worker declares its processing cell (PROCESSING_CELL, ADR
  // 0048 — 'us' is the only approved beta cell). The routing gate re-resolves
  // each property-scoped job's CURRENT routing at dispatch; blocked or
  // wrong-cell jobs are quarantined directly (fail closed, no retry burn).
  const processingCell = env.PROCESSING_CELL
  const routingGate: JobRoutingGate = {
    router: createProcessingRouter({
      loadPropertyRouting: createPropertyRoutingLoader({ db: container.db }),
      loadImportItemRouting: createImportItemRoutingLoader({ db: container.db }),
      cell: processingCell,
    }),
    cell: processingCell,
    quarantine: async (job, policyReason) => {
      // Undefined only when Redis is absent — but then no worker starts, so
      // this callback is unreachable; the guard is for the type.
      if (!quarantineQueue) return
      await quarantineJobDirect(quarantineQueue, job, policyReason)
    },
  }

  // ── Default queue — user-facing jobs (import, review sync, reply publish, etc.)
  // Concurrency is budgeted against the connection pool, NOT maximized:
  // DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB <= pool max.
  // A Google-import item holds its fenced `FOR UPDATE` transaction while the
  // nested Property effect opens a second one, so a concurrency equal to the
  // pool max lets every slot hold a client and deadlock on the nested
  // acquisition. See the invariant on the constants in shared/jobs/worker.
  if (container.jobQueue) {
    // BQC-3.2: every job authorizes through the delayed execution gate at
    // dispatch (current policy — a stale allow never overrides a deny).
    worker = createJobWorker(
      'default',
      createGatedJobHandler('default', registry, resolveScope, routingGate),
      DEFAULT_QUEUE_CONCURRENCY,
      quarantineQueue,
    )

    if (worker) {
      logger.info(
        { concurrency: DEFAULT_QUEUE_CONCURRENCY },
        'BullMQ worker started on default queue',
      )
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
      createGatedJobHandler('background', registry, resolveScope, routingGate),
      BACKGROUND_QUEUE_CONCURRENCY,
      quarantineQueue,
    )

    if (backgroundWorker) {
      logger.info(
        { concurrency: BACKGROUND_QUEUE_CONCURRENCY },
        'BullMQ worker started on background queue',
      )
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

    // New-review discovery sweep. The refresh sweep above only revisits
    // reviews ALREADY stored and only inside their 5-day pre-expiry window,
    // so it can never find a review that does not exist locally yet. 15
    // minutes is the fixed firing cadence — the granularity at which a
    // property's own poll interval (REVIEW_DISCOVERY_INTERVAL_MINUTES,
    // default 15) can come due. Bounded at 200 properties × 10 batches per
    // firing, so the cadence never becomes the scaling limit.
    container.backgroundQueue
      .add(
        DISCOVER_NEW_REVIEWS_JOB_NAME,
        {},
        {
          repeat: { every: 15 * 60 * 1000 },
          jobId: 'discover-new-reviews-recurring',
          ...jobEnqueueOptions(DISCOVER_NEW_REVIEWS_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Discover new reviews job scheduled (every 15 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule discover-new-reviews job')
      })

    // Notification-gap healing sweep. `emitAfterCommit` is best-effort, so a
    // throw in the inbox or notification handler leaves a committed review
    // with no notification and nothing retrying; this is what retries. 10
    // minutes is the fixed firing cadence — comfortably wider than the job's
    // 5-minute grace edge, so a firing never races the happy path it is
    // checking up on. Bounded at 100 items x 5 batches per firing.
    container.backgroundQueue
      .add(
        RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME,
        {},
        {
          repeat: { every: 10 * 60 * 1000 },
          jobId: 'reconcile-missing-notifications-recurring',
          ...jobEnqueueOptions(RECONCILE_MISSING_NOTIFICATIONS_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Reconcile missing notifications job scheduled (every 10 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule reconcile-missing-notifications job')
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

    // BQC-3.8: reconcile ambiguous reply publications every 30 minutes. A row
    // becomes due 15 minutes after the final ambiguous send attempt
    // (reconcile_due_at); the sweep heals provider-confirmed rows to
    // published and leaves the rest for operator retry.
    container.backgroundQueue
      .add(
        RECONCILE_AMBIGUOUS_JOB_NAME,
        {},
        {
          repeat: { every: 30 * 60 * 1000 },
          jobId: 'reconcile-ambiguous-publications-recurring',
          ...jobEnqueueOptions(RECONCILE_AMBIGUOUS_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Reconcile ambiguous publications job scheduled (every 30 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule reconcile-ambiguous-publications job')
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

    // BQC-7.8: dead-letter quarantine TTL bound, daily (offset after the
    // retention sweep). Removes quarantined entries older than
    // QUARANTINE_TTL_DAYS via job.remove() — never obliterate/clean.
    container.backgroundQueue
      .add(
        QUARANTINE_TTL_SWEEP_JOB_NAME,
        {},
        {
          repeat: { every: 24 * 60 * 60 * 1000, offset: 4 * 60 * 60 * 1000 },
          jobId: 'quarantine-ttl-sweep-recurring',
          ...jobEnqueueOptions(QUARANTINE_TTL_SWEEP_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Quarantine TTL sweep job scheduled (daily)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule quarantine-ttl-sweep job')
      })

    // Execution-permit start-deadline fence, every 5 minutes. `admitted` has
    // exactly two other exits — a caller actually starting the permit (which
    // detects `start_deadline_elapsed` lazily) and the emergency-kill drain — so
    // an abandoned admission otherwise stays `admitted` forever, pinning its
    // ON DELETE RESTRICT approval binding and inflating the active-permit index.
    // Cadence is well under the approval-rotation window and each run is
    // batch-bounded, so a backlog drains across runs.
    container.backgroundQueue
      .add(
        PERMIT_START_DEADLINE_SWEEP_JOB_NAME,
        {},
        {
          repeat: { every: 5 * 60 * 1000 },
          jobId: 'permit-start-deadline-sweep-recurring',
          ...jobEnqueueOptions(PERMIT_START_DEADLINE_SWEEP_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Permit start-deadline sweep job scheduled (every 5 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule permit-start-deadline-sweep job')
      })

    // Google-import claim-lease reaper, every 60 seconds — one claim-lease
    // width (GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS). A worker killed mid-effect
    // leaves its item 'processing' with an elapsed lease and nothing else
    // re-dispatches it: pending-item dispatch is driven only by the outbox
    // requested event, and the lifecycle sweep reacts to the effect deadline
    // hours later. This bounds recovery at roughly two lease widths. The run
    // is a bounded 100-row scan that routes every row through the store's CAS
    // helpers, so it is a no-op when no claim is stale.
    container.backgroundQueue
      .add(
        GOOGLE_IMPORT_CLAIM_REAPER_JOB_NAME,
        {},
        {
          repeat: { every: 60 * 1000 },
          jobId: 'google-import-claim-reaper-recurring',
          ...jobEnqueueOptions(GOOGLE_IMPORT_CLAIM_REAPER_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('Google import claim-lease reaper scheduled (every 60 seconds)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule google-import-claim-reaper job')
      })

    // ── AI operation abandoned-execution reaper ────────────────────────
    // An operation whose owner died between `claimExecution` and its terminal
    // write stays `executing` forever: nothing else writes that transition and
    // `claim` refuses expired rows, so the row is inert AND permanently counted
    // as in-flight AI work. The reapable condition is the OPEN ATTEMPT's age
    // against the domain's own operation horizon (an `expires_at`-only scan hid
    // every abandonment for 24 hours), so this cadence only bounds how long an
    // already-dead row keeps claiming to be live. Bounded 100-row scan routed
    // through the store's `recordFailure` CAS; a no-op when nothing is
    // abandoned.
    container.backgroundQueue
      .add(
        AI_EXECUTION_REAPER_JOB_NAME,
        {},
        {
          repeat: { every: 5 * 60 * 1000 },
          jobId: 'ai-operation-execution-reaper-recurring',
          ...jobEnqueueOptions(AI_EXECUTION_REAPER_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('AI operation abandoned-execution reaper scheduled (every 5 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule ai-operation-execution-reaper job')
      })

    // ── AI review-analysis backfill advance sweep ──────────────────────
    // A backfill run emits ONE review at a time — `storeAnalysis` refuses
    // unless the allocation head still equals the sequence being stored — and
    // the outbox consumer hands the run its next item as each one settles. This
    // sweep only covers a hand-off that was lost, so the cadence bounds how long
    // a BROKEN chain sits idle, not how fast a healthy run goes.
    container.backgroundQueue
      .add(
        AI_BACKFILL_ADVANCE_JOB_NAME,
        {},
        {
          repeat: { every: 5 * 60 * 1000 },
          jobId: 'ai-review-analysis-backfill-advance-recurring',
          ...jobEnqueueOptions(AI_BACKFILL_ADVANCE_JOB_NAME),
        },
      )
      .then(() => {
        logger.info('AI review-analysis backfill advance scheduled (every 5 minutes)')
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Failed to schedule ai-review-analysis-backfill-advance job')
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

    // ── Controlled-beta + outbound-email jobs ──────────────────────
    // Promoted background work remains capability-gated so the persisted
    // cohort policy and emergency kill switches apply at schedule time.
    // Outbound email remains blocked unless notification.send_email is enabled.
    type CapabilitySchedule = Readonly<{
      jobName: string
      every?: number
      pattern?: string
      label: string
      capability: 'leaderboard.use' | 'notification.send_email' | 'ai.detect_trends'
    }>
    const capabilitySchedules: CapabilitySchedule[] = [
      {
        jobName: SCHEDULE_PROPERTY_TRENDS_JOB_NAME,
        every: 60 * 1000,
        label: 'minutely',
        capability: 'ai.detect_trends',
      },
      // Recognition refresh is staggered from metric rollups.
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
  // Durable dispatch stays off by default and is opted into per environment.
  // BQR-2 exit criteria are met except crash-boundary evidence, which is
  // structural unit tests only until the BQR-6 DB+Redis evidence pack: 2.1 gave
  // relay and dispatcher one envelope contract, 2.2 registers consumers before
  // the durable path can start, 2.3 commits state and outbox atomically on the
  // enabled producer path, 2.4 stops consumers acknowledging work they did not
  // perform, and 2.5 allowlist-validates at insert. Inbox families still
  // default to `record-only`, so enabling this relays and records without
  // handing delivery to durable consumers (see `resolveCutoverState`).
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
            'Crash-boundary coverage is structural until the BQR-6 evidence pack; ' +
            'inbox families deliver per OUTBOX_CUTOVER state (default record-only).',
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

  // Graceful shutdown — drain in-progress jobs before exiting.
  // BQC-7.1: the close sequence races DRAIN_BUDGET_MS (default 25s, below
  // Railway's 30s drainingSeconds); a hung job previously stalled the deploy
  // window until SIGKILL. Budget expiry exits 1 — an unclean stop the
  // platform records — instead of an unbounded wait.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, draining workers')

    // Stop the outbox relay first (stop claiming new events)
    stopRelay?.()
    logger.info('Outbox relay stopped')

    const result = await drainWorkerResources({
      workers: [
        namedCloseable('default', worker),
        namedCloseable('background', backgroundWorker),
        namedCloseable('domain-events', domainEventsWorker),
      ],
      queues: [
        namedCloseable('default', container.jobQueue),
        namedCloseable('background', container.backgroundQueue),
        namedCloseable('domain-events', domainEventsQueue),
        namedCloseable('quarantine', quarantineQueue),
      ],
      budgetMs: env.DRAIN_BUDGET_MS,
      logger,
    })

    if (result.timedOut) {
      logger.error(
        { stuck: result.stuck, budgetMs: env.DRAIN_BUDGET_MS },
        'Drain budget exceeded — exiting with unclean shutdown',
      )
      process.exit(1)
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
