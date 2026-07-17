// Unit tests for refresh expiring reviews job handler (BQC-1.5).
// Tests: keyset cursor batches, budget stop + resume, enqueue-failure
// semantics (never acknowledged as success), run-state persistence,
// oldest-due alerting.

import { describe, it, expect, vi } from 'vitest'
import type { Review } from '../../domain/types'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import type {
  RefreshRun,
  RefreshRunCursor,
  RefreshRunPatch,
  ReviewRefreshRunRepository,
} from '../../application/ports/review-refresh-run.repository'
import {
  reviewId,
  propertyId,
  organizationId,
  googleConnectionId,
} from '#/shared/domain/ids'
import { createRefreshExpiringReviewsHandler } from './refresh-expiring-reviews.job'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

const ORG_ID = organizationId('org-1')
const PROP_A = propertyId('prop-a')
const PROP_B = propertyId('prop-b')
const CONN_ID = googleConnectionId('conn-1')
const NOW = new Date('2025-06-01T12:00:00.000Z')
const DAYS = 24 * 60 * 60 * 1000

/** Review in the refresh_due window (fetched 27 days ago; expires in 3 days). */
function makeRefreshDueReview(overrides: Partial<Review> = {}): Review {
  const lastFetchedAt = new Date(NOW.getTime() - 27 * DAYS)
  const contentExpiresAt = new Date(lastFetchedAt.getTime() + 30 * DAYS)
  return {
    id: reviewId(`rev-${Math.random().toString(36).slice(2, 8)}`),
    organizationId: ORG_ID,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: CONN_ID,
    reviewerName: null,
    reviewerProfilePhotoUrl: null,
    rating: 3,
    text: null,
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
    createdAt: lastFetchedAt,
    updatedAt: lastFetchedAt,
    ...overrides,
  }
}

function makeExpiredReview(): Review {
  const lastFetchedAt = new Date(NOW.getTime() - 35 * DAYS)
  return makeRefreshDueReview({
    lastFetchedAt,
    contentExpiresAt: new Date(lastFetchedAt.getTime() + 30 * DAYS),
  })
}

type RunRepoFake = ReviewRefreshRunRepository & {
  runs: RefreshRun[]
  updates: Array<{ id: string; patch: RefreshRunPatch }>
}

function makeRunRepo(latest: RefreshRun | null = null): RunRepoFake {
  const runs: RefreshRun[] = []
  const updates: Array<{ id: string; patch: RefreshRunPatch }> = []
  return {
    runs,
    updates,
    createRun: vi.fn(async (input) => {
      const run: RefreshRun = {
        id: `run-${runs.length + 1}`,
        startedAt: NOW,
        finishedAt: null,
        cursorContentExpiresAt: input.cursor?.contentExpiresAt ?? null,
        cursorReviewId: input.cursor?.reviewId ?? null,
        batchSize: input.batchSize,
        maxBatches: input.maxBatches,
        batchesProcessed: 0,
        candidatesSeen: 0,
        refreshDueCount: 0,
        enqueuedCount: 0,
        enqueueFailedCount: 0,
        oldestDueContentExpiresAt: null,
        status: 'running',
        failureReason: null,
        nextAttemptAt: null,
      }
      runs.push(run)
      return run
    }),
    updateRun: vi.fn(async (id: string, patch: RefreshRunPatch) => {
      updates.push({ id, patch })
      const run = runs.find((r) => r.id === id)
      if (run) {
        Object.assign(
          run,
          patch,
          patch.cursor !== undefined
            ? {
                cursorContentExpiresAt: patch.cursor?.contentExpiresAt ?? null,
                cursorReviewId: patch.cursor?.reviewId ?? null,
              }
            : {},
        )
      }
    }),
    findLatestRun: vi.fn(async () => latest),
  }
}

function makeDeps(
  batches: Review[][],
  opts: {
    runRepo?: RunRepoFake
    addSyncJob?: ReviewQueuePort['addSyncJob']
    batchSize?: number
    maxBatches?: number
  } = {},
) {
  const runRepo = opts.runRepo ?? makeRunRepo()
  const findExpiringBatchAcrossTenants = vi.fn(async (_d, _c, _l) =>
    batches.length > 0 ? batches.shift()! : [],
  )
  const reviewRepo = {
    findExpiringBatchAcrossTenants,
  } as unknown as ReviewRepository
  const queue = {
    addSyncJob: opts.addSyncJob ?? vi.fn(async () => {}),
  } as unknown as ReviewQueuePort
  const handler = createRefreshExpiringReviewsHandler({
    reviewRepo,
    queue,
    refreshRunRepo: runRepo,
    clock: () => NOW,
    batchSize: opts.batchSize ?? 2,
    maxBatches: opts.maxBatches ?? 10,
  })
  return { handler, reviewRepo, queue, runRepo, findExpiringBatchAcrossTenants }
}

