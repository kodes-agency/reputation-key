// Unit tests for refresh expiring reviews job handler (BQC-1.5).
// Tests: keyset cursor batches, budget stop + resume, pull-forward failure
// semantics (never acknowledged as success), run-state persistence,
// oldest-due alerting, and that the sweep enqueues no sync of its own: it
// moves the discovery schedule (the 2026-10-21 (e) note of ADR 0055).

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, vi } from 'vitest'
import type { Review } from '../../domain/types'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type {
  PullLooksForwardResult,
  ReviewDiscoveryRepository,
} from '../../application/ports/review-discovery.repository'
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

const ORG_ID = organizationId('org-1')
const PROP_A = propertyId('prop-a')
const PROP_B = propertyId('prop-b')
const CONN_ID = googleConnectionId('conn-1')
const NOW = new Date('2025-06-01T12:00:00.000Z')
const DAYS = 24 * 60 * 60 * 1000
const PULLED_ONE: PullLooksForwardResult = {
  pulledForward: 1,
  skippedRecent: 0,
  skippedBackoff: 0,
}

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
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: CONN_ID,
    reviewerName: null,
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
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
    pullLooksForward?: ReviewDiscoveryRepository['pullLooksForward']
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
  const discoveryRepo = {
    pullLooksForward: opts.pullLooksForward ?? vi.fn(async () => PULLED_ONE),
  }
  const logger = { info: vi.fn(), warn: vi.fn() }
  const handler = createRefreshExpiringReviewsHandler({
    reviewRepo,
    discoveryRepo,
    refreshRunRepo: runRepo,
    clock: () => NOW,
    logger,
    batchSize: opts.batchSize ?? 2,
    maxBatches: opts.maxBatches ?? 10,
  })
  return {
    handler,
    reviewRepo,
    discoveryRepo,
    runRepo,
    logger,
    findExpiringBatchAcrossTenants,
  }
}

describe('refresh sweep (BQC-1.5)', () => {
  it('pulls the look of each Property forward once and records completed', async () => {
    const pullLooksForward = vi.fn(async () => ({
      pulledForward: 2,
      skippedRecent: 0,
      skippedBackoff: 0,
    }))
    const { handler, discoveryRepo, runRepo } = makeDeps(
      [
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
      ],
      { pullLooksForward },
    )

    await handler({} as never)

    // A day: a listing newer than this already refreshed every review Google lists.
    expect(discoveryRepo.pullLooksForward).toHaveBeenCalledExactlyOnceWith(
      [PROP_A, PROP_B],
      NOW,
      new Date(NOW.getTime() - DAYS),
    )
    expect(runRepo.runs.at(0)).toMatchObject({
      status: 'completed',
      finishedAt: NOW,
      refreshDueCount: 3,
      enqueuedCount: 2,
      enqueueFailedCount: 0,
      nextAttemptAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    })
  })

  it('asks about a Property once even when its reviews fill several batches', async () => {
    const { handler, discoveryRepo } = makeDeps([
      [makeRefreshDueReview({ id: reviewId('rev-1') })],
      [makeRefreshDueReview({ id: reviewId('rev-2') })],
      [],
    ])

    await handler({} as never)

    expect(discoveryRepo.pullLooksForward).toHaveBeenCalledTimes(1)
  })

  it('logs content-free counts: pulled forward, skipped for a recent listing, skipped for backoff', async () => {
    const { handler, logger } = makeDeps([[makeRefreshDueReview()]], {
      pullLooksForward: vi.fn(async () => ({
        pulledForward: 3,
        skippedRecent: 2,
        skippedBackoff: 1,
      })),
    })

    await handler({} as never)

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        pulledForward: 3,
        skippedRecent: 2,
        skippedBackoff: 1,
      }),
      'Refresh expiring reviews completed',
    )
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

  it('failed pull-forward → records failed, throws, holds the cursor (never acknowledged as success)', async () => {
    const failingPull = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    const { handler, runRepo } = makeDeps(
      [[makeRefreshDueReview()], [makeRefreshDueReview({ id: reviewId('rev-2') })]],
      { pullLooksForward: failingPull },
    )

    await expect(handler({} as never)).rejects.toThrow(/pull-forward failure/)

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

  it('does not touch the schedule for already-expired reviews (purge owns those)', async () => {
    const { handler, discoveryRepo } = makeDeps([[makeExpiredReview()]])

    await handler({} as never)

    expect(discoveryRepo.pullLooksForward).not.toHaveBeenCalled()
  })

  it('records oldest due expiry and warns when under the alert lead', async () => {
    const oldest = new Date(NOW.getTime() + 12 * 60 * 60 * 1000) // 12h < 2d lead
    const { handler, runRepo, logger } = makeDeps([
      [
        makeRefreshDueReview({
          contentExpiresAt: oldest,
          lastFetchedAt: new Date(oldest.getTime() - 30 * DAYS),
        }),
      ],
    ])

    await handler({} as never)

    expect(runRepo.runs[0].oldestDueContentExpiresAt).toEqual(oldest)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ oldestDueContentExpiresAt: oldest }),
      expect.stringContaining('policy deadline'),
    )
  })

  it('does nothing when no candidates', async () => {
    const { handler, discoveryRepo, runRepo } = makeDeps([[]])

    await handler({} as never)

    expect(discoveryRepo.pullLooksForward).not.toHaveBeenCalled()
    expect(runRepo.runs[0].status).toBe('completed')
    expect(runRepo.runs[0].candidatesSeen).toBe(0)
  })
})
