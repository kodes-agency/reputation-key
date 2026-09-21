// BQC-5.5 — OperationsSnapshot: the ONE governed read interface for
// operational state (outbox backlog/leases, quarantine dead-letters, content
// lifecycle, sync state, queue depths, worker heartbeat).
//
// Composition-owned: the container builds it ONCE (health checker and queue
// handles are not per-request construction) and exposes it; routes consume
// `.read()` and never construct DB/Redis readers themselves (STD-P1-04).
//
// Policy owned here:
// - Assembly: HealthSnapshot fields + queue-depth rows + workers.heartbeat +
//   a `degraded` section marker list, in ONE typed snapshot.
// - Timeout: each section read (health, queues, heartbeat) gets a hard budget
//   (OPS_SECTION_BUDGET_MS) via withBudget. A section that times out OR fails
//   reports its degraded marker and a safe fallback — a partial read is never
//   a 500 (operator runbooks curl this during incidents, when a dependency is
//   most likely to be down). The health section degrades per signal
//   (`health.<signal>`): one failing or stalled read keeps its own marker and
//   fallback while every other signal keeps its real reading.
// - Payload stays identifier-only (ADR 0030): no review text, PII, or tokens.

import type { Database } from '#/shared/db'
import type { OutboxRepository } from '#/shared/outbox'
import type { Clock } from '#/shared/domain/clock'
import {
  assembleHealthSnapshot,
  createHealthChecker,
  HEALTH_SIGNALS,
  type HealthSignal,
  type HealthSignalReads,
  type HealthSignalValues,
  type HealthSnapshot,
  type NotificationDeliveryLagRead,
  type QuarantineMetricsPort,
} from '#/shared/observability/health-metrics'
import { readAllQueueDepths, type QueueCountsPort, type QueueDepth } from './queue-depth'
import {
  readWorkerHeartbeat,
  type RedisHeartbeatPort,
  type WorkerHeartbeat,
} from './worker-heartbeat'
import { getPoolStats } from '#/shared/db/pool'
import { appliedMigrationCount } from './migration-version'
import {
  getTenantCacheStats,
  type TenantCacheStats,
} from '#/shared/auth/tenant-cache-stats'
import { checkGlobalCapability } from '#/shared/auth/beta-capabilities'
import { getEnv, getReleaseSha } from '#/shared/config/env'
import type { JobRuntimeReport } from '#/shared/jobs/runtime-observations'

/** Hard per-section read budget. A section slower than this degrades. */
export const OPS_SECTION_BUDGET_MS = 5000

/** Queue read handles the snapshot reads depths from (quarantine doubles as
 *  the health checker's dead-letter metrics port). */
export type OperationsQueueHandles = Readonly<{
  default: QueueCountsPort | null
  background: QueueCountsPort | null
  domainEvents: QueueCountsPort | null
  quarantine: (QueueCountsPort & QuarantineMetricsPort) | null
}>

export type OperationsSnapshotDeps = Readonly<{
  db: Database
  outboxRepo?: OutboxRepository
  queues: OperationsQueueHandles
  redis: RedisHeartbeatPort | null | undefined
  clock: Clock
  /**
   * BQC-7.3: version identity injected by the composition root (the shared
   * zone cannot import context domain — the root reads the constants).
   */
  versions: Readonly<{
    /** CAPABILITY_POLICY_VERSION (boot manifest). */
    capabilityPolicy: string
    /** EXECUTION_POLICY_VERSION (authorization semantics). */
    executionPolicy: string
    /** Process-static capability configuration revision. */
    policyStore: () => number | null
    /** SourceContentPolicy.policyVersion. */
    sourceContentPolicy: number
  }>
  /**
   * Reader for the `notification.missing_for_inbox_item` gauge, forwarded to
   * the health checker. Injected by the composition root because the query
   * lives in the notification context and `src/shared/**` never imports
   * `src/contexts/**`. Absent = the gauge reads 0.
   */
  readMissingNotificationCount?: () => Promise<number>
  /** Notification-owned bounded source→Redis→PostgreSQL delivery evidence. */
  readNotificationDeliveryLag?: () => Promise<NotificationDeliveryLagRead>
  /** ARC-02: durable worker/runtime authority assembled from Queue Redis. */
  jobRuntime?: Readonly<{ read: () => Promise<JobRuntimeReport> }>
  /**
   * SAFE-01: global, content-free Guest best-effort observation-loss
   * aggregate. The context owns the Redis adapter; composition injects its
   * read so shared observability never imports a context module.
   */
  readGuestObservationLoss?: () => Promise<OperationsGuestObservationLoss>
  /**
   * BQC-7.3 runtime-section readers. Optional — production defaults read the
   * real pool / migration table / env / cache stats; tests inject hermetic
   * fakes so a metrics read never cold-starts the database.
   */
  runtime?: Readonly<{
    poolStats?: () => OperationsDbSection['pool']
    migrationVersion?: () => Promise<number | null>
    releaseSha?: () => string
    tenantCache?: () => TenantCacheStats
  }>
}>