describe('refresh sweep (BQC-1.5)', () => {
  it('enqueues one sync job per group and records completed', async () => {
    const { handler, queue, runRepo } = makeDeps([
      [
        makeRefreshDueReview({ propertyId: PROP_A, externalLocationId: 'loc-A' }),
        makeRefreshDueReview({
          id: reviewId('rev-b'),
          propertyId: PROP_B,
          externalLocationId: 'loc-B',
        }),
        makeRefreshDueReview({
          id: reviewId('rev-c'),
          propertyId: PROP_A,
          externalLocationId: 'loc-A',
          externalId: 'ext-2',
        }),
      ],
    ])

    await handler({} as never)

    expect(queue.addSyncJob).toHaveBeenCalledTimes(2)
    const run = runRepo.runs[0]
    expect(run.status).toBe('completed')
    expect(run.finishedAt).toEqual(NOW)
    expect(run.refreshDueCount).toBe(3)
    expect(run.enqueuedCount).toBe(2)
    expect(run.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60 * 60 * 1000))
  })

  it('advances the keyset cursor between batches', async () => {
    const r1 = makeRefreshDueReview({ externalLocationId: 'loc-1' })
    const r2 = makeRefreshDueReview({
      id: reviewId('rev-2'),
      externalLocationId: 'loc-2',
    })
    const { handler, findExpiringBatchAcrossTenants } = makeDeps([[r1, r2], []])

    await handler({} as never)

    const secondCall = findExpiringBatchAcrossTenants.mock.calls[1]
    expect(secondCall[1]).toEqual({
      contentExpiresAt: r2.contentExpiresAt,
      id: r2.id,
    })
  })

  it('stops at maxBatches and records budget_exhausted with cursor', async () => {
    const { handler, runRepo } = makeDeps(
      [
        [makeRefreshDueReview()],
        [makeRefreshDueReview({ id: reviewId('rev-2') })],
        [makeRefreshDueReview({ id: reviewId('rev-3') })],
      ],
      { maxBatches: 1 },
    )

    await handler({} as never)

    const run = runRepo.runs[0]
    expect(run.status).toBe('budget_exhausted')
    expect(run.cursorContentExpiresAt).not.toBeNull()
    expect(run.batchesProcessed).toBe(1)
  })

  it('failed enqueue → records failed, throws, holds the cursor (never acknowledged as success)', async () => {
    const failingQueue = vi.fn(async () => {
      throw new Error('Redis down')
    })
    const { handler, runRepo } = makeDeps(
      [[makeRefreshDueReview()], [makeRefreshDueReview({ id: reviewId('rev-2') })]],
      { addSyncJob: failingQueue },
    )

    await expect(handler({} as never)).rejects.toThrow(/enqueue failure/)

    const run = runRepo.runs[0]
    expect(run.status).toBe('failed')
    expect(run.enqueueFailedCount).toBe(1)
    // Cursor held before the failing batch (was never advanced past batch 1).
    expect(run.cursorContentExpiresAt).toBeNull()
  })

  it('resumes from the previous budget_exhausted run cursor', async () => {
    const priorCursor: RefreshRunCursor = {
      contentExpiresAt: new Date(NOW.getTime() + 2 * DAYS),
      reviewId: 'rev-prior',
    }
    const latest: RefreshRun = {
      id: 'run-prior',
      startedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      finishedAt: new Date(NOW.getTime() - 59 * 60 * 1000),
      cursorContentExpiresAt: priorCursor.contentExpiresAt,
      cursorReviewId: priorCursor.reviewId,
      batchSize: 2,
      maxBatches: 10,
      batchesProcessed: 10,
      candidatesSeen: 5000,
      refreshDueCount: 4800,
      enqueuedCount: 120,
      enqueueFailedCount: 0,
      oldestDueContentExpiresAt: null,
      status: 'budget_exhausted',
      failureReason: null,
      nextAttemptAt: NOW,
    }
    const runRepo = makeRunRepo(latest)
    const { handler, findExpiringBatchAcrossTenants } = makeDeps([[]], { runRepo })

    await handler({} as never)

    expect(runRepo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: priorCursor }),
    )
    expect(findExpiringBatchAcrossTenants.mock.calls[0][1]).toEqual({
      contentExpiresAt: priorCursor.contentExpiresAt,
      id: priorCursor.reviewId,
    })
  })

  it('does not enqueue already-expired reviews (purge owns those)', async () => {
    const { handler, queue } = makeDeps([[makeExpiredReview()]])

    await handler({} as never)

    expect(queue.addSyncJob).not.toHaveBeenCalled()
  })

  it('records oldest due expiry and warns when under the alert lead', async () => {
    const oldest = new Date(NOW.getTime() + 12 * 60 * 60 * 1000) // 12h < 2d lead
    const { handler, runRepo } = makeDeps([
      [
        makeRefreshDueReview({
          contentExpiresAt: oldest,
          lastFetchedAt: new Date(oldest.getTime() - 30 * DAYS),
        }),
      ],
    ])

    const { getLogger } = await import('#/shared/observability/logger')
    const loggerMock = getLogger as unknown as ReturnType<typeof vi.fn>
    const callsBefore = loggerMock.mock.calls.length
    await handler({} as never)

    expect(runRepo.runs[0].oldestDueContentExpiresAt).toEqual(oldest)
    // The handler's own getLogger() call is the first one after `callsBefore`.
    const logger = loggerMock.mock.results[callsBefore].value
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ oldestDueContentExpiresAt: oldest }),
      expect.stringContaining('policy deadline'),
    )
  })

  it('does nothing when no candidates', async () => {
    const { handler, queue, runRepo } = makeDeps([[]])

    await handler({} as never)

    expect(queue.addSyncJob).not.toHaveBeenCalled()
    expect(runRepo.runs[0].status).toBe('completed')
    expect(runRepo.runs[0].candidatesSeen).toBe(0)
  })
})
