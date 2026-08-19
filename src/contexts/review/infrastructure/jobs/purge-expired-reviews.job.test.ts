// Unit tests for purge expired reviews job handler
//
// BQC-3.3: the handler no longer emits-then-deletes. Each expired review is
// purged via ReplyCommandStore.purgeExpiredReview — review delete and the
// review.expired outbox fact commit in ONE transaction (atomicity proven in
// reply-command-store.test.ts unit + integration suites). A review whose
// purge tx fails stays in place and is retried on the next sweep.
//
// BQC-8.3: the one-shot 5,000-row scan is replaced by a keyset-bounded batch
// loop (findExpiredBatchBeforeAcrossTenants, ordered (contentExpiresAt, id)):
//   - one run drains at most maxBatches × batchSize rows (100 × 500 = 50k,
//     the BQC-3.7 per-run drain bound) and reports 'budget_exhausted' when it
//     stops at the cap with rows (likely) remaining — the vocabulary mirrors
//     the refresh sweep's review_refresh_runs.status enum;
//   - a failed review does NOT hold the cursor: it is skipped for the rest of
//     the run and retried on the next sweep (fresh runs start cursor-less, so
//     the oldest-first walk always re-covers leftovers — expired rows never
//     un-expire, hence no cross-run cursor table);
//   - evidence stays one retention_runs row per run (subject 'reviews.purge')
//     with the batches/rows totals; capped runs close 'completed' per the
//     BQC-3.7 retention-sweep convention.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Review } from '../../domain/types'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import { reviewId, propertyId, organizationId } from '#/shared/domain/ids'
import { createPurgeExpiredReviewsHandler } from './purge-expired-reviews.job'
import { openRetentionRun, closeRetentionRun } from '#/shared/db/retention/evidence'
import type { Database } from '#/shared/db'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

vi.mock('#/shared/db/retention/evidence', () => ({
  openRetentionRun: vi.fn(async () => 'run-evidence-1'),
  closeRetentionRun: vi.fn(async () => {}),
  failRetentionRun: vi.fn(async () => {}),
}))

const mockedOpen = vi.mocked(openRetentionRun)
const mockedClose = vi.mocked(closeRetentionRun)

