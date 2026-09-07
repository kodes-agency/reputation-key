// BQC-5.5 — OperationsSnapshot unit tests (fake db/queues/redis).
// Pins the degrade-not-abort contract: a failing or over-budget section
// reports its marker in `degraded` and the snapshot still resolves.

import { describe, it, expect, vi } from 'vitest'
import {
  createOperationsSnapshot,
  withBudget,
  OPS_SECTION_BUDGET_MS,
} from './operations-snapshot'
import type { Database } from '#/shared/db'
import type { OutboxRepository } from '#/shared/outbox'

const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z')
const clock = () => FIXED_NOW

/** A thenable select-chain returning queued per-query results in call order. */
function fakeDb(results: unknown[][]): Database {
  let call = 0
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject)
    return chain
  }
  return { select: vi.fn(() => makeChain(results[call++] ?? [])) } as unknown as Database
}

const UNPUBLISHED_ROW = [{ cnt: 3, age_ms: 1500 }]
const CLAIMED_ROW = [{ claimed: 1, oldest_claimed_age_ms: 500, stalled: 0 }]
const REVIEW_ROW = [{ total: 2, refresh_due: 1, expired: 0, oldest_due_age_seconds: 60 }]
const SYNC_ROW = [{ due: 1, failed: 0 }]
/** BQC-7.3: reply publication aggregate (one row, all states + age). */
const PUBLICATION_ROW = [
  {
    requested: 0,
    authorized: 1,
    sending: 0,
    published: 4,
    terminal: 0,
    ambiguous: 1,
    cancelled: 0,
    oldest_ambiguous_age_ms: 30_000,
  },
]

/** BQC-7.3: hermetic version identity + runtime readers (no real pool/env). */
const VERSIONS = {
  capabilityPolicy: 'test-cap',
  executionPolicy: 'test-exec',
  policyStore: () => 11,
  sourceContentPolicy: 1,
} as const
const RUNTIME = {
  poolStats: () => ({ max: 10, totalCount: 3, idleCount: 2, waitingCount: 0 }),
  migrationVersion: async () => 17,
  releaseSha: () => 'abc1234',
  tenantCache: () => ({ hits: 5, misses: 2, evictions: 1, size: 3 }),
} as const
const JOB_RUNTIME = {
  ready: false,
  total: 2,
  active: 1,
  dark: 1,
  quarantined: 0,
  failing: 1,
  missingObservations: 0,
  handlerMissing: 0,
  schedulerMissing: 1,
  forbiddenDarkWork: 0,
  quarantinedSchedulers: 0,
  missedObjectives: 0,
  queueAgeMissed: 0,
  stalled: 0,
  repairRequired: 0,
  deadLetters: 0,
  rows: [
    {
      jobName: 'health-check',
      owner: 'platform',
      cell: 'us',
      processor: 'src/shared/jobs/health-check.job.ts',
      action: 'system:health.check',
      routing: 'cell_local' as const,
      capability: 'none',
      posture: 'active' as const,
      queue: 'background' as const,
      schedule: 'every:300000',
      retryAttempts: 3,
      retryBackoff: 'exponential:30000',
      timeoutMs: 30_000,
      workerConcurrency: 3,
      retention: 'completed:100,failed:50',
      lastSuccessObjectiveMs: 630_000,
      maximumQueueAgeMs: 900_000,
      ready: false,
      reasons: ['scheduler_missing' as const],
      lastSucceededAt: null,
      oldestWaitingAt: null,
      deadLetterCount: 0,
      repairCommand:
        'pnpm ops:quarantine redrive <quarantineJobId> --operator <registered-operator> --reason <incident-reason> --apply',
      runbook: 'docs/operations/runbooks.md',
    },
  ],
}

function fakeOutboxRepo(): OutboxRepository {
  return { findExpiredLeases: vi.fn(async () => []) } as unknown as OutboxRepository
}

