// Worker entry point — plain Node script, no Nitro
// Built separately with tsup, runs as: node dist/worker.js

import 'dotenv/config'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import {
  captureObservabilityException,
  flushObservability,
  initObservability,
} from '#/shared/observability/telemetry'
import { runCapabilityBootGuard } from '#/shared/auth/capability-boot-guard'
import { assertProductionSecrets } from '#/shared/config/production-secrets'
import { assertReleaseIdentity } from '#/shared/config/release-identity'
import { getDb } from '#/shared/db'
import { assertRecoveryCutoverAttestation } from '#/shared/config/recovery-cutover-attestation'
import { createRecoveryCutoverRunReader } from '#/shared/db/recovery/recovery-cutover-run-reader'
import {
  assertRestoreModeCompatible,
  isRestoreIsolated,
  RESTORE_ISOLATED_LOG_LINE,
} from '#/shared/config/restore-mode'
import { createWorkerContainer } from '#/composition/deployables'
import { bindProcessPolicies } from '#/shared/auth/process-policy-binding'
import { bootstrap, createBootstrapRuntimeConfig } from '#/bootstrap'
import {
  BACKGROUND_QUEUE_CONCURRENCY,
  createJobWorker,
  DEFAULT_QUEUE_CONCURRENCY,
} from '#/shared/jobs/worker'

import { assertConfiguredJobRedisRuntime } from '#/shared/jobs/redis-runtime'
import {
  assertProductionRedisTopology,
  getJobRedisUrl,
} from '#/shared/jobs/redis-topology'
import {
  createGatedJobHandler,
  type JobRoutingGate,
} from '#/shared/jobs/delayed-execution-gate'
import { assertJobReadiness } from '#/shared/jobs/readiness'
import { reconcileJobSchedulers } from '#/shared/jobs/job-schedulers'
import {
  JOB_OPERATIONAL_CONTRACTS,
  createOperationalSchedulerPlan,
} from '#/shared/jobs/operational-catalogue'
import {
  createJobRuntimeReportReader,
  createQueueJobRuntimeObservationStore,
} from '#/shared/jobs/runtime-observations'
import { drainWorkerResources, namedCloseable } from './drain'
import {
  createWorkerProcessFailurePolicy,
  type WorkerTerminationTrigger,
} from './process-failure'
import { quarantineJobDirect } from '#/shared/jobs/failure-quarantine'
import { createPublishReplyScopeResolver } from '#/contexts/review/infrastructure/jobs/publish-reply-scope-resolver'
import { createOutboxRelay } from '#/shared/outbox/relay'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import type { Worker } from 'bullmq'

