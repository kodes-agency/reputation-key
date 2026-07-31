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
//   most likely to be down).
// - Payload stays identifier-only (ADR 0030): no review text, PII, or tokens.

import type { Database } from '#/shared/db'
import type { OutboxRepository } from '#/shared/outbox'
import type { Clock } from '#/shared/domain/clock'
import {
  createHealthChecker,
  type HealthSnapshot,
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
import { getReleaseSha } from '#/shared/config/env'

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
    /** Persisted policy_version reader (null when only the env seed exists). */
    policyStore: () => number | null
    /** ROUTING_POLICY_VERSION (processing-routing). */
    routingPolicy: number
    /** SourceContentPolicy.policyVersion. */
    sourceContentPolicy: number
  }>
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
  policyStore: number | null
  routingPolicy: number
  sourceContentPolicy: number
  /** Node runtime version (worker.runtime.version — process.version). */
  runtime: string
}>

export type OperationsSnapshot = Readonly<
  Omit<HealthSnapshot, 'workers'> & {
    queues: readonly QueueDepth[]
    workers: HealthSnapshot['workers'] & Readonly<{ heartbeat: WorkerHeartbeat }>
    db: OperationsDbSection
    cache: Readonly<{ tenant: TenantCacheStats }>
    release: Readonly<{ sha: string }>
    versions: OperationsVersions
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

/** Fallback health payload when the health section degrades (shape intact). */
function zeroHealthSnapshot(now: Date): HealthSnapshot {
  return {
    timestamp: now.toISOString(),
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
    sync: { dueForIncrementalCount: 0, failedSyncCount: 0 },
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
    workers: {
      defaultQueueName: 'default',
      backgroundQueueName: 'background',
      domainEventsQueueName: 'domain-events',
    },
  }
}

type RuntimeSection = Readonly<{
  db: OperationsDbSection
  cache: Readonly<{ tenant: TenantCacheStats }>
  release: Readonly<{ sha: string }>
  versions: OperationsVersions
}>

/** BQC-7.3 runtime section: pool/migration gauges, cache counters, identity. */
async function readRuntimeSection(deps: OperationsSnapshotDeps): Promise<RuntimeSection> {
  return {
    db: {
      pool: (deps.runtime?.poolStats ?? getPoolStats)(),
      migrationVersion: await (deps.runtime?.migrationVersion ?? appliedMigrationCount)(),
    },
    cache: { tenant: (deps.runtime?.tenantCache ?? getTenantCacheStats)() },
    release: { sha: (deps.runtime?.releaseSha ?? getReleaseSha)() },
    versions: {
      capabilityPolicy: deps.versions.capabilityPolicy,
      policyStore: deps.versions.policyStore(),
      routingPolicy: deps.versions.routingPolicy,
      sourceContentPolicy: deps.versions.sourceContentPolicy,
      runtime: process.version,
    },
  }
}

/** Fallback runtime payload when the section degrades (shape intact). */
function zeroRuntimeSection(
  versions: OperationsSnapshotDeps['versions'],
): RuntimeSection {
  return {
    db: { pool: null, migrationVersion: null },
    cache: { tenant: { hits: 0, misses: 0, evictions: 0, size: 0 } },
    release: { sha: 'unknown' },
    versions: {
      capabilityPolicy: versions.capabilityPolicy,
      policyStore: null,
      routingPolicy: versions.routingPolicy,
      sourceContentPolicy: versions.sourceContentPolicy,
      runtime: process.version,
    },
  }
}

const STALE_HEARTBEAT: WorkerHeartbeat = { at: null, ageMs: null, stale: true }

export function createOperationsSnapshot(
  deps: OperationsSnapshotDeps,
): OperationsSnapshotReader {
  // Constructed ONCE here — not per request (BQC-5.5).
  const checker = createHealthChecker(deps.db, deps.outboxRepo, {
    quarantineQueue: deps.queues.quarantine,
  })

  return {
    read: async () => {
      // Flags (not push order) so `degraded` is deterministic regardless of
      // which section settles first.
      const flags = { health: false, queues: false, heartbeat: false, runtime: false }
      const [health, queues, heartbeat, runtime] = await Promise.all([
        withBudget(checker.check(), OPS_SECTION_BUDGET_MS, () => {
          flags.health = true
          return zeroHealthSnapshot(deps.clock())
        }),
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
        withBudget(readRuntimeSection(deps), OPS_SECTION_BUDGET_MS, () => {
          flags.runtime = true
          return zeroRuntimeSection(deps.versions)
        }),
      ])

      const degraded: string[] = []
      if (flags.health) degraded.push('health')
      if (flags.queues) degraded.push('queues')
      if (flags.heartbeat) degraded.push('workers.heartbeat')
      if (flags.runtime) degraded.push('runtime')

      return {
        ...health,
        queues,
        workers: { ...health.workers, heartbeat },
        db: runtime.db,
        cache: runtime.cache,
        release: runtime.release,
        versions: runtime.versions,
        degraded,
      }
    },
  }
}
