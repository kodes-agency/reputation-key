// Review context — a head check in persist mode: what it stores, and when it
// stores nothing.
import { describe, expect, it, vi } from 'vitest'
import { googleConnectionId, organizationId, propertyId } from '#/shared/domain/ids'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type {
  GoogleReviewHeadResult,
  GoogleReviewRead,
} from '../ports/google-review-api.port'
import type {
  ReviewHeadCheckRepository,
  ReviewHeadPersistState,
} from '../ports/review-head-check.repository'
import type { ReviewProviderObservationWriter } from '../ports/review-provider-observation-writer.port'
import type { HeadStoredCopy } from '../../domain/head-check'
import { HEAD_FACT_HEARTBEAT_MS } from '../../domain/head-persist'
import { createRunReviewHeadCheck } from './run-review-head-check'

const ORG = organizationId('org-head-persist')
const PROPERTY = propertyId('3f1c1d5e-0000-4000-8000-000000000001')
const CONNECTION = googleConnectionId('3f1c1d5e-0000-4000-8000-000000000002')
const LOCATION = GOOGLE_LOCATION_PRIMARY_RESOURCE
const EPOCH = 4
const T0 = new Date('2026-10-21T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const FACT_ID = '3f1c1d5e-0000-4000-8000-0000000000f1'
const GENERATION = 41

const input = {
  organizationId: ORG,
  propertyId: PROPERTY,
  connectionId: CONNECTION,
  sourceEpoch: EPOCH,
  locationName: LOCATION,
  mode: 'persist',
} as const

const googleReview = (
  id: string,
  over: Partial<GoogleReviewRead> = {},
): GoogleReviewRead => ({
  reviewName: `${LOCATION}/reviews/${id}`,
  externalId: id,
  externalLocationId: LOCATION,
  reviewerName: 'Canary Reviewer Name',
  reviewerProfilePhotoUrl: null,
  googleReviewUrl: null,
  rating: 5,
  text: 'Canary review text',
  translatedText: null,
  languageCode: null,
  reviewedAt: new Date(T0.getTime() - 3 * DAY_MS),
  sourceCreatedAt: new Date(T0.getTime() - 3 * DAY_MS),
  sourceUpdatedAt: new Date(T0.getTime() - 2 * DAY_MS),
  replyText: null,
  replyUpdatedAt: null,
  ...over,
})

const storedCopy = (id: string, over: Partial<HeadStoredCopy> = {}): HeadStoredCopy => ({
  externalId: id,
  sourceEpoch: EPOCH,
  sourceUpdatedAt: new Date(T0.getTime() - 2 * DAY_MS),
  lastFetchedAt: new Date(T0.getTime() - 1 * DAY_MS),
  reply: null,
  ...over,
})

const okHead = (
  reviews: readonly GoogleReviewRead[],
  over: Partial<Extract<GoogleReviewHeadResult, { status: 'ok' }>> = {},
): GoogleReviewHeadResult => ({
  status: 'ok',
  reviews,
  totalReviewCount: reviews.length,
  averageRating: reviews.length === 0 ? null : 5,
  hasMore: false,
  ...over,
})

const readyState: ReviewHeadPersistState = {
  hasCompletedListing: true,
  snapshotActive: false,
  newestFact: {
    reviewCount: 2,
    averageRating: 5,
    observedAt: new Date(T0.getTime() - 3_600_000),
  },
}

type Options = Readonly<{
  head?: GoogleReviewHeadResult
  copies?: readonly HeadStoredCopy[]
  state?: ReviewHeadPersistState | Error
  /** What the second read of the state (just before the fact) answers. */
  stateAtFact?: ReviewHeadPersistState
  currentEpoch?: number | null
  failPersistFor?: ReadonlySet<string>
  newReviewIds?: ReadonlySet<string>
  generation?: number | Error
  recordHeadFact?: Error
  stampActivity?: Error
  mode?: 'dark' | 'persist'
  withoutPersistDeps?: boolean
}>

function setup(options: Options = {}) {
  const order: string[] = []
  let reads = 0
  const readReviewsHead = vi.fn(async () => {
    order.push('read')
    return (
      options.head ??
      okHead([googleReview('r-1'), googleReview('r-2')], {
        totalReviewCount: 2,
        averageRating: 5,
      })
    )
  })
  const repository = {
    hasOutstandingFailure: vi.fn(async () => false),
    readBaseline: vi.fn(async () => ({
      copies: options.copies ?? [storedCopy('r-1'), storedCopy('r-2')],
      storedLiveCount: 2,
      storedAverageRating: 5,
    })),
    readPersistState: vi.fn(async () => {
      if (options.state instanceof Error) throw options.state
      reads++
      if (reads > 1 && options.stateAtFact) return options.stateAtFact
      return options.state ?? readyState
    }),
    recordHeadFact: vi.fn(async () => {
      order.push('fact')
      if (options.recordHeadFact) throw options.recordHeadFact
    }),
    recordRun: vi.fn(async () => undefined),
  } satisfies ReviewHeadCheckRepository
  const persist = vi.fn(
    async (call: Parameters<ReviewProviderObservationWriter['persist']>[0]) => {
      order.push(`persist:${call.review.externalId}`)
      if (options.failPersistFor?.has(call.review.externalId)) {
        throw new Error('db down CANARY')
      }
      return {
        reviewId: `id-${call.review.externalId}` as never,
        sourceRevision: 1,
        isNew: options.newReviewIds?.has(call.review.externalId) ?? false,
      }
    },
  )
  const allocateReplyReadGeneration = vi.fn(async () => {
    order.push('allocate')
    if (options.generation instanceof Error) throw options.generation
    return options.generation ?? GENERATION
  })
  const recordNewReviewObserved = vi.fn(async () => {
    if (options.stampActivity) throw options.stampActivity
  })
  const deriveCandidates = vi.fn(() => [
    { keyVersion: 'v1', locatorHmac: 'h'.repeat(64) },
  ])
  const logger = { info: vi.fn(), warn: vi.fn() }
  let tick = 0
  const clock = vi.fn(() => new Date(T0.getTime() + 100 * tick++))
  const run = createRunReviewHeadCheck({
    googleReviewApi: { readReviewsHead },
    repository,
    logger,
    clock,
    ...(options.withoutPersistDeps
      ? {}
      : {
          persist: {
            observationWriter: { allocateReplyReadGeneration, persist },
            subjectKeyService: {
              acquireDeriver: async () => ({ deriveCandidates }),
            } as never,
            propertySourceEpoch: {
              getSourceEpoch: async () =>
                options.currentEpoch === null
                  ? null
                  : { sourceEpoch: options.currentEpoch ?? EPOCH },
            },
            syncActivity: { recordNewReviewObserved },
            newId: () => FACT_ID,
          },
        }),
  })
  return {
    run: () => run({ ...input, mode: options.mode ?? 'persist' }),
    order,
    repository,
    persist,
    allocateReplyReadGeneration,
    recordNewReviewObserved,
    logger,
    readReviewsHead,
  }
}

describe('runReviewHeadCheck: persist mode stores only what differs', () => {
  it('writes the new and the edited review and leaves the unchanged one alone', async () => {
    const { run, persist } = setup({
      head: okHead(
        [
          googleReview('r-new'),
          googleReview('r-same'),
          googleReview('r-edited', {
            sourceUpdatedAt: new Date(T0.getTime() - 1_000),
            text: 'Changed canary text',
          }),
        ],
        { totalReviewCount: 3, averageRating: 5 },
      ),
      copies: [
        storedCopy('r-same'),
        storedCopy('r-edited', { sourceUpdatedAt: new Date(T0.getTime() - 2 * DAY_MS) }),
      ],
      newReviewIds: new Set(['r-new']),
    })

    const result = await run()

    expect(persist.mock.calls.map(([call]) => call.review.externalId)).toEqual([
      'r-new',
      'r-edited',
    ])
    expect(result).toMatchObject({
      status: 'compared',
      persistence: { outcome: 'stored', storedNew: 1, storedOther: 1, failed: 0 },
    })
  })

  it('stores a reply written on Google on a review whose text did not change', async () => {
    const { run, persist } = setup({
      head: okHead(
        [
          googleReview('r-1', {
            replyText: 'Thanks for staying',
            replyUpdatedAt: new Date(T0.getTime() - 60_000),
          }),
        ],
        { totalReviewCount: 1, averageRating: 5 },
      ),
      copies: [storedCopy('r-1')],
    })

    await run()

    expect(persist).toHaveBeenCalledOnce()
    expect(persist.mock.calls[0]?.[0].review.replyText).toBe('Thanks for staying')
  })

  it('stores a copy last fetched five days ago or more, so its lease is refreshed', async () => {
    const { run, persist } = setup({
      head: okHead([googleReview('r-1')], { totalReviewCount: 1, averageRating: 5 }),
      copies: [storedCopy('r-1', { lastFetchedAt: new Date(T0.getTime() - 5 * DAY_MS) })],
    })

    await run()

    expect(persist).toHaveBeenCalledOnce()
  })

  it('stores nothing at all when every review matches its stored copy', async () => {
    const { run, persist } = setup()

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedNew: 0, storedOther: 0, failed: 0 },
    })
  })

  it('writes each review as ongoing work first seen via head, with one read generation for the page', async () => {
    const { run, persist, allocateReplyReadGeneration } = setup({
      copies: [],
      newReviewIds: new Set(['r-1', 'r-2']),
    })

    await run()

    expect(allocateReplyReadGeneration).toHaveBeenCalledOnce()
    for (const [call] of persist.mock.calls) {
      expect(call).toMatchObject({
        organizationId: ORG,
        propertyId: PROPERTY,
        connectionId: CONNECTION,
        sourceEpoch: EPOCH,
        observationOrigin: 'ongoing',
        firstSeenVia: 'head',
        replyReadGeneration: GENERATION,
      })
      expect(call.observationKey).toMatch(/^[0-9a-f]{64}$/u)
    }
    const keys = persist.mock.calls.map(([call]) => call.observationKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never repeats an observation key across two checks, so an edit and its undoing are both applied', async () => {
    const first = setup({ copies: [] })
    const second = setup({ copies: [], generation: GENERATION + 1 })

    await first.run()
    await second.run()

    const firstKeys = first.persist.mock.calls.map(([call]) => call.observationKey)
    const secondKeys = second.persist.mock.calls.map(([call]) => call.observationKey)
    expect(firstKeys.some((key) => secondKeys.includes(key))).toBe(false)
  })

  it('takes the read generation right after Google answers, before the stored copies are read', async () => {
    const { run, order } = setup({ copies: [] })

    await run()

    expect(order.slice(0, 2)).toEqual(['read', 'allocate'])
  })

  it('stamps the discovery ladder when the page held a review nobody had', async () => {
    const withNew = setup({ copies: [storedCopy('r-2')], newReviewIds: new Set(['r-1']) })
    const withoutNew = setup({ copies: [] })

    await withNew.run()
    await withoutNew.run()

    expect(withNew.recordNewReviewObserved).toHaveBeenCalledOnce()
    expect(withoutNew.recordNewReviewObserved).not.toHaveBeenCalled()
  })

  it('still stores when stamping the ladder fails', async () => {
    const { run, logger } = setup({
      copies: [],
      newReviewIds: new Set(['r-1']),
      stampActivity: new Error('db down'),
    })

    await expect(run()).resolves.toMatchObject({
      persistence: { outcome: 'stored', storedNew: 1 },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_head_check_activity_not_recorded' },
      expect.any(String),
    )
  })
})

