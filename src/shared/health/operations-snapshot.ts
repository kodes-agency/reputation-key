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
}>

export type OperationsSnapshot = Readonly<
  Omit<HealthSnapshot, 'workers'> & {
    queues: readonly QueueDepth[]
    workers: HealthSnapshot['workers'] & Readonly<{ heartbeat: WorkerHeartbeat }>
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
    workers: {
      defaultQueueName: 'default',
      backgroundQueueName: 'background',
      domainEventsQueueName: 'domain-events',
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
      const flags = { health: false, queues: false, heartbeat: false }
      const [health, queues, heartbeat] = await Promise.all([
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
      ])

      const degraded: string[] = []
      if (flags.health) degraded.push('health')
      if (flags.queues) degraded.push('queues')
      if (flags.heartbeat) degraded.push('workers.heartbeat')

      return {
        ...health,
        queues,
        workers: { ...health.workers, heartbeat },
        degraded,
      }
    },
  }
}