function fakeQueue(waiting: number) {
  return {
    getJobCounts: vi.fn(async () => ({
      waiting,
      active: 0,
      delayed: 0,
      failed: 0,
      paused: 0,
    })),
    getJobs: vi.fn(async () => []),
  }
}

const fakeRedis = {
  get: vi.fn(async () => FIXED_NOW.toISOString()),
  set: vi.fn(async () => 'OK'),
}

describe('withBudget', () => {
  it('returns the read value when it resolves within budget', async () => {
    await expect(withBudget(Promise.resolve(42), 50, () => -1)).resolves.toBe(42)
  })

  it('returns the fallback when the read never resolves (hard budget)', async () => {
    const never = new Promise<number>(() => {})
    await expect(withBudget(never, 10, () => -1)).resolves.toBe(-1)
  })

  it('returns the fallback when the read rejects', async () => {
    await expect(
      withBudget(Promise.reject(new Error('boom')), 50, () => -1),
    ).resolves.toBe(-1)
  })

  it('does not surface an unhandled rejection when the losing read rejects later', async () => {
    const lateRejection = new Promise<number>((_, reject) =>
      setTimeout(() => reject(new Error('late boom')), 20),
    )
    await expect(withBudget(lateRejection, 5, () => -1)).resolves.toBe(-1)
    // Let the losing read settle; an unhandled rejection would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
})

describe('createOperationsSnapshot', () => {
  it('assembles health + queues + heartbeat into one snapshot with no degraded sections', async () => {
    const reader = createOperationsSnapshot({
      db: fakeDb([UNPUBLISHED_ROW, CLAIMED_ROW, REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW]),
      outboxRepo: fakeOutboxRepo(),
      queues: {
        default: fakeQueue(2),
        background: fakeQueue(0),
        domainEvents: fakeQueue(1),
        quarantine: fakeQueue(4),
      },
      redis: fakeRedis,
      clock,
      versions: VERSIONS,
      runtime: RUNTIME,
      jobRuntime: { read: async () => JOB_RUNTIME },
      readGuestObservationLoss: async () => ({
        monitorAvailable: true,
        windowMs: 24 * 60 * 60 * 1000,
        precisionMs: 5 * 60 * 1000,
        scanLossCount: 2,
        reviewLinkLossCount: 1,
        ratingLossCount: 0,
        totalLossCount: 3,
        ratingDisposition: 'not_applicable_durable' as const,
      }),
      readNotificationDeliveryLag: async () => ({
        sourceReceiptPending: 1,
        materializationPending: 2,
        oldestSourceRecordedAt: new Date('2026-01-15T11:58:00.000Z'),
        oldestMaterializationSourceRecordedAt: new Date('2026-01-15T11:57:00.000Z'),
        oldestMaterializationEnqueuedAt: new Date('2026-01-15T11:59:30.000Z'),
        sourceSaturated: false,
        materializationSaturated: true,
        immediateEmailAcceptance: {
          awaitingProviderAcceptance: 1,
          attemptedAwaitingProviderAcceptance: 1,
          oldestAwaitingSourceRecordedAt: new Date('2026-01-15T11:56:00.000Z'),
          acceptedLatencyP99Ms: 301_000,
          acceptedSampleCount: 20,
          sourceUnlinked: 0,
          saturated: false,
        },
      }),
    })

    const snapshot = await reader.read()

    // The health checker's timestamp is ambient (shared-observability is not
    // clock-injected; same behavior as the pre-BQC-5.5 route).
    expect(Number.isNaN(Date.parse(snapshot.timestamp))).toBe(false)
    expect(snapshot.outbox.unpublishedCount).toBe(3)
    expect(snapshot.reviews.refreshDueCount).toBe(1)
    expect(snapshot.replyPublication).toEqual({
      counts: {
        requested: 0,
        authorized: 1,
        sending: 0,
        published: 4,
        terminal: 0,
        ambiguous: 1,
        cancelled: 0,
      },
      oldestAmbiguousAgeMs: 30_000,
    })
    expect(snapshot.queues).toHaveLength(4)
    expect(snapshot.queues.map((q) => q.name)).toEqual([
      'default',
      'background',
      'domain-events',
      'quarantine',
    ])
    expect(snapshot.workers.defaultQueueName).toBe('default')
    expect(snapshot.workers.heartbeat).toEqual({
      at: FIXED_NOW.toISOString(),
      ageMs: 0,
      stale: false,
    })
    expect(snapshot.notifications.deliveryLag).toMatchObject({
      sourceReceiptPending: 1,
      materializationPending: 2,
      oldestSourceRecordedAt: '2026-01-15T11:58:00.000Z',
      oldestMaterializationSourceRecordedAt: '2026-01-15T11:57:00.000Z',
      oldestMaterializationEnqueuedAt: '2026-01-15T11:59:30.000Z',
      sourceSaturated: false,
      materializationSaturated: true,
      immediateEmailAcceptance: {
        awaitingProviderAcceptance: 1,
        attemptedAwaitingProviderAcceptance: 1,
        oldestAwaitingSourceRecordedAt: '2026-01-15T11:56:00.000Z',
        acceptedLatencyP99Ms: 301_000,
        acceptedSampleCount: 20,
        sourceUnlinked: 0,
        saturated: false,
      },
    })
    // BQC-7.3 runtime section: pool gauges, migration version, cache
    // counters, release + policy identity.
    expect(snapshot.db).toEqual({
      pool: { max: 10, totalCount: 3, idleCount: 2, waitingCount: 0 },
      migrationVersion: 17,
    })
    expect(snapshot.cache.tenant).toEqual({ hits: 5, misses: 2, evictions: 1, size: 3 })
    expect(snapshot.release).toEqual({ sha: 'abc1234' })
    expect(snapshot.jobs).toEqual(JOB_RUNTIME)
    expect(snapshot.guestObservationLoss).toEqual({
      monitorAvailable: true,
      windowMs: 24 * 60 * 60 * 1000,
      precisionMs: 5 * 60 * 1000,
      scanLossCount: 2,
      reviewLinkLossCount: 1,
      ratingLossCount: 0,
      totalLossCount: 3,
      ratingDisposition: 'not_applicable_durable',
    })
    expect(snapshot.versions).toEqual({
      capabilityPolicy: 'test-cap',
      executionPolicy: 'test-exec',
      policyStore: 11,
      sourceContentPolicy: 1,
      runtime: process.version,
    })
    expect(snapshot.degraded).toEqual([])
  })

  it('degrades the health section instead of rejecting when the db read fails', async () => {
    const failingDb = {
      select: vi.fn(() => {
        throw new Error('db down')
      }),
    } as unknown as Database

    const reader = createOperationsSnapshot({
      db: failingDb,
      outboxRepo: fakeOutboxRepo(),
      queues: { default: null, background: null, domainEvents: null, quarantine: null },
      redis: null,
      clock,
      versions: VERSIONS,
      runtime: RUNTIME,
    })

    const snapshot = await reader.read()

    expect(snapshot.degraded).toEqual(['health'])
    expect(snapshot.outbox.unpublishedCount).toBe(0)
    expect(snapshot.timestamp).toBe(FIXED_NOW.toISOString())
    // Null handles are absent, not degraded: queues [] and stale heartbeat.
    expect(snapshot.queues).toEqual([])
    expect(snapshot.workers.heartbeat).toEqual({ at: null, ageMs: null, stale: true })
    // The runtime section is unaffected by a degraded health read.
    expect(snapshot.versions.policyStore).toBe(11)
  })

  it('degrades the queues and heartbeat sections when their reads throw', async () => {
    const throwingQueue = {
      getJobCounts: vi.fn(async () => {
        throw new Error('redis down')
      }),
      getJobs: vi.fn(async () => []),
    }
    const throwingRedis = {
      get: vi.fn(async (): Promise<string | null> => {
        throw new Error('redis down')
      }),
      set: vi.fn(async () => 'OK'),
    }

    const reader = createOperationsSnapshot({
      db: fakeDb([UNPUBLISHED_ROW, CLAIMED_ROW, REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW]),
      outboxRepo: fakeOutboxRepo(),
      // Quarantine null so the health section's quarantine metrics skip the
      // throwing queue and only the depth read degrades.
      queues: {
        default: throwingQueue,
        background: null,
        domainEvents: null,
        quarantine: null,
      },
      redis: throwingRedis,
      clock,
      versions: VERSIONS,
      runtime: RUNTIME,
    })

    const snapshot = await reader.read()

    expect(snapshot.degraded).toEqual(['queues', 'workers.heartbeat'])
    expect(snapshot.queues).toEqual([])
    expect(snapshot.outbox.unpublishedCount).toBe(3)
  })

  it('degrades the runtime section when a runtime read rejects', async () => {
    const reader = createOperationsSnapshot({
      db: fakeDb([UNPUBLISHED_ROW, CLAIMED_ROW, REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW]),
      outboxRepo: fakeOutboxRepo(),
      queues: { default: null, background: null, domainEvents: null, quarantine: null },
      redis: null,
      clock,
      versions: VERSIONS,
      runtime: {
        ...RUNTIME,
        migrationVersion: async () => {
          throw new Error('pool down')
        },
      },
    })

    const snapshot = await reader.read()

    expect(snapshot.degraded).toEqual(['runtime'])
    expect(snapshot.db).toEqual({ pool: null, migrationVersion: null })
    expect(snapshot.release).toEqual({ sha: 'unknown' })
    // Static version identity survives (policy store read nulled).
    expect(snapshot.versions).toEqual({
      capabilityPolicy: 'test-cap',
      executionPolicy: 'test-exec',
      policyStore: null,
      sourceContentPolicy: 1,
      runtime: process.version,
    })
    expect(snapshot.outbox.unpublishedCount).toBe(3)
  })

  it('degrades only the jobs section when the durable runtime report fails', async () => {
    const reader = createOperationsSnapshot({
      db: fakeDb([UNPUBLISHED_ROW, CLAIMED_ROW, REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW]),
      outboxRepo: fakeOutboxRepo(),
      queues: { default: null, background: null, domainEvents: null, quarantine: null },
      redis: null,
      clock,
      versions: VERSIONS,
      runtime: RUNTIME,
      jobRuntime: {
        read: async () => {
          throw new Error('queue redis down')
        },
      },
    })

    const snapshot = await reader.read()
    expect(snapshot.jobs).toBeUndefined()
    expect(snapshot.degraded).toEqual(['jobs'])
    expect(snapshot.outbox.unpublishedCount).toBe(3)
  })

  it('marks Guest observation-loss visibility degraded without inventing durable-rating loss', async () => {
    const reader = createOperationsSnapshot({
      db: fakeDb([UNPUBLISHED_ROW, CLAIMED_ROW, REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW]),
      outboxRepo: fakeOutboxRepo(),
      queues: { default: null, background: null, domainEvents: null, quarantine: null },
      redis: null,
      clock,
      versions: VERSIONS,
      runtime: RUNTIME,
      readGuestObservationLoss: async () => {
        throw new Error('cache redis down')
      },
    })

    const snapshot = await reader.read()
    expect(snapshot.guestObservationLoss).toEqual({
      monitorAvailable: false,
      windowMs: 24 * 60 * 60 * 1000,
      precisionMs: 5 * 60 * 1000,
      scanLossCount: 0,
      reviewLinkLossCount: 0,
      ratingLossCount: 0,
      totalLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    })
    expect(snapshot.degraded).toContain('guest.observationLoss')
  })

  it('uses a 5s default section budget', () => {
    expect(OPS_SECTION_BUDGET_MS).toBe(5000)
  })
})
