import { describe, expect, it } from 'vitest'
import { COUNT_DROP_PERSISTENT_AFTER_MS } from '#/shared/domain/push-health'
import {
  COUNT_DROP_CONFIRM_AFTER_MS,
  compareHead,
  countDropStep,
  headReviewsToPersist,
  HEAD_LEASE_REFRESH_AFTER_MS,
  headCheckJobId,
  headPageOverflowed,
  type HeadComparisonInput,
  type HeadGoogleReview,
  type HeadStoredCopy,
} from './head-check'

const NOW = new Date('2026-10-21T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const EPOCH = 3

const stored = (overrides: Partial<HeadStoredCopy> = {}): HeadStoredCopy => ({
  externalId: 'review-a',
  sourceEpoch: EPOCH,
  sourceUpdatedAt: ago(2 * DAY_MS),
  lastFetchedAt: ago(1 * DAY_MS),
  reply: null,
  ...overrides,
})

const google = (overrides: Partial<HeadGoogleReview> = {}): HeadGoogleReview => ({
  externalId: 'review-a',
  sourceUpdatedAt: ago(2 * DAY_MS),
  replyText: null,
  replyUpdatedAt: null,
  ...overrides,
})

const compare = (overrides: Partial<HeadComparisonInput> = {}) =>
  compareHead({
    now: NOW,
    sourceEpoch: EPOCH,
    reviews: [],
    copies: [],
    googleTotal: 0,
    googleAverage: null,
    storedLiveCount: 0,
    storedAverage: null,
    hasMore: false,
    ...overrides,
  })

describe('compareHead: what a head page would persist', () => {
  it('finds nothing to persist when every review matches the stored copy', () => {
    const result = compare({
      reviews: [google()],
      copies: [stored()],
      googleTotal: 1,
      googleAverage: 5,
      storedLiveCount: 1,
      storedAverage: 5,
    })

    expect(result).toMatchObject({
      listed: 1,
      newCount: 0,
      changedCount: 0,
      replyChangedCount: 0,
      leaseRefreshCount: 0,
      wouldPersist: 0,
      totalDifference: 0,
      averageDifference: 0,
    })
  })

  it('counts a review RepKey has never stored as new, and as nothing else', () => {
    const result = compare({
      reviews: [google({ replyText: 'Thanks', replyUpdatedAt: ago(DAY_MS) })],
      copies: [],
    })

    expect(result).toMatchObject({
      listed: 1,
      newCount: 1,
      changedCount: 0,
      replyChangedCount: 0,
      leaseRefreshCount: 0,
      wouldPersist: 1,
    })
  })

  it('counts a review whose updateTime is newer than the stored one as changed', () => {
    const result = compare({
      reviews: [google({ sourceUpdatedAt: ago(1 * DAY_MS) })],
      copies: [stored({ sourceUpdatedAt: ago(2 * DAY_MS) })],
    })

    expect(result).toMatchObject({ changedCount: 1, wouldPersist: 1 })
  })

  it('does not count a review whose updateTime is older or equal', () => {
    const older = compare({
      reviews: [google({ sourceUpdatedAt: ago(3 * DAY_MS) })],
      copies: [stored({ sourceUpdatedAt: ago(2 * DAY_MS) })],
    })
    expect(older.changedCount).toBe(0)
  })

  it('counts a stored copy with no updateTime as changed once Google has one', () => {
    const result = compare({
      reviews: [google()],
      copies: [stored({ sourceUpdatedAt: null })],
    })

    expect(result.changedCount).toBe(1)
  })

  it('counts a copy from an older source epoch as changed', () => {
    const result = compare({
      reviews: [google()],
      copies: [stored({ sourceEpoch: EPOCH - 1 })],
    })

    expect(result.changedCount).toBe(1)
  })

  describe('reply', () => {
    it('counts a reply Google shows that RepKey has no reply head for', () => {
      const result = compare({
        reviews: [google({ replyText: 'Thanks', replyUpdatedAt: ago(DAY_MS) })],
        copies: [stored({ reply: null })],
      })

      expect(result).toMatchObject({ replyChangedCount: 1, changedCount: 0 })
    })

    it('counts a reply Google shows where RepKey recorded none', () => {
      const result = compare({
        reviews: [google({ replyText: 'Thanks', replyUpdatedAt: ago(DAY_MS) })],
        copies: [stored({ reply: { state: 'absent', providerUpdatedAt: null } })],
      })

      expect(result.replyChangedCount).toBe(1)
    })

    it('counts a reply RepKey holds that Google no longer shows', () => {
      const result = compare({
        reviews: [google({ replyText: null, replyUpdatedAt: null })],
        copies: [stored({ reply: { state: 'live', providerUpdatedAt: ago(DAY_MS) } })],
      })

      expect(result.replyChangedCount).toBe(1)
    })

    it('counts a reply whose updateTime differs from the stored reply head', () => {
      const result = compare({
        reviews: [google({ replyText: 'Thanks!', replyUpdatedAt: ago(1 * DAY_MS) })],
        copies: [
          stored({ reply: { state: 'live', providerUpdatedAt: ago(2 * DAY_MS) } }),
        ],
      })

      expect(result.replyChangedCount).toBe(1)
    })

    it('does not count a reply whose updateTime matches the stored reply head', () => {
      const result = compare({
        reviews: [google({ replyText: 'Thanks', replyUpdatedAt: ago(DAY_MS) })],
        copies: [stored({ reply: { state: 'live', providerUpdatedAt: ago(DAY_MS) } })],
      })

      expect(result.replyChangedCount).toBe(0)
    })

    it.each([
      ['2026-10-20T12:00:00.000Z', '2026-10-20T12:00:00.789Z'],
      ['2026-10-20T12:00:00.999Z', '2026-10-20T12:00:00.001Z'],
    ])('ignores reply fractions on both sides (%s, %s)', (storedTime, listTime) => {
      const result = compare({
        reviews: [google({ replyText: 'Thanks', replyUpdatedAt: new Date(listTime) })],
        copies: [
          stored({ reply: { state: 'live', providerUpdatedAt: new Date(storedTime) } }),
        ],
      })

      expect(result).toMatchObject({ replyChangedCount: 0, wouldPersist: 0 })
    })

    it.each([1000, 2000])('signals a real reply change %s ms apart', (difference) => {
      const storedTime = new Date('2026-10-20T12:00:00.789Z')
      const result = compare({
        reviews: [
          google({
            replyText: 'Thanks',
            replyUpdatedAt: new Date(storedTime.getTime() + difference),
          }),
        ],
        copies: [stored({ reply: { state: 'live', providerUpdatedAt: storedTime } })],
      })

      expect(result).toMatchObject({ replyChangedCount: 1, wouldPersist: 1 })
    })

    it.each([
      ['2026-10-20T12:00:00.999Z', '2026-10-20T12:00:01.000Z'],
      ['2026-10-20T12:00:01.000Z', '2026-10-20T12:00:00.999Z'],
    ])('detects adjacent reply seconds (%s, %s)', (storedTime, listTime) => {
      const review = google({ replyText: 'Thanks', replyUpdatedAt: new Date(listTime) })
      const input: HeadComparisonInput = {
        now: NOW,
        sourceEpoch: EPOCH,
        reviews: [review],
        copies: [
          stored({ reply: { state: 'live', providerUpdatedAt: new Date(storedTime) } }),
        ],
        googleTotal: 1,
        googleAverage: 5,
        storedLiveCount: 1,
        storedAverage: 5,
        hasMore: false,
      }

      expect(compareHead(input)).toMatchObject({ replyChangedCount: 1, wouldPersist: 1 })
      expect(headReviewsToPersist(input)).toEqual([review])
    })

    it('does not count no reply on both sides', () => {
      const result = compare({
        reviews: [google()],
        copies: [stored({ reply: { state: 'absent', providerUpdatedAt: null } })],
      })

      expect(result.replyChangedCount).toBe(0)
    })

    it('does not count an unreadable reply: persist records nothing for it', () => {
      const result = compare({
        reviews: [google({ replyText: null, replyUnreadable: true })],
        copies: [stored({ reply: { state: 'live', providerUpdatedAt: ago(DAY_MS) } })],
      })

      expect(result.replyChangedCount).toBe(0)
      expect(result.wouldPersist).toBe(0)
    })
  })

  describe('lease refresh', () => {
    it('counts a copy last fetched five days ago', () => {
      const result = compare({
        reviews: [google()],
        copies: [stored({ lastFetchedAt: ago(HEAD_LEASE_REFRESH_AFTER_MS) })],
      })

      expect(result).toMatchObject({ leaseRefreshCount: 1, wouldPersist: 1 })
    })

    it('does not count a copy fetched just under five days ago', () => {
      const result = compare({
        reviews: [google()],
        copies: [stored({ lastFetchedAt: ago(HEAD_LEASE_REFRESH_AFTER_MS - 1) })],
      })

      expect(result.leaseRefreshCount).toBe(0)
    })

    it('counts a copy that was never fetched', () => {
      const result = compare({
        reviews: [google()],
        copies: [stored({ lastFetchedAt: null })],
      })

      expect(result.leaseRefreshCount).toBe(1)
    })
  })

  it('counts a review once in wouldPersist however many classes it falls in', () => {
    const result = compare({
      reviews: [
        google({
          sourceUpdatedAt: ago(1 * DAY_MS),
          replyText: 'Thanks',
          replyUpdatedAt: ago(1 * DAY_MS),
        }),
      ],
      copies: [stored({ lastFetchedAt: ago(6 * DAY_MS) })],
    })

    expect(result).toMatchObject({
      changedCount: 1,
      replyChangedCount: 1,
      leaseRefreshCount: 1,
      wouldPersist: 1,
    })
  })

  it('classifies a mixed page review by review', () => {
    const result = compare({
      reviews: [
        google({ externalId: 'new-one' }),
        google({ externalId: 'edited', sourceUpdatedAt: ago(DAY_MS) }),
        google({ externalId: 'replied', replyText: 'Hi', replyUpdatedAt: ago(DAY_MS) }),
        google({ externalId: 'old-copy' }),
        google({ externalId: 'same' }),
      ],
      copies: [
        stored({ externalId: 'edited' }),
        stored({ externalId: 'replied' }),
        stored({ externalId: 'old-copy', lastFetchedAt: ago(9 * DAY_MS) }),
        stored({ externalId: 'same' }),
        stored({ externalId: 'not-on-this-page' }),
      ],
    })

    expect(result).toMatchObject({
      listed: 5,
      newCount: 1,
      changedCount: 1,
      replyChangedCount: 1,
      leaseRefreshCount: 1,
      contentChangedCount: 3,
      wouldPersist: 4,
    })
  })

  it('reports an empty location with no total and no average as zero everywhere', () => {
    const result = compare({ reviews: [], copies: [] })

    expect(result).toEqual({
      listed: 0,
      newCount: 0,
      changedCount: 0,
      replyChangedCount: 0,
      leaseRefreshCount: 0,
      contentChangedCount: 0,
      wouldPersist: 0,
      googleTotal: 0,
      storedLiveCount: 0,
      totalDifference: 0,
      googleAverage: null,
      storedAverage: null,
      averageDifference: null,
      hasMore: false,
    })
  })

  describe('Google aggregate against the stored copies', () => {
    it('reports Google total minus the stored live count, positive when RepKey holds fewer', () => {
      const result = compare({ googleTotal: 120, storedLiveCount: 117 })

      expect(result.totalDifference).toBe(3)
    })

    it('reports a negative total difference when RepKey holds more', () => {
      const result = compare({ googleTotal: 10, storedLiveCount: 12 })

      expect(result.totalDifference).toBe(-2)
    })

    it('rounds the average difference to two places, Google minus stored', () => {
      const result = compare({
        googleTotal: 3,
        googleAverage: 4.7,
        storedLiveCount: 3,
        storedAverage: 4.3333333,
      })

      expect(result).toMatchObject({ googleAverage: 4.7, averageDifference: 0.37 })
    })

    it('has no average difference when either side has no average', () => {
      expect(
        compare({ googleTotal: 2, googleAverage: 4, storedAverage: null })
          .averageDifference,
      ).toBeNull()
      expect(
        compare({ googleTotal: 0, googleAverage: null, storedAverage: 4 })
          .averageDifference,
      ).toBeNull()
    })

    it('carries hasMore through', () => {
      expect(compare({ hasMore: true }).hasMore).toBe(true)
    })
  })
})

describe('headCheckJobId', () => {
  const PROPERTY = '3f1c1d5e-0000-4000-8000-000000000001'
  const BUCKET_MS = 15 * 60 * 1000

  it('is the same for two looks in one bucket, so they never stack', () => {
    const early = headCheckJobId(
      PROPERTY,
      new Date('2026-10-21T12:01:00.000Z'),
      BUCKET_MS,
    )
    const late = headCheckJobId(PROPERTY, new Date('2026-10-21T12:14:59.000Z'), BUCKET_MS)

    expect(early).toBe(late)
  })

  it('differs across buckets and across properties', () => {
    const base = headCheckJobId(PROPERTY, new Date('2026-10-21T12:01:00.000Z'), BUCKET_MS)

    expect(
      headCheckJobId(PROPERTY, new Date('2026-10-21T12:16:00.000Z'), BUCKET_MS),
    ).not.toBe(base)
    expect(
      headCheckJobId(
        '3f1c1d5e-0000-4000-8000-000000000002',
        new Date('2026-10-21T12:01:00.000Z'),
        BUCKET_MS,
      ),
    ).not.toBe(base)
  })

  it('carries the property id and no colon, which BullMQ job ids refuse', () => {
    const id = headCheckJobId(PROPERTY, NOW, BUCKET_MS)

    expect(id).toContain(PROPERTY)
    expect(id).not.toContain(':')
  })
})

describe('headReviewsToPersist: the reviews a persisting check stores', () => {
  const input = (overrides: Partial<HeadComparisonInput> = {}) => ({
    now: NOW,
    sourceEpoch: EPOCH,
    reviews: [] as readonly HeadGoogleReview[],
    copies: [] as readonly HeadStoredCopy[],
    googleTotal: 0,
    googleAverage: null,
    storedLiveCount: 0,
    storedAverage: null,
    hasMore: false,
    ...overrides,
  })

  it('stores a review once even when it is both changed and due a refresh', () => {
    const changedAndStale = google({ externalId: 'review-a', sourceUpdatedAt: ago(1000) })

    const persisted = headReviewsToPersist(
      input({
        reviews: [changedAndStale],
        copies: [stored({ lastFetchedAt: ago(6 * DAY_MS) })],
      }),
    )

    expect(persisted.map((review) => review.externalId)).toEqual(['review-a'])
  })

  it('leaves out every review that matches its stored copy', () => {
    const persisted = headReviewsToPersist(
      input({
        reviews: [google({ externalId: 'review-a' }), google({ externalId: 'review-b' })],
        copies: [stored({ externalId: 'review-a' }), stored({ externalId: 'review-b' })],
      }),
    )

    expect(persisted).toEqual([])
  })

  it('stores new, changed, reply-changed and lease-refresh reviews, in the page’s order', () => {
    const persisted = headReviewsToPersist(
      input({
        reviews: [
          google({ externalId: 'new' }),
          google({ externalId: 'same' }),
          google({ externalId: 'edited', sourceUpdatedAt: ago(10) }),
          google({ externalId: 'replied', replyText: 'Thanks', replyUpdatedAt: ago(5) }),
          google({ externalId: 'stale' }),
        ],
        copies: [
          stored({ externalId: 'same' }),
          stored({ externalId: 'edited' }),
          stored({ externalId: 'replied' }),
          stored({
            externalId: 'stale',
            lastFetchedAt: ago(HEAD_LEASE_REFRESH_AFTER_MS),
          }),
        ],
      }),
    )

    expect(persisted.map((review) => review.externalId)).toEqual([
      'new',
      'edited',
      'replied',
      'stale',
    ])
  })

  it('counts exactly what compareHead says it would persist', () => {
    const reviews = [
      google({ externalId: 'new' }),
      google({ externalId: 'same' }),
      google({ externalId: 'edited', sourceUpdatedAt: ago(10) }),
    ]
    const copies = [stored({ externalId: 'same' }), stored({ externalId: 'edited' })]

    expect(headReviewsToPersist(input({ reviews, copies })).length).toBe(
      compare({ reviews, copies }).wouldPersist,
    )
  })
})

describe('headPageOverflowed: a whole page changed with more behind it', () => {
  const page = (count: number, make: (id: string) => HeadGoogleReview) =>
    Array.from({ length: count }, (_, index) => make(`review-${index}`))
  const copiesOf = (count: number, over: Partial<HeadStoredCopy> = {}) =>
    Array.from({ length: count }, (_, index) =>
      stored({ externalId: `review-${index}`, ...over }),
    )

  it('is true when all fifty reviews are new, edited or replied to and more pages follow', () => {
    const reviews = [
      ...page(20, (externalId) => google({ externalId: `${externalId}-new` })),
      ...page(30, (externalId) => google({ externalId, sourceUpdatedAt: ago(10) })),
    ]
    const comparison = compare({ reviews, copies: copiesOf(30), hasMore: true })

    expect(comparison.contentChangedCount).toBe(50)
    expect(headPageOverflowed(comparison)).toBe(true)
  })

  it('is false when Google has no further page', () => {
    const reviews = page(50, (externalId) => google({ externalId }))
    expect(headPageOverflowed(compare({ reviews, hasMore: false }))).toBe(false)
  })

  it('is false when one review on the page is unchanged', () => {
    const reviews = page(50, (externalId) =>
      google({ externalId, sourceUpdatedAt: ago(10) }),
    )
    const copies = [
      ...copiesOf(49),
      stored({ externalId: 'review-49', sourceUpdatedAt: ago(10) }),
    ]
    expect(headPageOverflowed(compare({ reviews, copies, hasMore: true }))).toBe(false)
  })

  it('does not count the routine five-day content-clock refresh as a change', () => {
    const reviews = page(50, (externalId) => google({ externalId }))
    const comparison = compare({
      reviews,
      copies: copiesOf(50, { lastFetchedAt: ago(HEAD_LEASE_REFRESH_AFTER_MS) }),
      hasMore: true,
    })

    expect(comparison).toMatchObject({ leaseRefreshCount: 50, wouldPersist: 50 })
    expect(comparison.contentChangedCount).toBe(0)
    expect(headPageOverflowed(comparison)).toBe(false)
  })

  it('is false for an empty page', () => {
    expect(headPageOverflowed(compare({ reviews: [], hasMore: true }))).toBe(false)
  })
})

describe('countDropStep', () => {
  const SEEN = new Date('2026-11-01T00:00:00.000Z')
  const after = (ms: number) => ({
    firstSeenAt: SEEN,
    now: new Date(SEEN.getTime() + ms),
  })
  const MINUTE_MS = 60 * 1000

  it('is seen on the first check and under 15 minutes after it', () => {
    expect(countDropStep(after(0))).toBe('seen')
    expect(countDropStep(after(15 * MINUTE_MS - 1))).toBe('seen')
  })

  it('is confirmed from 15 minutes until 72 hours after the first sighting', () => {
    expect(COUNT_DROP_CONFIRM_AFTER_MS).toBe(15 * MINUTE_MS)
    expect(countDropStep(after(15 * MINUTE_MS))).toBe('confirmed')
    expect(countDropStep(after(COUNT_DROP_PERSISTENT_AFTER_MS - 1))).toBe('confirmed')
  })

  it('is persistent from 72 hours on', () => {
    expect(COUNT_DROP_PERSISTENT_AFTER_MS).toBe(72 * 60 * MINUTE_MS)
    expect(countDropStep(after(COUNT_DROP_PERSISTENT_AFTER_MS))).toBe('persistent')
  })
})