/** BQC-7.3 (db.*): pool gauges + the applied migration version. */
export type OperationsDbSection = Readonly<{
  /** Null when the pool was never initialized in this process. */
  pool: Readonly<{
    max: number
    totalCount: number
    idleCount: number
    waitingCount: number
  }> | null
  /** Applied migration journal count (null when the read failed). */
  migrationVersion: number | null
}>

/** BQC-7.3 (versions.*): deploy + policy identity. All content-free. */
export type OperationsVersions = Readonly<{
  capabilityPolicy: string
  executionPolicy: string
  policyStore: number | null
  sourceContentPolicy: number
  /** Node runtime version (worker.runtime.version — process.version). */
  runtime: string
}>

/**
 * Content-free rolling aggregate only. No tenant, Portal, destination,
 * session, network pseudonym, or payload value is representable here.
 */
export type OperationsGuestObservationLoss = Readonly<{
  monitorAvailable: boolean
  windowMs: number
  precisionMs: number
  scanLossCount: number
  reviewLinkLossCount: number
  /** Canonically zero because rating fact/outbox persistence is atomic. */
  ratingLossCount: 0
  totalLossCount: number
  ratingDisposition: 'not_applicable_durable'
}>

export type OperationsSnapshot = Readonly<
  Omit<HealthSnapshot, 'workers'> & {
    queues: readonly QueueDepth[]
    workers: HealthSnapshot['workers'] & Readonly<{ heartbeat: WorkerHeartbeat }>
    db: OperationsDbSection
    cache: Readonly<{ tenant: TenantCacheStats }>
    release: Readonly<{ sha: string }>
    versions: OperationsVersions
    /** Detailed identifier-only ownership/report rows; absent without Queue Redis. */
    jobs?: JobRuntimeReport
    /** Present in production; optional only for isolated legacy/test readers. */
    guestObservationLoss?: OperationsGuestObservationLoss
    /** Sections whose read failed or exceeded the budget (fallback values). */
    degraded: readonly string[]
  }
>

export type OperationsSnapshotReader = Readonly<{
  read: () => Promise<OperationsSnapshot>
}>

/**
 * Race `read` against `budgetMs`; on timeout OR rejection return
 * `fallback()`. The race subscribes handlers to `read` immediately, so a
 * losing read that rejects later never surfaces as an unhandled rejection.
 */
