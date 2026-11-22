// Review context — a head check in persist mode: what it must not store, the
// Property's head cover, and following the next page.
import { describe, expect, it } from 'vitest'
import type {
  GoogleReviewHeadContinuation,
  GoogleReviewRead,
} from './google-review-api.port.server'
import type { HeadStoredCopy } from '../domain/head-check'
import {
  DAY_MS,
  EPOCH,
  PROPERTY,
  T0,
  copiesFor,
  googleReview,
  okHead,
  readyState,
  setup,
  storedCopy,
} from './review-head-check.test-fixtures'

describe('runReviewHeadCheck: persist mode stores nothing when it must not', () => {
  it('stores nothing before the epoch has its first completed listing, and writes no fact', async () => {
    const { run, persist, repository } = setup({
      state: { hasCompletedListing: false, snapshotActive: false, newestFact: null },
      copies: [],
    })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'compared',
      comparison: { newCount: 2 },
      persistence: { outcome: 'skipped_no_listing', storedNew: 0, factWritten: false },
    })
  })

  it('writes no fact when a snapshot run started while the reviews were being stored', async () => {
    const { run, persist, repository } = setup({
      copies: [],
      head: okHead([googleReview('r-1')], { totalReviewCount: 40, averageRating: 4.5 }),
      stateAtFact: { ...readyState, snapshotActive: true },
    })

    const result = await run()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedOther: 1, factWritten: false },
    })
  })

  it('writes no fact when the final snapshot-state check fails, and retries next look', async () => {
    const { run, persist, repository, logger } = setup({
      copies: [],
      head: okHead([googleReview('r-1')], { totalReviewCount: 40, averageRating: 4.5 }),
      stateAtFact: new Error('db down CANARY'),
    })

    await expect(run()).resolves.toMatchObject({
      persistence: { outcome: 'stored', storedOther: 1, factWritten: false },
    })

    expect(persist).toHaveBeenCalledOnce()
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_head_check_fact_not_recorded' },
      expect.any(String),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('CANARY')

    repository.readPersistState.mockResolvedValue(readyState)
    await expect(run()).resolves.toMatchObject({
      persistence: { outcome: 'stored', factWritten: true },
    })
    expect(repository.recordHeadFact).toHaveBeenCalledOnce()
  })

  it('writes no fact when the completed-listing proof disappeared during the read', async () => {
    const { run, repository } = setup({
      head: okHead([], { totalReviewCount: 40, averageRating: 4.5 }),
      stateAtFact: { ...readyState, hasCompletedListing: false },
    })

    await expect(run()).resolves.toMatchObject({
      persistence: { outcome: 'stored', factWritten: false },
    })
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
  })

  it('decides the fact against the newest fact as it is just before writing', async () => {
    const { run, repository } = setup({
      head: okHead([googleReview('r-1'), googleReview('r-2')], {
        totalReviewCount: 2,
        averageRating: 5,
      }),
      state: {
        ...readyState,
        newestFact: { reviewCount: 1, averageRating: 5, observedAt: T0 },
      },
      // Another head check wrote exactly Google's numbers a moment ago.
      stateAtFact: {
        ...readyState,
        newestFact: { reviewCount: 2, averageRating: 5, observedAt: T0 },
      },
    })

    const result = await run()

    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(result).toMatchObject({ persistence: { factWritten: false } })
  })

  it('stores nothing while a snapshot run is active, but still compares and counts', async () => {
    const { run, persist, repository, logger } = setup({
      state: { ...readyState, snapshotActive: true },
      copies: [],
    })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      comparison: { listed: 2, newCount: 2, wouldPersist: 2 },
      persistence: { outcome: 'skipped_snapshot_active' },
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'compared',
        listed: 2,
        new: 2,
        wouldPersist: 2,
        persisted: 'skipped_snapshot_active',
      }),
      'Review head check finished',
    )
    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'head',
        persistence: expect.objectContaining({ outcome: 'skipped_snapshot_active' }),
      }),
    )
  })

  it('stores nothing when the Property’s source epoch moved after the read', async () => {
    const { run, persist, repository } = setup({ currentEpoch: EPOCH + 1, copies: [] })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(result).toMatchObject({ persistence: { outcome: 'skipped_epoch_moved' } })
  })

  it('stores nothing when the Property is gone', async () => {
    const { run, persist } = setup({ currentEpoch: null, copies: [] })

    await run()

    expect(persist).not.toHaveBeenCalled()
  })

  it('stores nothing, and says unavailable, when the persist state cannot be read', async () => {
    const { run, persist, logger } = setup({
      state: new Error('db down CANARY'),
      copies: [],
    })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'compared',
      persistence: { outcome: 'unavailable' },
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('CANARY')
  })

  it('stores nothing, and says unavailable, when no read generation can be allocated', async () => {
    const { run, persist } = setup({ generation: new Error('db down'), copies: [] })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(result).toMatchObject({ persistence: { outcome: 'unavailable' } })
  })

  it('stores nothing from an out-of-order page', async () => {
    const { run, persist, allocateReplyReadGeneration } = setup({
      head: { status: 'order_violation' },
    })

    await expect(run()).resolves.toEqual({ status: 'order_violation' })
    expect(persist).not.toHaveBeenCalled()
    expect(allocateReplyReadGeneration).not.toHaveBeenCalled()
  })

  it('stores nothing in dark mode even when the persist dependencies are wired', async () => {
    const { run, persist, repository, allocateReplyReadGeneration } = setup({
      mode: 'dark',
      copies: [],
    })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(allocateReplyReadGeneration).not.toHaveBeenCalled()
    expect(repository.readPersistState).not.toHaveBeenCalled()
    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'head_dark', persistence: null }),
    )
    expect(result).toMatchObject({ persistence: null })
  })

  it('runs dark when persist is asked for but not wired', async () => {
    const { run, persist, repository } = setup({ withoutPersistDeps: true, copies: [] })

    await run()

    expect(persist).not.toHaveBeenCalled()
    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'head_dark' }),
    )
  })
})