describe('runReviewHeadCheck: persist mode and the head fact', () => {
  it('stores Google’s numbers after the reviews when they moved', async () => {
    const { run, repository, order } = setup({
      head: okHead([googleReview('r-1')], { totalReviewCount: 130, averageRating: 4.7 }),
      copies: [],
    })

    const result = await run()

    expect(repository.recordHeadFact).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROPERTY,
      sourceEpoch: EPOCH,
      factId: FACT_ID,
      reviewCount: 130,
      averageRating: 4.7,
      numbersObservedAt: expect.any(Date),
    })
    expect(order.indexOf('fact')).toBeGreaterThan(order.indexOf('persist:r-1'))
    expect(result).toMatchObject({ persistence: { factWritten: true } })
  })

  it('stamps the fact with the instant the page was read', async () => {
    const { run, repository } = setup({
      head: okHead([googleReview('r-1')], { totalReviewCount: 130, averageRating: 4.7 }),
      copies: [],
    })

    await run()

    // The clock ticks 100 ms per call: start, then the read right after Google answered.
    expect(repository.recordHeadFact).toHaveBeenCalledWith(
      expect.objectContaining({ numbersObservedAt: new Date(T0.getTime() + 100) }),
    )
  })

  it('writes no fact while Google’s numbers equal the newest fact and it is recent', async () => {
    const { run, repository } = setup()

    const result = await run()

    expect(repository.recordHeadFact).not.toHaveBeenCalled()
    expect(result).toMatchObject({ persistence: { factWritten: false } })
  })

  it('writes a heartbeat fact once the newest fact is six hours old', async () => {
    const { run, repository } = setup({
      state: {
        ...readyState,
        newestFact: {
          reviewCount: 2,
          averageRating: 5,
          observedAt: new Date(T0.getTime() - HEAD_FACT_HEARTBEAT_MS - 1_000),
        },
      },
    })

    await run()

    expect(repository.recordHeadFact).toHaveBeenCalledOnce()
  })

  it('reports the fact as not written, and does not throw, when it cannot be recorded', async () => {
    const { run, logger } = setup({
      head: okHead([googleReview('r-1')], { totalReviewCount: 130, averageRating: 4.7 }),
      copies: [storedCopy('r-1')],
      recordHeadFact: new Error('db down CANARY'),
    })

    const result = await run()

    expect(result).toMatchObject({
      status: 'compared',
      persistence: { outcome: 'stored', factWritten: false },
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('CANARY')
  })
})

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

