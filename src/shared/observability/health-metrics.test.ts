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
const SYNC_ROW = [{ due: 0, failed: 0, oldest_due_age_ms: null }]
/** Notification email queue aggregate (overdue count, age, attempted). */
const NOTIFICATION_ROW = [{ overdue: 0, oldest_overdue_age_ms: null, attempted: 0 }]
/** BQC-7.3: reply publication aggregate (one row, all states + age). */
const PUBLICATION_ROW = [
  {
    requested: 0,
    authorized: 0,
    sending: 0,
    published: 0,
    terminal: 0,
    ambiguous: 0,
    cancelled: 0,
    oldest_ambiguous_age_ms: null,
  },
]

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
      PUBLICATION_ROW,
      NOTIFICATION_ROW,
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
      PUBLICATION_ROW,
      NOTIFICATION_ROW,
    ])

    const snapshot = await createHealthChecker(db, fakeOutboxRepo([])).check()

    expect(snapshot.outbox.claimedCount).toBe(0)
    expect(snapshot.outbox.oldestClaimedAgeMs).toBeNull()
    expect(snapshot.outbox.stalledLeaseCount).toBe(0)
    expect(snapshot.outbox.expiredLeaseCount).toBe(0)
  })

  it('zeroes outbox metrics when no outbox repo is available', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW, NOTIFICATION_ROW])
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
    // Both quarantine tests spell out their own fakeQuarantine + fakeDb
    // queue. fakeDb hands back queued rows in db.select() CALL ORDER, so the
    // queue is a positional transcript of the queries the health checker
    // issues; writing it out per test is what keeps that order auditable
    // next to the snapshot assertion.
    // A shared queue helper would hide the ordering contract behind a name,
    // so a reordering of the checker's reads would break silently instead of
    // failing where the rows are visible.
    // Revisit when the checker names its reads explicitly instead of
    // consuming a positional queue.
    // fallow-ignore-next-line code-duplication
    const quarantine = fakeQuarantine({ waiting: 2, delayed: 1 }, [
      { data: { quarantinedAt: oneHourAgo } },
      { data: { redacted: true }, timestamp: Date.now() },
    ])
    const db = fakeDb([
      [{ cnt: 0, age_ms: null }],
      [{ claimed: 0, oldest_claimed_age_ms: null, stalled: 0 }],
      REVIEW_ROW,
      SYNC_ROW,
      PUBLICATION_ROW,
      NOTIFICATION_ROW,
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
      PUBLICATION_ROW,
      NOTIFICATION_ROW,
    ])

    const snapshot = await createHealthChecker(db, fakeOutboxRepo([]), {
      quarantineQueue: quarantine,
    }).check()

    expect(snapshot.quarantine).toEqual({ count: 0, oldestAgeMs: null })
  })
})

