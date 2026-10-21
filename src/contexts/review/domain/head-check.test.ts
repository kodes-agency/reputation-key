import { describe, expect, it } from 'vitest'
import {
  compareHead,
  headReviewsToPersist,
  HEAD_LEASE_REFRESH_AFTER_MS,
  headCheckJobId,
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