describe('runReviewHeadCheck: persist mode never throws and leaves no latch', () => {
  it('counts a review whose write failed, stores the rest, and does not throw', async () => {
    const { run, persist, logger } = setup({
      copies: [],
      failPersistFor: new Set(['r-1']),
      newReviewIds: new Set(['r-2']),
    })

    const result = await run()

    expect(persist).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      status: 'compared',
      persistence: { outcome: 'stored', storedNew: 1, failed: 1 },
    })
    expect(logger.warn).toHaveBeenCalledWith(
      { event: 'review_head_check_persist_failed', failed: 1 },
      expect.any(String),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('CANARY')
  })

  it('counts a review that belongs to another location as failed instead of writing it', async () => {
    const { run, persist } = setup({
      head: okHead([googleReview('r-1', { reviewName: `${LOCATION}x/reviews/r-1` })], {
        totalReviewCount: 1,
        averageRating: 5,
      }),
      copies: [],
    })

    const result = await run()

    expect(persist).not.toHaveBeenCalled()
    expect(result).toMatchObject({ persistence: { storedNew: 0, failed: 1 } })
  })

  it('writes the row as mode head with what was actually stored and whether the fact was written', async () => {
    const { run, repository } = setup({
      head: okHead(
        [googleReview('r-new'), googleReview('r-edit', { sourceUpdatedAt: T0 })],
        {
          totalReviewCount: 99,
          averageRating: 4.5,
        },
      ),
      copies: [storedCopy('r-edit')],
      newReviewIds: new Set(['r-new']),
    })

    await run()

    expect(repository.recordRun).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'head',
        outcome: 'compared',
        persistence: {
          outcome: 'stored',
          storedNew: 1,
          storedOther: 1,
          failed: 0,
          factWritten: true,
        },
      }),
    )
  })

  it('logs counts and closed codes only: no id, location, review field or provider message', async () => {
    const { run, logger } = setup({ copies: [], failPersistFor: new Set(['r-1']) })

    await run()

    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])
    for (const secret of [
      String(ORG),
      String(PROPERTY),
      String(CONNECTION),
      LOCATION,
      'r-1',
      'Canary',
      'CANARY',
      FACT_ID,
    ]) {
      expect(logged).not.toContain(secret)
    }
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        persisted: 'stored',
        storedNew: 0,
        storedOther: 1,
        storeFailed: 1,
        factWritten: false,
      }),
      'Review head check finished',
    )
  })
})