// BQC-4.3 — raw content never appears in the global control plane (ADR
// 0048/0030): the health/metrics snapshot is counts and ages only. Marker
// content strings are planted in every fake row/payload the checker reads;
// none may survive into the serialized snapshot.
describe('health checker content safety (BQC-4.3)', () => {
  const MARKERS = ['SECRET_REVIEW_TEXT', 'SECRET_REPLY_TEXT', 'SECRET_REVIEWER_NAME']

  it('no marker content from DB rows or quarantine payloads appears in the snapshot', async () => {
    const db = fakeDb([
      // Every row carries planted content fields the query must never read.
      [
        {
          cnt: 2,
          age_ms: 1000,
          payload: 'SECRET_REVIEW_TEXT',
          text: 'SECRET_REPLY_TEXT',
        },
      ],
      [
        {
          claimed: 1,
          oldest_claimed_age_ms: 500,
          stalled: 0,
          payload: 'SECRET_REVIEWER_NAME',
        },
      ],
      [
        {
          total: 7,
          refresh_due: 1,
          expired: 0,
          oldest_due_age_seconds: 3600,
          text: 'SECRET_REVIEW_TEXT',
          reviewerName: 'SECRET_REVIEWER_NAME',
        },
      ],
      [
        {
          due: 3,
          failed: 1,
          oldest_due_age_ms: 900_000,
          lastError: 'SECRET_REPLY_TEXT',
        },
      ],
      [
        {
          requested: 1,
          authorized: 0,
          sending: 1,
          published: 5,
          terminal: 2,
          ambiguous: 1,
          cancelled: 0,
          oldest_ambiguous_age_ms: 120_000,
          text: 'SECRET_REPLY_TEXT',
        },
      ],
      [
        {
          overdue: 4,
          oldest_overdue_age_ms: 3_600_000,
          attempted: 1,
          subject: 'SECRET_REVIEW_TEXT',
          recipient: 'SECRET_REVIEWER_NAME',
        },
      ],
    ])
    const repo = fakeOutboxRepo([{ id: 'x', payload: 'SECRET_REVIEW_TEXT' }])
    const quarantine = fakeQuarantine({ waiting: 1 }, [
      {
        data: {
          quarantinedAt: new Date(Date.now() - 60_000).toISOString(),
          data: { reviewText: 'SECRET_REVIEW_TEXT', replyText: 'SECRET_REPLY_TEXT' },
          failedReason: 'Error: SECRET_REVIEWER_NAME saw SECRET_REVIEW_TEXT',
        },
      },
    ])

    const snapshot = await createHealthChecker(db, repo, {
      quarantineQueue: quarantine,
    }).check()
    const serialized = JSON.stringify(snapshot)

    for (const marker of MARKERS) {
      expect(serialized).not.toContain(marker)
    }
    // Pin the counts/ages-only shape so a future field cannot smuggle content.
    expect(snapshot).toEqual({
      timestamp: expect.any(String),
      outbox: {
        unpublishedCount: 2,
        oldestUnpublishedAgeMs: 1000,
        expiredLeaseCount: 1,
        claimedCount: 1,
        oldestClaimedAgeMs: 500,
        stalledLeaseCount: 0,
      },
      quarantine: { count: 1, oldestAgeMs: expect.any(Number) },
      reviews: {
        totalActive: 7,
        refreshDueCount: 1,
        expiredCount: 0,
        oldestDueAgeSeconds: 3600,
      },
      sync: {
        dueForIncrementalCount: 3,
        failedSyncCount: 1,
        oldestDueAgeMs: 900_000,
        gbpPushEnabled: false,
      },
      notifications: {
        emailDeliveryEnabled: false,
        pendingOverdueCount: 4,
        oldestPendingOverdueAgeMs: 3_600_000,
        attemptedStuckCount: 1,
        missingForInboxItemCount: 0,
        deliveryLag: {
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
      },
      replyPublication: {
        counts: {
          requested: 1,
          authorized: 0,
          sending: 1,
          published: 5,
          terminal: 2,
          ambiguous: 1,
          cancelled: 0,
        },
        oldestAmbiguousAgeMs: 120_000,
      },
      workers: {
        defaultQueueName: 'default',
        backgroundQueueName: 'background',
        domainEventsQueueName: 'domain-events',
      },
    })
  })

  it('surfaces the GBP push readiness fact from the composition root', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW, NOTIFICATION_ROW])

    const dark = await createHealthChecker(db).check()
    expect(dark.sync.gbpPushEnabled).toBe(false)

    const live = await createHealthChecker(db, undefined, {
      gbpPushEnabled: true,
    }).check()
    expect(live.sync.gbpPushEnabled).toBe(true)
  })
})

// The freshness/delivery signals this branch adds: a COUNT of due properties
// or pending emails cannot distinguish a sweep mid-run from a dead one, so
// each carries an oldest-overdue AGE alongside it.
describe('health checker sync freshness', () => {
  it('reports the oldest overdue age alongside the due count', async () => {
    const db = fakeDb([
      REVIEW_ROW,
      [{ due: 12, failed: 0, oldest_due_age_ms: 3_600_000.4 }],
      PUBLICATION_ROW,
      NOTIFICATION_ROW,
    ])

    const snapshot = await createHealthChecker(db).check()

    expect(snapshot.sync.dueForIncrementalCount).toBe(12)
    // Rounded — the epoch arithmetic yields a float.
    expect(snapshot.sync.oldestDueAgeMs).toBe(3_600_000)
  })

  it('reports a null overdue age when nothing is due', async () => {
    const db = fakeDb([
      REVIEW_ROW,
      [{ due: 0, failed: 0, oldest_due_age_ms: null }],
      PUBLICATION_ROW,
      NOTIFICATION_ROW,
    ])

    const snapshot = await createHealthChecker(db).check()

    expect(snapshot.sync.dueForIncrementalCount).toBe(0)
    expect(snapshot.sync.oldestDueAgeMs).toBeNull()
  })
})

