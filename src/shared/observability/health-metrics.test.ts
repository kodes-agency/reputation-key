// BQC-3.7 — health-metrics unit tests (fake db + fake quarantine port).
// New alert-substrate counters: claimed/stalled leases and quarantine depth,
// plus the findExpiredLeases-backed expired-lease signal.

import { describe, it, expect, vi } from 'vitest'
import { createHealthChecker, type QuarantineMetricsPort } from './health-metrics'
import type { Database } from '#/shared/db'
import type { OutboxRepository } from '#/shared/outbox'

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

const REVIEW_ROW = [
  { total: 0, refresh_due: 0, expired: 0, oldest_due_age_seconds: null },
]
const SYNC_ROW = [{ due: 0, failed: 0 }]

function fakeOutboxRepo(expiredRows: unknown[]): OutboxRepository {
  return {
    findExpiredLeases: vi.fn(async () => expiredRows),
  } as unknown as OutboxRepository
}

function fakeQuarantine(
  counts: Partial<Record<string, number>>,
  jobs: ReadonlyArray<{ data: unknown; timestamp?: number }>,
): QuarantineMetricsPort {
  return {
    getJobCounts: vi.fn(async () => counts),
    getJobs: vi.fn(async () => jobs),
  }
}

describe('health checker outbox metrics (BQC-3.7)', () => {
  it('computes claimed/stalled lease counters and the expired-lease signal', async () => {
    const db = fakeDb([
      [{ cnt: 3, age_ms: 600_000 }], // unpublished aggregate
      [{ claimed: 2, oldest_claimed_age_ms: 45_000, stalled: 1 }], // claimed/stalled
      REVIEW_ROW,
      SYNC_ROW,
    ])
    const repo = fakeOutboxRepo([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])

    const snapshot = await createHealthChecker(db, repo).check()

    expect(snapshot.outbox).toEqual({
      unpublishedCount: 3,
      oldestUnpublishedAgeMs: 600_000,
      expiredLeaseCount: 4,
      claimedCount: 2,
      oldestClaimedAgeMs: 45_000,
      stalledLeaseCount: 1,
    })
  })

  it('reports null oldestClaimedAgeMs and zero counters when nothing is claimed', async () => {
    const db = fakeDb([
      [{ cnt: 0, age_ms: null }],
      [{ claimed: 0, oldest_claimed_age_ms: null, stalled: 0 }],
      REVIEW_ROW,
      SYNC_ROW,
    ])

    const snapshot = await createHealthChecker(db, fakeOutboxRepo([])).check()

    expect(snapshot.outbox.claimedCount).toBe(0)
    expect(snapshot.outbox.oldestClaimedAgeMs).toBeNull()
    expect(snapshot.outbox.stalledLeaseCount).toBe(0)
    expect(snapshot.outbox.expiredLeaseCount).toBe(0)
  })

  it('zeroes outbox metrics when no outbox repo is available', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW])
    const snapshot = await createHealthChecker(db).check()

    expect(snapshot.outbox).toEqual({
      unpublishedCount: 0,
      oldestUnpublishedAgeMs: null,
      expiredLeaseCount: 0,
      claimedCount: 0,
      oldestClaimedAgeMs: null,
      stalledLeaseCount: 0,
    })
    expect(snapshot.quarantine).toBeNull()
  })
})

describe('health checker quarantine metrics (BQC-3.7)', () => {
  it('counts waiting/delayed quarantined jobs and the oldest age', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const quarantine = fakeQuarantine({ waiting: 2, delayed: 1 }, [
      { data: { quarantinedAt: oneHourAgo } },
      { data: { redacted: true }, timestamp: Date.now() },
    ])
    const db = fakeDb([
      [{ cnt: 0, age_ms: null }],
      [{ claimed: 0, oldest_claimed_age_ms: null, stalled: 0 }],
      REVIEW_ROW,
      SYNC_ROW,
    ])

    const snapshot = await createHealthChecker(db, fakeOutboxRepo([]), {
      quarantineQueue: quarantine,
    }).check()

    expect(snapshot.quarantine).not.toBeNull()
    expect(snapshot.quarantine!.count).toBe(3)
    expect(snapshot.quarantine!.oldestAgeMs).toBeGreaterThan(3_500_000)
    expect(snapshot.quarantine!.oldestAgeMs).toBeLessThanOrEqual(3_700_000)
  })

  it('reports null oldestAgeMs for an empty quarantine', async () => {
    const quarantine = fakeQuarantine({ waiting: 0 }, [])
    const db = fakeDb([
      [{ cnt: 0, age_ms: null }],
      [{ claimed: 0, oldest_claimed_age_ms: null, stalled: 0 }],
      REVIEW_ROW,
      SYNC_ROW,
    ])

    const snapshot = await createHealthChecker(db, fakeOutboxRepo([]), {
      quarantineQueue: quarantine,
    }).check()

    expect(snapshot.quarantine).toEqual({ count: 0, oldestAgeMs: null })
  })
})