export async function withBudget<T>(
  read: Promise<T>,
  budgetMs: number,
  fallback: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback()), budgetMs)
      }),
    ])
  } catch {
    return fallback()
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Fallback value per health signal when that signal degrades (shape intact). */
function zeroHealthSignals(): HealthSignalValues {
  return {
    outbox: {
      unpublishedCount: 0,
      oldestUnpublishedAgeMs: null,
      expiredLeaseCount: 0,
      claimedCount: 0,
      oldestClaimedAgeMs: null,
      stalledLeaseCount: 0,
    },
    quarantine: null,
    reviews: {
      totalActive: 0,
      refreshDueCount: 0,
      expiredCount: 0,
      oldestDueAgeSeconds: null,
    },
    sync: {
      dueForIncrementalCount: 0,
      failedSyncCount: 0,
      oldestDueAgeMs: null,
      gbpPushEnabled: false,
    },
    // A degraded read must not invent a delivery problem: zero overdue rows
    // and email reported dark keeps every notification alert quiet (the
    // `degraded` marker is the signal that this section is unreadable).
    notificationEmail: {
      emailDeliveryEnabled: false,
      pendingOverdueCount: 0,
      oldestPendingOverdueAgeMs: null,
      attemptedStuckCount: 0,
    },
    // 0, not a guess: an unreadable section must not fabricate a
    // notification gap either. `degraded` is what says "unknown".
    notificationGap: 0,
    notificationDeliveryLag: {
      sourceReceiptPending: 0,
      materializationPending: 0,
      oldestSourceRecordedAt: null,
      oldestSourceAgeMs: null,
      oldestMaterializationSourceRecordedAt: null,
      oldestMaterializationSourceAgeMs: null,
      oldestMaterializationEnqueuedAt: null,
      oldestMaterializationEnqueuedAgeMs: null,
      sourceSaturated: false,
      materializationSaturated: false,
      immediateEmailAcceptance: {
        awaitingProviderAcceptance: 0,
        attemptedAwaitingProviderAcceptance: 0,
        oldestAwaitingSourceRecordedAt: null,
        oldestAwaitingSourceAgeMs: null,
        acceptedLatencyP99Ms: null,
        acceptedSampleCount: 0,
        sourceUnlinked: 0,
        saturated: false,
      },
    },
    replyPublication: {
      counts: {
        requested: 0,
        authorized: 0,
        sending: 0,
        published: 0,
        terminal: 0,
        ambiguous: 0,
        cancelled: 0,
      },
      oldestAmbiguousAgeMs: null,
    },
  }
}

type HealthSection = Readonly<{
  health: HealthSnapshot
  /** Signals that failed or outlasted the section deadline (fallback values). */
  degraded: readonly HealthSignal[]
}>

/**
 * Read the health section one signal at a time under one shared deadline. The
 * PostgreSQL signals run in order — one pool connection at a time, as before —
 * while the Queue Redis quarantine read runs beside them, so a stall in either
 * store cannot blank the other's signals. A signal that fails or outlasts the
 * deadline keeps its zero fallback and its own marker; no signal starts once
 * the deadline has passed, so a slow database is not handed more work.
 */
async function readHealthSection(
  signals: HealthSignalReads,
  now: Date,
): Promise<HealthSection> {
  const deadline = Date.now() + OPS_SECTION_BUDGET_MS
  const zero = zeroHealthSignals()
  const failed = new Set<HealthSignal>()
  const read = <K extends HealthSignal>(signal: K): Promise<HealthSignalValues[K]> => {
    const fallback = () => {
      failed.add(signal)
      return zero[signal]
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) return Promise.resolve(fallback())
    return withBudget(signals[signal](), remainingMs, fallback)
  }
  const readDatabaseSignals = async () => {
    const outbox = await read('outbox')
    const reviews = await read('reviews')
    const sync = await read('sync')
    const replyPublication = await read('replyPublication')
    const notificationEmail = await read('notificationEmail')
    const [notificationGap, notificationDeliveryLag] = await Promise.all([
      read('notificationGap'),
      read('notificationDeliveryLag'),
    ])
    return {
      outbox,
      reviews,
      sync,
      replyPublication,
      notificationEmail,
      notificationGap,
      notificationDeliveryLag,
    }
  }
  const [quarantine, database] = await Promise.all([
    read('quarantine'),
    readDatabaseSignals(),
  ])
  return {
    health: assembleHealthSnapshot(now, { ...database, quarantine }),
    degraded: HEALTH_SIGNALS.filter((signal) => failed.has(signal)),
  }
}

type RuntimeSection = Readonly<{
  db: OperationsDbSection
  cache: Readonly<{ tenant: TenantCacheStats }>
  release: Readonly<{ sha: string }>
  versions: OperationsVersions
}>

/** The runtime section's in-process readings: everything but the migration read. */
type RuntimeFacts = Omit<RuntimeSection, 'db'> &
  Readonly<{ pool: OperationsDbSection['pool'] }>

function readRuntimeFacts(deps: OperationsSnapshotDeps): RuntimeFacts {
  return {
    pool: (deps.runtime?.poolStats ?? getPoolStats)(),
    cache: { tenant: (deps.runtime?.tenantCache ?? getTenantCacheStats)() },
    release: { sha: (deps.runtime?.releaseSha ?? getReleaseSha)() },
    versions: {
      capabilityPolicy: deps.versions.capabilityPolicy,
      executionPolicy: deps.versions.executionPolicy,
      policyStore: deps.versions.policyStore(),
      sourceContentPolicy: deps.versions.sourceContentPolicy,
      runtime: process.version,
    },
  }
}

/** Fallback in-process readings when one of them throws (shape intact). */
function zeroRuntimeFacts(versions: OperationsSnapshotDeps['versions']): RuntimeFacts {
  return {
    pool: null,
    cache: { tenant: { hits: 0, misses: 0, evictions: 0, size: 0 } },
    release: { sha: 'unknown' },
    versions: {
      capabilityPolicy: versions.capabilityPolicy,
      executionPolicy: versions.executionPolicy,
      policyStore: null,
      sourceContentPolicy: versions.sourceContentPolicy,
      runtime: process.version,
    },
  }
}

/**
 * BQC-7.3 runtime section: pool/migration gauges, cache counters, identity.
 * Only the migration count touches the database, so only it is budgeted: a
 * saturated pool is exactly when that read stalls, and the in-process pool
 * gauge db.pool-exhaustion reads must survive it. Either half degrading marks
 * the section degraded.
 */
async function readRuntimeSection(
  deps: OperationsSnapshotDeps,
  markDegraded: () => void,
): Promise<RuntimeSection> {
  let facts: RuntimeFacts
  try {
    facts = readRuntimeFacts(deps)
  } catch {
    markDegraded()
    facts = zeroRuntimeFacts(deps.versions)
  }
  const readMigrationVersion = deps.runtime?.migrationVersion ?? appliedMigrationCount
  const migrationVersion = await withBudget(
    Promise.resolve().then(readMigrationVersion),
    OPS_SECTION_BUDGET_MS,
    () => {
      markDegraded()
      return null
    },
  )
  const { pool, ...identity } = facts
  return { ...identity, db: { pool, migrationVersion } }
}

const STALE_HEARTBEAT: WorkerHeartbeat = { at: null, ageMs: null, stale: true }

const UNAVAILABLE_GUEST_OBSERVATION_LOSS: OperationsGuestObservationLoss = {
  monitorAvailable: false,
  windowMs: 24 * 60 * 60 * 1000,
  precisionMs: 5 * 60 * 1000,
  scanLossCount: 0,
  reviewLinkLossCount: 0,
  ratingLossCount: 0,
  totalLossCount: 0,
  ratingDisposition: 'not_applicable_durable',
}

export function createOperationsSnapshot(
  deps: OperationsSnapshotDeps,
): OperationsSnapshotReader {
  // Constructed ONCE here — not per request (BQC-5.5).
  const checker = createHealthChecker(deps.db, deps.outboxRepo, {
    quarantineQueue: deps.queues.quarantine,
    // Readiness fact, not a DB metric: an empty GBP_PUBSUB_TOPIC means Google
    // push is dark and new reviews only arrive on the discovery sweep.
    gbpPushEnabled: getEnv().GBP_PUBSUB_TOPIC.length > 0,
    // Same kind of readiness fact: while `notification.send_email` is not
    // globally enabled, the email path is capability-dark by design and a
    // pending backlog is expected — the alert must not cry wolf about it.
    // A per-ORG allowlist grant is not globally enumerable, so this flag
    // cannot see it; notifications.attemptedStuckCount is what covers that
    // case (a row the delivery path actually touched and left pending).
    emailDeliveryEnabled: checkGlobalCapability('notification.send_email').allowed,
    // Forwarded, not computed here: the notification-gap query is owned by the
    // notification context.
    readMissingNotificationCount: deps.readMissingNotificationCount,
    readNotificationDeliveryLag: deps.readNotificationDeliveryLag,
  })

  return {
    read: async () => {
      // Flags (not push order) so `degraded` is deterministic regardless of
      // which section settles first.
      const flags = {
        queues: false,
        heartbeat: false,
        runtime: false,
        jobs: false,
        guestObservationLoss: false,
      }
      const [healthSection, queues, heartbeat, runtime, jobs, guestObservationLoss] =
        await Promise.all([
          readHealthSection(checker.signals, deps.clock()),
          withBudget(
            readAllQueueDepths([
              { name: 'default', queue: deps.queues.default },
              { name: 'background', queue: deps.queues.background },
              { name: 'domain-events', queue: deps.queues.domainEvents },
              { name: 'quarantine', queue: deps.queues.quarantine },
            ]),
            OPS_SECTION_BUDGET_MS,
            () => {
              flags.queues = true
              return [] as readonly QueueDepth[]
            },
          ),
          withBudget(
            readWorkerHeartbeat(deps.redis, deps.clock),
            OPS_SECTION_BUDGET_MS,
            () => {
              flags.heartbeat = true
              return STALE_HEARTBEAT
            },
          ),
          readRuntimeSection(deps, () => {
            flags.runtime = true
          }),
          deps.jobRuntime
            ? withBudget<JobRuntimeReport | undefined>(
                deps.jobRuntime.read(),
                OPS_SECTION_BUDGET_MS,
                () => {
                  flags.jobs = true
                  return undefined
                },
              )
            : Promise.resolve(undefined),
          deps.readGuestObservationLoss
            ? withBudget<OperationsGuestObservationLoss | undefined>(
                deps.readGuestObservationLoss(),
                OPS_SECTION_BUDGET_MS,
                () => {
                  flags.guestObservationLoss = true
                  return UNAVAILABLE_GUEST_OBSERVATION_LOSS
                },
              )
            : Promise.resolve(undefined),
        ])

      if (guestObservationLoss && !guestObservationLoss.monitorAvailable) {
        flags.guestObservationLoss = true
      }

      const { health } = healthSection
      const degraded: string[] = healthSection.degraded.map(
        (signal) => `health.${signal}`,
      )
      if (flags.queues) degraded.push('queues')
      if (flags.heartbeat) degraded.push('workers.heartbeat')
      if (flags.runtime) degraded.push('runtime')
      if (flags.jobs) degraded.push('jobs')
      if (flags.guestObservationLoss) degraded.push('guest.observationLoss')

      return {
        ...health,
        queues,
        workers: { ...health.workers, heartbeat },
        db: runtime.db,
        cache: runtime.cache,
        release: runtime.release,
        versions: runtime.versions,
        ...(jobs === undefined ? {} : { jobs }),
        ...(guestObservationLoss === undefined ? {} : { guestObservationLoss }),
        degraded,
      }
    },
  }
}