function makeReview(overrides: Partial<Review> = {}): Review {
  const lastFetchedAt = new Date('2025-01-01')
  const contentExpiresAt = new Date('2025-01-31')
  return {
    id: reviewId('rev-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'loc-1',
    googleConnectionId: null,
    reviewerName: null,
    reviewerProfilePhotoUrl: null,
    rating: 3,
    text: null,
    translatedText: null,
    languageCode: null,
    reviewedAt: lastFetchedAt,
    expiresAt: contentExpiresAt,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: lastFetchedAt,
    sourceUpdatedAt: null,
    firstFetchedAt: lastFetchedAt,
    lastFetchedAt,
    contentExpiresAt,
    contentHash: 'abc',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    createdAt: lastFetchedAt,
    updatedAt: lastFetchedAt,
    ...overrides,
  }
}

type PurgeCall = Readonly<{ reviewId: string; event: Record<string, unknown> }>

/** Fake command store recording successful purges; can fail specific reviews. */
function makeCommandStore(
  opts: {
    failFor?: ReadonlyArray<string>
    onPurged?: (id: string) => void
  } = {},
) {
  const calls: PurgeCall[] = []
  const store: ReplyCommandStore = {
    submitReply: vi.fn(),
    rejectReply: vi.fn(),
    markPublished: vi.fn(),
    markPublicationAuthorized: vi.fn(),
    markPublicationSending: vi.fn(),
    markPublicationTerminal: vi.fn(),
    markPublicationAmbiguous: vi.fn(),
    markPublicationRetryQueued: vi.fn(),
    editPublishedReply: vi.fn(),
    cancelPublications: vi.fn(),
    mirrorSyncedReply: vi.fn(),
    purgeExpiredReview: vi.fn(async (id, event) => {
      if (opts.failFor?.includes(String(id))) throw new Error('purge tx failed')
      calls.push({ reviewId: String(id), event: event as Record<string, unknown> })
      opts.onPurged?.(String(id))
    }),
  }
  return { store, calls }
}

type RepoCall = Readonly<{
  date: Date
  cursor: Readonly<{ contentExpiresAt: Date; id: string }> | null
  limit: number
}>

/**
 * Fake repo honouring the keyset contract: exclusive contentExpiresAt bound,
 * (contentExpiresAt, id) ASC order, cursor resumes strictly after the tuple.
 * `rows` is mutable so tests can simulate the real delete-on-purge.
 */
function makePagingRepo(rows: Review[]) {
  const calls: RepoCall[] = []
  const repo = {
    findExpiredBatchBeforeAcrossTenants: vi.fn(
      async (
        date: Date,
        cursor: Readonly<{ contentExpiresAt: Date; id: string }> | null,
        limit: number,
      ) => {
        calls.push({ date, cursor, limit })
        const eligible = rows
          .filter((r) => r.contentExpiresAt !== null && r.contentExpiresAt < date)
          .sort((a, b) => {
            const t =
              (a.contentExpiresAt as Date).getTime() -
              (b.contentExpiresAt as Date).getTime()
            return t !== 0 ? t : String(a.id).localeCompare(String(b.id))
          })
        const start = cursor
          ? eligible.findIndex(
              (r) =>
                r.contentExpiresAt !== null &&
                (r.contentExpiresAt > cursor.contentExpiresAt ||
                  (r.contentExpiresAt.getTime() === cursor.contentExpiresAt.getTime() &&
                    String(r.id) > cursor.id)),
            )
          : 0
        // findIndex is -1 when the cursor is past every row — the batch is empty.
        return start < 0 ? [] : eligible.slice(start, start + limit)
      },
    ),
  }
  return { repo: repo as unknown as ReviewRepository, calls }
}

/** Reviews expiring minute-by-minute from a base instant, ids rev-N. */
function makeExpiredSeries(count: number, base = '2025-01-31T00:00:00Z'): Review[] {
  const start = new Date(base).getTime()
  return Array.from({ length: count }, (_, i) =>
    makeReview({
      id: reviewId(`rev-${String(i + 1).padStart(3, '0')}`),
      contentExpiresAt: new Date(start + i * 60_000),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPurgeExpiredReviewsHandler', () => {
  // ── Happy path ───────────────────────────────────────────────────

  it('purges every expired review via the command store', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-1') }),
      makeReview({ id: reviewId('rev-2') }),
      makeReview({ id: reviewId('rev-3') }),
    ]
    const { repo } = makePagingRepo(reviews)
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
    })

    await handler({} as never)

    expect(calls.map((c) => c.reviewId)).toEqual(['rev-1', 'rev-2', 'rev-3'])
  })

  it('passes a review.expired fact with reviewId, propertyId, orgId, occurredAt', async () => {
    const review = makeReview({
      id: reviewId('rev-42'),
      propertyId: propertyId('prop-99'),
      organizationId: organizationId('org-7'),
    })
    const fixedDate = new Date('2025-06-01T08:30:00Z')
    const { repo } = makePagingRepo([review])
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => fixedDate),
    })

    await handler({} as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.event).toEqual(
      expect.objectContaining({
        _tag: 'review.expired',
        reviewId: reviewId('rev-42'),
        propertyId: propertyId('prop-99'),
        organizationId: organizationId('org-7'),
        occurredAt: fixedDate,
      }),
    )
  })

  // ── BQC-8.3: keyset batch loop ───────────────────────────────────

  it('drains multiple keyset batches within one run, oldest first', async () => {
    const reviews = makeExpiredSeries(5)
    const { repo, calls: repoCalls } = makePagingRepo(reviews)
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 10,
    })

    const result = await handler({} as never)

    expect(calls.map((c) => c.reviewId)).toEqual([
      'rev-001',
      'rev-002',
      'rev-003',
      'rev-004',
      'rev-005',
    ])
    expect(result).toEqual({
      status: 'completed',
      batches: 3,
      purged: 5,
      failed: 0,
      batchRows: [2, 2, 1],
    })
    // Cursor advances by the (contentExpiresAt, id) tuple of each batch's
    // last row; the run ends on an empty fetch.
    expect(repoCalls).toHaveLength(4)
    expect(repoCalls[0]!.cursor).toBeNull()
    expect(repoCalls[1]!.cursor).toEqual({
      contentExpiresAt: new Date('2025-01-31T00:01:00Z'),
      id: 'rev-002',
    })
    expect(repoCalls[2]!.cursor).toEqual({
      contentExpiresAt: new Date('2025-01-31T00:03:00Z'),
      id: 'rev-004',
    })
    expect(repoCalls[3]!.cursor).toEqual({
      contentExpiresAt: new Date('2025-01-31T00:04:00Z'),
      id: 'rev-005',
    })
    expect(repoCalls.every((c) => c.limit === 2)).toBe(true)
  })

  it('stops at the batch cap with budget_exhausted when a full batch leaves rows behind', async () => {
    const reviews = makeExpiredSeries(6)
    const { repo } = makePagingRepo(reviews)
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 2,
    })

    const result = await handler({} as never)

    expect(result).toEqual({
      status: 'budget_exhausted',
      batches: 2,
      purged: 4,
      failed: 0,
      batchRows: [2, 2],
    })
    expect(calls).toHaveLength(4)
  })

  it('reports completed when the drain finishes exactly at the cap (partial final batch)', async () => {
    const reviews = makeExpiredSeries(5)
    const { repo } = makePagingRepo(reviews)
    const { store } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 3,
    })

    const result = await handler({} as never)

    // 2+2+1: the cap is reached on a partial batch — the set is drained.
    expect(result.status).toBe('completed')
    expect(result.batches).toBe(3)
    expect(result.purged).toBe(5)
  })

  it('drives follow-up runs to full coverage: a budget-exhausted run leaves the remainder for the next sweep', async () => {
    const rows = makeExpiredSeries(5)
    const { repo } = makePagingRepo(rows)
    const { store, calls } = makeCommandStore({
      // Simulate the real delete-on-purge so the second sweep only sees the
      // rows the first run did not reach.
      onPurged: (id) => {
        const i = rows.findIndex((r) => String(r.id) === id)
        if (i >= 0) rows.splice(i, 1)
      },
    })
    const deps = {
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 2,
    }

    const first = await createPurgeExpiredReviewsHandler(deps)({} as never)
    const second = await createPurgeExpiredReviewsHandler(deps)({} as never)

    expect(first.status).toBe('budget_exhausted')
    expect(first.purged).toBe(4)
    expect(second.status).toBe('completed')
    expect(second.purged).toBe(1)
    expect(calls.map((c) => c.reviewId)).toEqual([
      'rev-001',
      'rev-002',
      'rev-003',
      'rev-004',
      'rev-005',
    ])
  })

  // ── ADR 0031: no post-expiry grace ───────────────────────────────

  it('uses now as exclusive contentExpiresAt threshold (no 3-day grace)', async () => {
    const now = new Date('2025-12-31T23:59:59.999Z')
    const { repo, calls } = makePagingRepo([])

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: makeCommandStore().store,
      clock: vi.fn(() => now),
    })

    await handler({} as never)

    expect(calls[0]!.date.getTime()).toBe(now.getTime())
  })

  it('uses a single clock reading for the threshold and every occurredAt', async () => {
    const threshold = new Date('2025-01-10T00:00:00Z')
    const later = new Date('2025-01-10T00:00:05Z')
    // Successive readings differ — the run must pin the FIRST reading as the
    // threshold for all batches and all review.expired facts.
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(threshold)
      .mockReturnValue(later)
    const reviews = makeExpiredSeries(3, '2025-01-05T00:00:00Z')
    const { repo, calls: repoCalls } = makePagingRepo(reviews)
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock,
      batchSize: 2,
      maxBatches: 10,
    })

    await handler({} as never)

    expect(repoCalls.length).toBeGreaterThan(0)
    expect(repoCalls.every((c) => c.date === threshold)).toBe(true)
    expect(calls.every((c) => c.event.occurredAt === threshold)).toBe(true)
  })

  // ── Error resilience ─────────────────────────────────────────────

  it('continues when a purge fails for one review — the failed review is left for the next sweep', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-ok') }),
      makeReview({ id: reviewId('rev-fail'), contentExpiresAt: new Date('2025-02-01') }),
      makeReview({ id: reviewId('rev-ok-2'), contentExpiresAt: new Date('2025-02-02') }),
    ]
    const { repo } = makePagingRepo(reviews)
    const { store, calls } = makeCommandStore({ failFor: ['rev-fail'] })

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
    })

    const result = await handler({} as never)

    // All 3 attempted (store called per review); only the two successful
    // purges recorded. rev-fail's tx threw before commit, so its review row
    // and its (absent) outbox row stay consistent — retried next sweep.
    expect(store.purgeExpiredReview).toHaveBeenCalledTimes(3)
    expect(calls.map((c) => c.reviewId)).toEqual(['rev-ok', 'rev-ok-2'])
    expect(result).toMatchObject({ status: 'completed', purged: 2, failed: 1 })
  })

  it('does not hold the cursor on a failed review — the batch loop cannot livelock', async () => {
    // A permanently failing first row: if the cursor were held before it,
    // every batch would re-fetch the same row forever.
    const reviews = makeExpiredSeries(4)
    const { repo } = makePagingRepo(reviews)
    const { store } = makeCommandStore({ failFor: ['rev-001'] })

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 5,
    })

    const result = await handler({} as never)

    expect(result).toMatchObject({ status: 'completed', purged: 3, failed: 1 })
    expect(result.batches).toBe(2)
  })

  it('a review failed in one run is retried on the next sweep (fresh cursor)', async () => {
    const rows = makeExpiredSeries(2)
    const { repo } = makePagingRepo(rows)
    const { store, calls } = makeCommandStore({
      failFor: ['rev-001'],
      onPurged: (id) => {
        const i = rows.findIndex((r) => String(r.id) === id)
        if (i >= 0) rows.splice(i, 1)
      },
    })
    const deps = {
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 1,
      maxBatches: 1,
    }

    const first = await createPurgeExpiredReviewsHandler(deps)({} as never)
    // rev-001 fails; the run is exhausted after one batch.
    expect(first).toMatchObject({ status: 'budget_exhausted', purged: 0, failed: 1 })
    const second = await createPurgeExpiredReviewsHandler({ ...deps, maxBatches: 5 })(
      {} as never,
    )
    // Fresh cursor: the failed review is re-attempted (and fails again), then
    // the walk proceeds past it and purges rev-002.
    expect(second.failed).toBe(1)
    expect(calls.map((c) => c.reviewId)).toEqual(['rev-002'])
  })

  // ── BQC-1.6 evidence ─────────────────────────────────────────────

  it('writes one content-free evidence row per run with batch + row totals', async () => {
    const reviews = makeExpiredSeries(5)
    const { repo } = makePagingRepo(reviews)
    const { store } = makeCommandStore()
    const db = {} as Database

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 10,
      db,
    })

    await handler({} as never)

    expect(mockedOpen).toHaveBeenCalledWith(
      db,
      'reviews.purge',
      2,
      new Date('2025-06-01T12:00:00Z'),
    )
    expect(mockedClose).toHaveBeenCalledWith(
      db,
      'run-evidence-1',
      expect.objectContaining({
        batches: 3,
        rowsDeleted: 5,
        outcome: 'completed',
      }),
    )
  })

  it('closes the evidence row failed when any purge tx failed', async () => {
    const reviews = makeExpiredSeries(3)
    const { repo } = makePagingRepo(reviews)
    const { store } = makeCommandStore({ failFor: ['rev-002'] })
    const db = {} as Database

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 5,
      maxBatches: 10,
      db,
    })

    const result = await handler({} as never)

    expect(result.failed).toBe(1)
    expect(mockedClose).toHaveBeenCalledWith(
      db,
      'run-evidence-1',
      expect.objectContaining({
        outcome: 'failed',
        errorCode: '1 purge failure(s)',
        rowsDeleted: 2,
      }),
    )
  })

  it('closes capped runs completed per the BQC-3.7 convention; the cap shows in the result status', async () => {
    const reviews = makeExpiredSeries(6)
    const { repo } = makePagingRepo(reviews)
    const { store } = makeCommandStore()
    const db = {} as Database

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
      batchSize: 2,
      maxBatches: 2,
      db,
    })

    const result = await handler({} as never)

    expect(result.status).toBe('budget_exhausted')
    expect(mockedClose).toHaveBeenCalledWith(
      db,
      'run-evidence-1',
      expect.objectContaining({ outcome: 'completed', batches: 2, rowsDeleted: 4 }),
    )
  })

  // ── Edge cases ───────────────────────────────────────────────────

  it('does nothing when no expired reviews', async () => {
    const { repo } = makePagingRepo([])
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: repo,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
    })

    const result = await handler({} as never)

    expect(calls).toHaveLength(0)
    expect(store.purgeExpiredReview).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'completed',
      batches: 0,
      purged: 0,
      failed: 0,
      batchRows: [],
    })
  })
})