describe('health checker notification delivery metrics', () => {
  it('reports the overdue email backlog, its oldest age, and the attempted subset', async () => {
    const db = fakeDb([
      REVIEW_ROW,
      SYNC_ROW,
      PUBLICATION_ROW,
      [{ overdue: 9, oldest_overdue_age_ms: 7_200_001.6, attempted: 2 }],
    ])

    const snapshot = await createHealthChecker(db).check()

    expect(snapshot.notifications.pendingOverdueCount).toBe(9)
    expect(snapshot.notifications.oldestPendingOverdueAgeMs).toBe(7_200_002)
    expect(snapshot.notifications.attemptedStuckCount).toBe(2)
  })

  it('defaults the email queue metrics to empty when the aggregate returns no row', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW, []])

    const snapshot = await createHealthChecker(db).check()

    expect(snapshot.notifications).toMatchObject({
      emailDeliveryEnabled: false,
      pendingOverdueCount: 0,
      oldestPendingOverdueAgeMs: null,
      attemptedStuckCount: 0,
    })
  })

  it('surfaces the injected notification-gap count, defaulting to no known gap', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW, NOTIFICATION_ROW])

    // The query belongs to the notification context, so shared/** cannot run
    // it — an unwired deployment must report "no known gap", never invent one.
    const unwired = await createHealthChecker(db).check()
    expect(unwired.notifications.missingForInboxItemCount).toBe(0)

    const wired = await createHealthChecker(db, undefined, {
      readMissingNotificationCount: async () => 7,
    }).check()
    expect(wired.notifications.missingForInboxItemCount).toBe(7)
  })

  it('surfaces bounded content-free delivery lag clocks, ages, and saturation', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW, NOTIFICATION_ROW])
    const source = new Date(Date.now() - 61_000)
    const enqueued = new Date(Date.now() - 30_000)

    const snapshot = await createHealthChecker(db, undefined, {
      readNotificationDeliveryLag: async () => ({
        sourceReceiptPending: 2,
        materializationPending: 3,
        oldestSourceRecordedAt: source,
        oldestMaterializationSourceRecordedAt: source,
        oldestMaterializationEnqueuedAt: enqueued,
        sourceSaturated: true,
        materializationSaturated: false,
        immediateEmailAcceptance: {
          awaitingProviderAcceptance: 4,
          attemptedAwaitingProviderAcceptance: 2,
          oldestAwaitingSourceRecordedAt: source,
          acceptedLatencyP99Ms: 301_000,
          acceptedSampleCount: 19,
          sourceUnlinked: 1,
          saturated: false,
          private: 'SECRET_EMAIL_CONTENT',
        },
        private: 'SECRET_REVIEW_TEXT',
      }),
    }).check()

    expect(snapshot.notifications.deliveryLag).toEqual({
      sourceReceiptPending: 2,
      materializationPending: 3,
      oldestSourceRecordedAt: source.toISOString(),
      oldestSourceAgeMs: expect.any(Number),
      oldestMaterializationSourceRecordedAt: source.toISOString(),
      oldestMaterializationSourceAgeMs: expect.any(Number),
      oldestMaterializationEnqueuedAt: enqueued.toISOString(),
      oldestMaterializationEnqueuedAgeMs: expect.any(Number),
      sourceSaturated: true,
      materializationSaturated: false,
      immediateEmailAcceptance: {
        awaitingProviderAcceptance: 4,
        attemptedAwaitingProviderAcceptance: 2,
        oldestAwaitingSourceRecordedAt: source.toISOString(),
        oldestAwaitingSourceAgeMs: expect.any(Number),
        acceptedLatencyP99Ms: 301_000,
        acceptedSampleCount: 19,
        sourceUnlinked: 1,
        saturated: false,
      },
    })
    expect(snapshot.notifications.deliveryLag.oldestSourceAgeMs).toBeGreaterThanOrEqual(
      61_000,
    )
    expect(JSON.stringify(snapshot.notifications.deliveryLag)).not.toContain(
      'SECRET_REVIEW_TEXT',
    )
    expect(JSON.stringify(snapshot.notifications.deliveryLag)).not.toContain(
      'SECRET_EMAIL_CONTENT',
    )
  })

  it('surfaces the email-delivery readiness fact from the composition root', async () => {
    const db = fakeDb([REVIEW_ROW, SYNC_ROW, PUBLICATION_ROW, NOTIFICATION_ROW])

    // Absent = dark, the honest default: outbound email is capability-gated
    // and a pending backlog must not read as a fault.
    const dark = await createHealthChecker(db).check()
    expect(dark.notifications.emailDeliveryEnabled).toBe(false)

    const live = await createHealthChecker(db, undefined, {
      emailDeliveryEnabled: true,
    }).check()
    expect(live.notifications.emailDeliveryEnabled).toBe(true)
  })
})