describe('runReviewHeadCheck: the Property’s head cover', () => {
  const fullPage = (count: number, over: (id: string) => Partial<GoogleReviewRead>) =>
    Array.from({ length: count }, (_, index) =>
      googleReview(`r-${index}`, over(`r-${index}`)),
    )
  const copiesOf = (count: number, over: Partial<HeadStoredCopy> = {}) =>
    copiesFor('r', count, over)

  it('renews the cover from the start of the check when it stored everything that differed', async () => {
    const { run, repository } = setup({ copies: [storedCopy('r-1')] })

    await run()

    expect(repository.recordHeadCoverage).toHaveBeenCalledExactlyOnceWith({
      propertyId: PROPERTY,
      coveredAt: T0,
    })
    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it('renews the cover when nothing on the page differed', async () => {
    const { run, repository } = setup()

    await run()

    expect(repository.recordHeadCoverage).toHaveBeenCalledOnce()
  })

  it('renews nothing when a review on the page could not be stored', async () => {
    const { run, repository } = setup({ copies: [], failPersistFor: new Set(['r-1']) })

    await run()

    expect(repository.recordHeadCoverage).not.toHaveBeenCalled()
    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it.each([
    ['no completed listing', { state: { ...readyState, hasCompletedListing: false } }],
    ['an active snapshot run', { state: { ...readyState, snapshotActive: true } }],
    ['a moved source epoch', { currentEpoch: EPOCH + 1 }],
    ['dark mode', { mode: 'dark' as const }],
    ['no persist dependencies', { withoutPersistDeps: true }],
  ])('renews nothing and requests nothing with %s', async (_case, options) => {
    const { run, repository } = setup({ copies: [], ...options })

    await run()

    expect(repository.recordHeadCoverage).not.toHaveBeenCalled()
    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it('renews nothing and asks for a full read when the whole page changed and more pages follow', async () => {
    const { run, repository, logger } = setup({
      head: okHead(
        fullPage(50, () => ({ sourceUpdatedAt: new Date(T0.getTime() - 1_000) })),
        { hasMore: true, totalReviewCount: 120 },
      ),
      copies: copiesOf(30),
    })

    const result = await run()

    expect(result).toMatchObject({
      comparison: { listed: 50, newCount: 20, changedCount: 30, contentChangedCount: 50 },
      persistence: { outcome: 'stored' },
    })
    expect(repository.recordHeadCoverage).not.toHaveBeenCalled()
    expect(repository.requestFullRead).toHaveBeenCalledExactlyOnceWith({
      propertyId: PROPERTY,
      requestedAt: expect.any(Date),
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ cover: 'full_read_requested', contentChanged: 50 }),
      'Review head check finished',
    )
  })

  it('treats a page of routine five-day refreshes as covered, not as a whole page changed', async () => {
    const { run, repository } = setup({
      head: okHead(
        fullPage(50, () => ({})),
        { hasMore: true, totalReviewCount: 120 },
      ),
      copies: copiesOf(50, { lastFetchedAt: new Date(T0.getTime() - 6 * DAY_MS) }),
    })

    const result = await run()

    expect(result).toMatchObject({
      comparison: { leaseRefreshCount: 50, contentChangedCount: 0 },
      persistence: { outcome: 'stored', storedOther: 50, failed: 0 },
    })
    expect(repository.requestFullRead).not.toHaveBeenCalled()
    expect(repository.recordHeadCoverage).toHaveBeenCalledOnce()
  })

  it('renews the cover when the whole page changed but it is Google’s last page', async () => {
    const { run, repository } = setup({
      head: okHead(
        fullPage(3, () => ({})),
        { hasMore: false },
      ),
      copies: [],
    })

    await run()

    expect(repository.requestFullRead).not.toHaveBeenCalled()
    expect(repository.recordHeadCoverage).toHaveBeenCalledOnce()
  })

  it('still finishes, and logs a closed code, when the cover cannot be written', async () => {
    const { run, logger } = setup({ coverWrite: new Error('db down CANARY') })

    const result = await run()

    expect(result).toMatchObject({
      status: 'compared',
      persistence: { outcome: 'stored' },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_head_check_cover_not_recorded' },
      'Review head check could not record its head cover',
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ cover: null }),
      'Review head check finished',
    )
  })
})

describe('runReviewHeadCheck: following the next page', () => {
  const continuation = () => ({}) as GoogleReviewHeadContinuation
  const changedPage = (prefix: string, more: boolean) =>
    okHead(
      Array.from({ length: 50 }, (_, index) =>
        googleReview(`${prefix}-${index}`, {
          sourceUpdatedAt: new Date(T0.getTime() - 1_000),
        }),
      ),
      {
        hasMore: more,
        totalReviewCount: 120,
        ...(more ? { continuation: continuation() } : {}),
      },
    )
  const quietPage = (prefix: string, count: number) =>
    okHead(
      Array.from({ length: count }, (_, index) => googleReview(`${prefix}-${index}`)),
      { totalReviewCount: 120 },
    )

  it('reads page 2 only when all 50 reviews of page 1 really changed', async () => {
    const quiet = setup({
      heads: [
        okHead([googleReview('a-0')], {
          hasMore: true,
          totalReviewCount: 120,
          continuation: continuation(),
        }),
      ],
      copies: [storedCopy('a-0')],
    })
    await quiet.run()
    expect(quiet.readReviewsHead).toHaveBeenCalledOnce()

    const changed = setup({
      heads: [changedPage('a', true), quietPage('b', 10)],
      copies: [...copiesFor('a', 50), ...copiesFor('b', 10)],
    })
    await changed.run()
    expect(changed.readReviewsHead).toHaveBeenCalledTimes(2)
  })

  it('hands the first page’s continuation to the second read and takes a read generation per page', async () => {
    const first = changedPage('a', true)
    const { run, readReviewsHead, allocateReplyReadGeneration } = setup({
      heads: [first, quietPage('b', 10)],
      copies: [...copiesFor('a', 50), ...copiesFor('b', 10)],
    })

    await run()

    expect(readReviewsHead.mock.calls[0]?.[0]).not.toHaveProperty('continuation')
    expect(readReviewsHead.mock.calls[1]?.[0]).toMatchObject({
      continuation: (first as { continuation: unknown }).continuation,
    })
    expect(allocateReplyReadGeneration).toHaveBeenCalledTimes(2)
  })

  it('renews the cover and asks for nothing when the second page ends the changes', async () => {
    const { run, repository, logger } = setup({
      heads: [changedPage('a', true), quietPage('b', 10)],
      copies: [...copiesFor('a', 50), ...copiesFor('b', 10)],
    })

    await run()

    expect(repository.requestFullRead).not.toHaveBeenCalled()
    expect(repository.recordHeadCoverage).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 2, cover: 'renewed' }),
      'Review head check finished',
    )
  })

  it('does not count routine five-day clock refreshes as a changed page', async () => {
    const { run, readReviewsHead, repository } = setup({
      heads: [
        okHead(
          Array.from({ length: 50 }, (_, index) => googleReview(`a-${index}`)),
          { hasMore: true, totalReviewCount: 120, continuation: continuation() },
        ),
      ],
      copies: copiesFor('a', 50, { lastFetchedAt: new Date(T0.getTime() - 6 * DAY_MS) }),
    })

    await run()

    expect(readReviewsHead).toHaveBeenCalledOnce()
    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it('stops after three pages and asks for a full read when the third still changed throughout', async () => {
    const { run, readReviewsHead, repository, logger } = setup({
      heads: [changedPage('a', true), changedPage('b', true), changedPage('c', true)],
      copies: [],
    })

    await run()

    expect(readReviewsHead).toHaveBeenCalledTimes(3)
    expect(repository.recordHeadCoverage).not.toHaveBeenCalled()
    expect(repository.requestFullRead).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 3, cover: 'full_read_requested' }),
      'Review head check finished',
    )
  })

  it('asks for a full read when a further page cannot be read, keeping what page 1 stored', async () => {
    const { run, repository, persist } = setup({
      heads: [changedPage('a', true), new Error('Google down CANARY')],
      copies: [],
    })

    const result = await run()

    expect(result).toMatchObject({ status: 'compared' })
    expect(persist).toHaveBeenCalledTimes(50)
    expect(repository.requestFullRead).toHaveBeenCalledOnce()
    expect(repository.recordHeadCoverage).not.toHaveBeenCalled()
  })

  it('asks for a full read when the next page is out of order', async () => {
    const { run, repository } = setup({
      heads: [changedPage('a', true), { status: 'order_violation' }],
      copies: [],
    })

    await run()

    expect(repository.requestFullRead).toHaveBeenCalledOnce()
  })

  it('renews nothing when an earlier page left a review unstored', async () => {
    const { run, repository } = setup({
      heads: [changedPage('a', true), quietPage('b', 10)],
      copies: copiesFor('b', 10),
      failPersistFor: new Set(['a-0']),
    })

    await run()

    expect(repository.recordHeadCoverage).not.toHaveBeenCalled()
    expect(repository.requestFullRead).not.toHaveBeenCalled()
  })

  it('reads one page in dark mode and without persist dependencies', async () => {
    for (const options of [{ mode: 'dark' as const }, { withoutPersistDeps: true }]) {
      const { run, readReviewsHead } = setup({
        ...options,
        heads: [changedPage('a', true), quietPage('b', 10)],
        copies: [],
      })
      await run()
      expect(readReviewsHead).toHaveBeenCalledOnce()
    }
  })

  it('logs and records no page token', async () => {
    const { run, logger } = setup({
      heads: [changedPage('a', true), quietPage('b', 10)],
      copies: [],
    })

    await run()

    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/continuation|token/i)
  })
})
