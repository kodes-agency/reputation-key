import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewHeadCheckJobData } from '../../application/ports/review-queue.port'
import type { ReviewSyncActivityRecorder } from '../../application/ports/review-sync-activity.port'
import type { ReviewDiscoveryRepository } from '../../application/ports/review-discovery.repository'
import type { RunReviewHeadCheck } from '../../application/use-cases/run-review-head-check'
import { createSyncPropertyReviewsHandler } from './sync-property-reviews.job'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

// The head mode of sync-property-reviews: one dark look at Google's newest page.
// It must never throw, never touch the Property's sync failure state, and never
// start or continue a snapshot run.

const NOW = new Date('2026-10-21T12:00:00.000Z')

const HEAD_JOB: ReviewHeadCheckJobData = {
  mode: 'head',
  propertyId: '11111111-1111-4111-8111-111111111111',
  organizationId: '33333333-3333-4333-8333-333333333333',
  connectionId: '22222222-2222-4222-8222-222222222222',
  locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
}

const COMPARED = {
  status: 'compared' as const,
  comparison: {
    listed: 1,
    newCount: 0,
    changedCount: 0,
    replyChangedCount: 0,
    leaseRefreshCount: 0,
    wouldPersist: 0,
    googleTotal: 1,
    storedLiveCount: 1,
    totalDifference: 0,
    googleAverage: 5,
    storedAverage: 5,
    averageDifference: 0,
    hasMore: false,
  },
}

function setup(
  options: Readonly<{
    headChecks?: 'off' | 'dark' | 'persist'
    runHeadCheck?: RunReviewHeadCheck | null
    epoch?: { sourceEpoch: number } | null | Error
  }> = {},
) {
  const runHeadCheck: RunReviewHeadCheck = vi.fn(async () => COMPARED)
  const runSnapshot = vi.fn()
  const runTargetedFetch = vi.fn()
  const enqueueContinuation = vi.fn(async () => undefined)
  const discoveryRepo = {
    markDiscoveryDeferred: vi.fn(async () => undefined),
    findFailureState: vi.fn(async () => null),
    markSyncSucceeded: vi.fn(async () => undefined),
  } satisfies Pick<
    ReviewDiscoveryRepository,
    'markDiscoveryDeferred' | 'findFailureState' | 'markSyncSucceeded'
  >
  const syncActivity: ReviewSyncActivityRecorder = {
    recordNewReviewObserved: vi.fn(async () => undefined),
    recordPushObserved: vi.fn(async () => undefined),
  }
  const getSourceEpoch = vi.fn(async () => {
    if (options.epoch instanceof Error) throw options.epoch
    return options.epoch === undefined ? { sourceEpoch: 7 } : options.epoch
  })
  const logger = { warn: vi.fn() }
  const run = options.runHeadCheck === undefined ? runHeadCheck : options.runHeadCheck
  const handler = createSyncPropertyReviewsHandler({
    runSnapshot,
    runTargetedFetch,
    propertySourceEpoch: { getSourceEpoch },
    enqueueContinuation,
    syncActivity,
    discoveryRepo,
    clock: () => NOW,
    hotIntervalMs: 15 * 60 * 1000,
    headChecks: options.headChecks ?? 'dark',
    ...(run === null ? {} : { runHeadCheck: run }),
    logger,
  })
  return {
    handler,
    runHeadCheck,
    run,
    runSnapshot,
    runTargetedFetch,
    enqueueContinuation,
    discoveryRepo,
    syncActivity,
    logger,
    getSourceEpoch,
  }
}

const head = (over: Partial<ReviewHeadCheckJobData> = {}) =>
  ({ id: 'job-head', data: { ...HEAD_JOB, ...over } }) as never