// Worker entry wires 10+ job schedules — complexity is inherent to the
// registration seam. Owner: BQC-3 (returned by BQC-5.7).
// fallow-ignore-next-line complexity
async function main() {
  const runtimeStartedAt = new Date()
  const env = getEnv()
  assertReleaseIdentity(env)
  const logger = getLogger()
  initObservability('worker')

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
  await assertRecoveryCutoverAttestation(createRecoveryCutoverRunReader(getDb()), env)

  // DATA-18 / GOV-01: inspect the actual queue Redis before constructing any
  // BullMQ Queue or Worker. `noeviction` is a correctness requirement, Redis
  // 6.2 and GETDEL are part of the supported BullMQ Redis command contract.
  // Production never degrades into a worker that looks started but owns no
  // queues.
  assertProductionRedisTopology(env)
  const jobRedisUrl = getJobRedisUrl(env)
  if (!jobRedisUrl) {
    if (env.NODE_ENV === 'production') {
      throw new Error('[CONFIG] BullMQ Redis runtime is incompatible: url_missing')
    }
    logger.warn('No queue Redis configured — BullMQ runtime inspection skipped')
  } else {
    const redisReadiness = await assertConfiguredJobRedisRuntime(jobRedisUrl)
    logger.info(
      {
        redisVersion: redisReadiness.redisVersion,
        maxmemoryPolicy: redisReadiness.maxmemoryPolicy,
        getdelAvailable: redisReadiness.getdelAvailable,
      },
      'BullMQ Redis runtime verified',
    )
  }

  // ARC-03-T15: the worker builds the WORKER deployable's container — the one
  // complete Application Container this process may hold. A second build fails
  // by name instead of quietly producing a second policy trio, a second
  // consumer registry and a second set of queue connections.
  const container = createWorkerContainer()

  // ARC-03-T8: the worker's ONE explicit policy installation. Building the
  // container no longer installs the ExecutionPolicy / DelayedExecutionPolicy
  // / CapabilityPolicyStore, so the dispatch gate would otherwise answer from
  // the capability-boot-guard's env-only store. This must precede the first
  // refresh and every job.
  bindProcessPolicies(container)

  // BQC-2.2: strong read of persisted policy state before any job runs —
  // worker decisions see DB truth from the start (allowlist/suspension).
  await container.refreshPolicyStore()
  // Review provider-subject writers may start only after the decoded worker
  // key set exactly matches the database's masked active/rotation inventory.
  await container.refreshReviewProviderSubjectKeys()

  // Register all event handlers and job handlers BEFORE starting the BullMQ
  // worker. Blocked/dark families deliberately register no handler; scheduler
  // reconciliation removes their repeats and any queued remnant quarantines.
  await bootstrap(container, { runtime: createBootstrapRuntimeConfig(env) })

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
      container.outboxRepo && jobRedisUrl && env.OUTBOX_DISPATCHER_ENABLED,
    ),
    // ARC-03-T7: readiness validates THIS container's registry. The old
    // process-global default could pass on consumers another container had
    // registered.
    listConsumers: container.consumerRegistry.list,
  })

  // BQC-3.2: dispatch-time scope resolution for jobs whose envelope lacks the
  // property id (publish-reply carries replyId only — resolved via reply →
  // review → propertyId). Every other job name falls through to the payload.
  const resolveScope = createPublishReplyScopeResolver({ db: container.db })

  // ARC-03-T15: the dead-letter quarantine barrier queue is CONTAINER-owned.
  // It is written to and never processed; jobs whose attempt budget is spent
  // land here with a content-safe envelope.
  const { quarantineQueue, domainEventsQueue, processingRouter } =
    container.jobDispatchWorkerRuntime
  const runtimeObservationQueue = container.backgroundQueue ?? container.jobQueue
  const runtimeObservationStore = runtimeObservationQueue
    ? createQueueJobRuntimeObservationStore({
        queue: runtimeObservationQueue,
        cell: env.PROCESSING_CELL,
      })
    : null

  // BQC-4.2: the worker declares its processing cell (PROCESSING_CELL, ADR
  // 0048 — 'us' is the only approved beta cell). The routing gate re-resolves
  // each property-scoped job's CURRENT routing at dispatch; blocked or
  // wrong-cell jobs are quarantined directly (fail closed, no retry burn).
  const processingCell = env.PROCESSING_CELL
  const routingGate: JobRoutingGate = {
    // ARC-03-T15: the container's ONE routing model. The worker used to build a
    // second ProcessingRouter, so a single process held two routing decisions.
    router: processingRouter,
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
      runtimeObservationStore ?? undefined,
      container.clock,
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
  // Separate queue so retained background work never blocks user-facing jobs.
  // This runtime carries no dark work. Lower concurrency.
  if (container.backgroundQueue) {
    backgroundWorker = createJobWorker(
      'background',
      createGatedJobHandler('background', registry, resolveScope, routingGate),
      BACKGROUND_QUEUE_CONCURRENCY,
      quarantineQueue,
      runtimeObservationStore ?? undefined,
      container.clock,
    )

    if (backgroundWorker) {
      logger.info(
        { concurrency: BACKGROUND_QUEUE_CONCURRENCY },
        'BullMQ worker started on background queue',
      )
    }

    // The governed job-family catalogue is the single source of cadence and
    // posture. Every family is managed so a stale/accidental scheduler for
    // on-demand, dark, or quarantined work is removed.
    const schedulerPlan = createOperationalSchedulerPlan()
    const scheduleReconciliation = await reconcileJobSchedulers({
      queue: container.backgroundQueue,
      managedJobNames: schedulerPlan.managedJobNames,
      desired: schedulerPlan.desired,
    })
    for (const { schedulerId, jobName } of schedulerPlan.desired) {
      logger.info({ schedulerId, jobName }, 'Job scheduler reconciled')
    }
    logger.info(
      {
        managed: schedulerPlan.managedJobNames.length,
        enabled: schedulerPlan.desired.length,
        removedSchedulerIds: scheduleReconciliation.removedSchedulerIds,
      },
      'Background job scheduler set reconciled',
    )
  } else {
    logger.warn('No background queue available — cron jobs not scheduled')
  }

  if (runtimeObservationStore) {
    const schedulerNames = new Set(
      createOperationalSchedulerPlan().desired.map((schedule) => schedule.jobName),
    )
    await runtimeObservationStore.recordBoot({
      contracts: JOB_OPERATIONAL_CONTRACTS,
      registeredHandlers: new Set(registry.getAll().keys()),
      registeredSchedulers: container.backgroundQueue ? schedulerNames : new Set(),
      runtimeStartedAt,
    })
    const runtimeReport = await createJobRuntimeReportReader({
      contracts: JOB_OPERATIONAL_CONTRACTS,
      store: runtimeObservationStore,
      queues: {
        default: container.jobQueue ?? null,
        background: container.backgroundQueue ?? null,
      },
      quarantine: quarantineQueue ?? null,
      clock: container.clock,
    }).read()
    const log = runtimeReport.ready ? logger.info.bind(logger) : logger.warn.bind(logger)
    log(
      {
        total: runtimeReport.total,
        failing: runtimeReport.failing,
        missingObservations: runtimeReport.missingObservations,
        handlerMissing: runtimeReport.handlerMissing,
        schedulerMissing: runtimeReport.schedulerMissing,
        forbiddenDarkWork: runtimeReport.forbiddenDarkWork,
        quarantinedSchedulers: runtimeReport.quarantinedSchedulers,
        missedObjectives: runtimeReport.missedObjectives,
        queueAgeMissed: runtimeReport.queueAgeMissed,
        stalled: runtimeReport.stalled,
        repairRequired: runtimeReport.repairRequired,
        deadLetters: runtimeReport.deadLetters,
        failedJobs: runtimeReport.rows
          .filter((row) => !row.ready)
          .map((row) => ({
            jobName: row.jobName,
            owner: row.owner,
            reasons: row.reasons,
          })),
      },
      'job runtime operational report',
    )
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

  if (container.outboxRepo && jobRedisUrl && env.OUTBOX_DISPATCHER_ENABLED) {
    if (domainEventsQueue) {
      const relay = createOutboxRelay(container.outboxRepo, domainEventsQueue, {
        sourceCell: env.PROCESSING_CELL,
        // REG-01: a Property-scoped fact is admitted against CURRENT routing
        // immediately before queue publication. Organization/global facts are
        // cell-local by database placement and carry no Property to resolve.
        admitEvent: async (event) => {
          if (!event.propertyId) return true
          const decision = await container.dataCellExecutionFence.decideProperty(
            event.propertyId,
          )
          return decision.kind === 'allow'
            ? {
                dataCellId: decision.cell,
                routingPolicyVersion: decision.routingPolicyVersion,
              }
            : false
        },
      })
      stopRelay = relay.start(5_000)
      const dispatchHandler = createDispatcherHandler(container.outboxRepo, {
        consumers: container.consumerRegistry,
        localCell: env.PROCESSING_CELL,
      })
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
  } else if (container.outboxRepo && jobRedisUrl && !env.OUTBOX_DISPATCHER_ENABLED) {
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
  const shutdown = async (trigger: WorkerTerminationTrigger, exitCode: 0 | 1) => {
    logger.info({ exitCode, trigger }, 'Worker termination requested, draining workers')

    // Stop the outbox relay first (stop claiming new events)
    stopRelay?.()
    logger.info('Outbox relay stopped')

    const result = await drainWorkerResources({
      workers: [
        namedCloseable('default', worker),
        namedCloseable('background', backgroundWorker),
        namedCloseable('domain-events', domainEventsWorker),
      ],
      // ARC-03-T6: the worker built this container, so the worker releases
      // what it started (identity policy poller) — the process no longer
      // relies on exit() to clean up background work.
      shutdown: container.shutdown,
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
      await flushObservability()
      process.exit(1)
    }
    await flushObservability()
    process.exit(exitCode)
  }

  const processFailurePolicy = createWorkerProcessFailurePolicy({
    shutdown,
    exit: (code) => process.exit(code),
    logger,
    captureFatal: (error, trigger) =>
      captureObservabilityException(error, {
        source: 'worker-process',
        trigger,
      }),
    flushErrorMonitoring: flushObservability,
  })
  process.once('SIGTERM', () => processFailurePolicy.onSignal('SIGTERM'))
  process.once('SIGINT', () => processFailurePolicy.onSignal('SIGINT'))
  process.once('unhandledRejection', (reason) =>
    processFailurePolicy.onUnhandledRejection(reason),
  )
  process.once('uncaughtException', (error) =>
    processFailurePolicy.onUncaughtException(error),
  )
}

/**
 * Say what the worker died of, on stderr, before anything else runs.
 *
 * The structured logger redacts free text, because a message logged during
 * normal operation can carry tenant content. That is right in general and
 * wrong here: this handler only ever runs BEFORE the worker has started, so
 * there is no tenant data to leak, and the redacted form is unusable —
 * `{"err":{"name":"Error"}}` names no cause at all, which is exactly what a
 * failing container produced in CI.
 *
 * Mirrors `emitStartupFailure` in services/sidecar-operational-runtime.ts,
 * which exists for the same reason and was added after the same symptom.
 */
function emitWorkerStartupFailure(error: unknown): void {
  const named = error instanceof Error ? error : undefined
  const code = (error as { code?: unknown } | null)?.code
  process.stderr.write(
    `${JSON.stringify({
      event: 'worker.startup_failed',
      name: named?.name ?? typeof error,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      message: named?.message ?? String(error),
      stack: named?.stack,
    })}\n`,
  )
}

main().catch(async (err) => {
  // stderr FIRST: the two calls below both depend on configuration that may be
  // the very thing that failed, so neither is allowed to swallow the diagnosis.
  emitWorkerStartupFailure(err)
  captureObservabilityException(err, {
    source: 'worker-startup',
    trigger: 'startup',
  })
  getLogger().fatal({ err }, 'Worker failed to start')
  await flushObservability()
  process.exit(1)
})