describe('sync-property-reviews head mode', () => {
  it('runs the head check for the Property’s current binding and returns its result', async () => {
    const { handler, runHeadCheck } = setup()

    await expect(handler(head())).resolves.toEqual(COMPARED)

    expect(runHeadCheck).toHaveBeenCalledOnce()
    expect(runHeadCheck).toHaveBeenCalledWith({
      organizationId: HEAD_JOB.organizationId,
      propertyId: HEAD_JOB.propertyId,
      connectionId: HEAD_JOB.connectionId,
      sourceEpoch: 7,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      mode: 'dark',
    })
  })

  it('asks the use case to store when the process runs in persist mode', async () => {
    const { handler, runHeadCheck } = setup({ headChecks: 'persist' })

    await expect(handler(head())).resolves.toEqual(COMPARED)

    expect(runHeadCheck).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'persist' }),
    )
  })

  it('returns an obsolete outcome in persist mode too when the source epoch moved, so it can never latch the family', async () => {
    const { handler, runHeadCheck } = setup({
      headChecks: 'persist',
      epoch: { sourceEpoch: 8 },
    })

    await expect(handler(head({ sourceEpoch: 7 }))).resolves.toEqual({
      status: 'obsolete',
    })
    expect(runHeadCheck).not.toHaveBeenCalled()
  })

  it('never starts a snapshot, a targeted fetch or a continuation, and never touches the failure state', async () => {
    const {
      handler,
      runSnapshot,
      runTargetedFetch,
      enqueueContinuation,
      discoveryRepo,
      syncActivity,
    } = setup()

    await handler(head())

    expect(runSnapshot).not.toHaveBeenCalled()
    expect(runTargetedFetch).not.toHaveBeenCalled()
    expect(enqueueContinuation).not.toHaveBeenCalled()
    expect(discoveryRepo.markSyncSucceeded).not.toHaveBeenCalled()
    expect(discoveryRepo.markDiscoveryDeferred).not.toHaveBeenCalled()
    expect(syncActivity.recordPushObserved).not.toHaveBeenCalled()
    expect(syncActivity.recordNewReviewObserved).not.toHaveBeenCalled()
  })

  it('returns an outcome, not a throw, for every outcome the head check can end as', async () => {
    for (const status of [
      'order_violation',
      'rate_limited',
      'provider_unavailable',
      'provider_rejected',
      'authorization_changed',
      'malformed_response',
      'no_provider',
      'skipped_outstanding_failure',
      'error',
    ] as const) {
      const { handler } = setup({ runHeadCheck: vi.fn(async () => ({ status })) })

      await expect(handler(head())).resolves.toEqual({ status })
    }
  })

  it('ends as an error outcome, with one content-free warning, if the head check itself throws', async () => {
    const { handler, logger } = setup({
      runHeadCheck: vi.fn(async () => {
        throw new Error(`boom ${HEAD_JOB.propertyId}`)
      }),
    })

    await expect(handler(head())).resolves.toEqual({ status: 'error' })

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(HEAD_JOB.propertyId)
  })

  it('returns obsolete instead of throwing when the Property’s source epoch moved', async () => {
    const { handler, runHeadCheck } = setup({ epoch: { sourceEpoch: 8 } })

    await expect(handler(head({ sourceEpoch: 7 }))).resolves.toEqual({
      status: 'obsolete',
    })
    expect(runHeadCheck).not.toHaveBeenCalled()
  })

  it('returns obsolete when the Property has no source any more', async () => {
    const { handler, runHeadCheck } = setup({ epoch: null })

    await expect(handler(head())).resolves.toEqual({ status: 'obsolete' })
    expect(runHeadCheck).not.toHaveBeenCalled()
  })

  it('returns an error outcome when the source epoch cannot be read', async () => {
    const { handler, runHeadCheck } = setup({ epoch: new Error('db down') })

    await expect(handler(head())).resolves.toEqual({ status: 'error' })
    expect(runHeadCheck).not.toHaveBeenCalled()
  })

  it('returns invalid, not a throw, for a payload that is not a Property identity', async () => {
    const { handler, runHeadCheck } = setup()

    await expect(handler(head({ propertyId: 'not-a-uuid' }))).resolves.toEqual({
      status: 'invalid',
    })
    await expect(handler(head({ connectionId: 'nope' }))).resolves.toEqual({
      status: 'invalid',
    })
    expect(runHeadCheck).not.toHaveBeenCalled()
  })

  it('ends a queued head job as disabled, reading nothing, once head checks are off', async () => {
    const { handler, runHeadCheck, getSourceEpoch } = setup({ headChecks: 'off' })

    await expect(handler(head())).resolves.toEqual({ status: 'disabled' })
    expect(runHeadCheck).not.toHaveBeenCalled()
    expect(getSourceEpoch).not.toHaveBeenCalled()
  })

  it('ends a head job as disabled on a process that has no head check wired', async () => {
    const { handler } = setup({ runHeadCheck: null })

    await expect(handler(head())).resolves.toEqual({ status: 'disabled' })
  })
})
