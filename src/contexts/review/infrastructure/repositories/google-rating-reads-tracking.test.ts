// ReviewGoogleRatingReads for the rating goal's tracking page, against real
// PostgreSQL (round 5, PLAN-D D-2 and D-2b): the exact average at the end of
// each Property-local week, Google's own number over time, and the low reviews
// since a goal was set (the owner's per-review exception). The same reviews
// count as for every other goal read (servable, Google, current binding
// epoch), weeks run Monday to Sunday in Sofia (UTC+3, UTC+2 from 25 Oct), and
// no week sum leaves the read.
//
// One held transaction per test, always rolled back.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createGoogleRatingReads } from '../google-rating-reads'

const ORG = organizationId('org-google-rating-tracking-000000000001')
const OTHER_ORG = organizationId('org-google-rating-tracking-000000000002')
const PROPERTY = propertyId('2d100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('2d100000-0000-4000-8000-000000000002')
const FOREIGN_PROPERTY = propertyId('2d100000-0000-4000-8000-000000000003')
// Tuesday 3 November 2026, after the clocks went back on Sunday 25 October.
const NOW = new Date('2026-11-03T12:00:00.000Z')
// Monday 12 October 2026, 00:00 in Sofia (UTC+3).
const SINCE = new Date('2026-10-11T21:00:00.000Z')
const CACHE_VALID_UNTIL = '2026-12-31T00:00:00Z'

let held: HeldTransaction
let seeded = 0

const nextId = (prefix: string): string =>
  `${prefix}-0000-4000-8000-${String(++seeded).padStart(12, '0')}`

type ReviewSeed = Readonly<{
  rating: number
  reviewedAt: string
  organization?: string
  property?: string
  epoch?: number
  contentExpiresAt?: string
}>

async function insertReview(seed: ReviewSeed): Promise<string> {
  const id = nextId('2d200000')
  await held.client.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, reviewer_name, rating, text, reviewed_at,
       expires_at, content_expires_at, first_fetched_at, last_fetched_at,
       source_epoch, source_revision, analysis_sequence,
       ai_source_byte_length, ai_source_digest
     ) VALUES (
       $1, $2, $3, 'google', $4, $5, 'Guest', $6, 'Stay', $7::timestamptz,
       $8::timestamptz, $8::timestamptz, $7::timestamptz, $7::timestamptz,
       $9, 0, 0, 1, $10
     )`,
    [
      id,
      seed.organization ?? ORG,
      seed.property ?? PROPERTY,
      `ext-${id.slice(-6)}`,
      GOOGLE_LOCATION_PRIMARY_RESOURCE,
      seed.rating,
      seed.reviewedAt,
      seed.contentExpiresAt ?? CACHE_VALID_UNTIL,
      seed.epoch ?? 2,
      '0'.repeat(64),
    ],
  )
  return id
}

type FactSeed = Readonly<{
  at: string
  averageRating: number | null
  reviewCount: number
  organization?: string
  property?: string
  epoch?: number
}>

async function insertFact(seed: FactSeed): Promise<void> {
  await held.client.query(
    `INSERT INTO review_google_reputation_snapshot_facts (
       run_id, event_id, organization_id, property_id, source_epoch,
       review_count, average_rating, evaluated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)`,
    [
      nextId('2d300000'),
      nextId('2d400000'),
      seed.organization ?? ORG,
      seed.property ?? PROPERTY,
      seed.epoch ?? 2,
      seed.reviewCount,
      seed.averageRating,
      seed.at,
    ],
  )
}

beforeEach(async () => {
  held = await holdTransaction()
  for (const org of [ORG, OTHER_ORG]) {
    await held.client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Google rating tracking', $1, now())`,
      [org],
    )
  }
  for (const [id, org, slug] of [
    [PROPERTY, ORG, 'rating-tracking-sofia'],
    [OTHER_PROPERTY, ORG, 'rating-tracking-other'],
    [FOREIGN_PROPERTY, OTHER_ORG, 'rating-tracking-foreign'],
  ] as const) {
    await held.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
       VALUES ($1, $2, $3, $3, 'Europe/Sofia', 2)`,
      [id, org, slug],
    )
  }
})

afterEach(async () => {
  await held.rollBack()
})

const reads = () => createGoogleRatingReads({ db: held.db, clock: () => NOW })

/** Six counted reviews summing 23, around both Sofia week boundaries. */
async function seedCountedReviews(): Promise<void> {
  // 21:30 UTC on Sunday 18 Oct is 00:30 on Monday 19 Oct in Sofia (UTC+3).
  await insertReview({ rating: 5, reviewedAt: '2026-10-18T21:30:00Z' })
  // 21:30 UTC on Sunday 25 Oct is 23:30 that Sunday in Sofia (UTC+2 by then).
  await insertReview({ rating: 4, reviewedAt: '2026-10-25T21:30:00Z' })
  // 22:30 UTC on Sunday 25 Oct is 00:30 on Monday 26 Oct in Sofia.
  await insertReview({ rating: 3, reviewedAt: '2026-10-25T22:30:00Z' })
  await insertReview({ rating: 4, reviewedAt: '2026-11-02T10:00:00Z' })
  // Before the history starts: 23:30 on Sunday 11 Oct in Sofia.
  await insertReview({ rating: 2, reviewedAt: '2026-10-11T20:30:00Z' })
  await insertReview({ rating: 5, reviewedAt: '2026-06-01T10:00:00Z' })
}

/** Reviews that never count: another Property or tenant, an earlier epoch, an expired clock, a removal. */
async function seedExcludedReviews(): Promise<void> {
  await insertReview({ rating: 1, reviewedAt: '2026-10-20T10:00:00Z', epoch: 1 })
  await insertReview({
    rating: 1,
    reviewedAt: '2026-10-20T10:00:00Z',
    contentExpiresAt: '2026-11-01T00:00:00Z',
  })
  await insertReview({
    rating: 1,
    reviewedAt: '2026-10-20T10:00:00Z',
    property: OTHER_PROPERTY,
  })
  await insertReview({
    rating: 1,
    reviewedAt: '2026-10-20T10:00:00Z',
    organization: OTHER_ORG,
    property: FOREIGN_PROPERTY,
  })
  await held.client.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, source_epoch, source_revision,
       analysis_sequence, source_content_state, source_content_erased_at
     ) VALUES ($1, $2, $3, 'google', 2, 0, 0, 'provider_deleted', $4::timestamptz)`,
    [nextId('2d200000'), ORG, PROPERTY, '2026-10-21T00:00:00Z'],
  )
}

describe('the exact average at the end of each week', () => {
  it('ends each Sofia week where its reviews leave it, across the clocks going back', async () => {
    await seedCountedReviews()
    await seedExcludedReviews()

    const history = await reads().getWeeklyHistory(ORG, PROPERTY, SINCE)

    // All: 23 / 6; before this week 19 / 5; before 26 Oct 16 / 4; before 12 Oct 7 / 2.
    expect(history).toEqual({
      startAverageThousandths: 3500,
      weeks: [
        { weekStart: '2026-10-19', count: 2, endAverageThousandths: 4000 },
        { weekStart: '2026-10-26', count: 1, endAverageThousandths: 3800 },
        { weekStart: '2026-11-02', count: 1, endAverageThousandths: 3833 },
      ],
    })
  })

  it('ends the last week on the average every other goal read takes', async () => {
    await seedCountedReviews()
    await seedExcludedReviews()

    // One query at a time: the held transaction is one client.
    const history = await reads().getWeeklyHistory(ORG, PROPERTY, SINCE)
    const summary = await reads().getRatingSummary(ORG, PROPERTY, {
      mixWindowStart: SINCE,
      mostRecentLimit: 25,
      countSince: [],
    })

    const last = history.weeks.at(-1)
    expect(summary.all).toEqual({ count: 6, sum: 23 })
    expect(last?.endAverageThousandths).toBe(
      Math.round((summary.all.sum / summary.all.count) * 1000),
    )
  })

  it('returns counts and averages, never a week’s star sum', async () => {
    await seedCountedReviews()

    const history = await reads().getWeeklyHistory(ORG, PROPERTY, SINCE)

    expect(Object.keys(history).sort()).toEqual(['startAverageThousandths', 'weeks'])
    for (const week of history.weeks) {
      expect(Object.keys(week).sort()).toEqual([
        'count',
        'endAverageThousandths',
        'weekStart',
      ])
    }
  })

  it('has nothing for another tenant or once the Property moves to another epoch', async () => {
    await seedCountedReviews()

    await expect(reads().getWeeklyHistory(OTHER_ORG, PROPERTY, SINCE)).resolves.toEqual({
      startAverageThousandths: null,
      weeks: [],
    })
    await held.client.query(`UPDATE properties SET source_epoch = 3 WHERE id = $1`, [
      PROPERTY,
    ])
    await expect(reads().getWeeklyHistory(ORG, PROPERTY, SINCE)).resolves.toEqual({
      startAverageThousandths: null,
      weeks: [],
    })
  })
})

describe('Google’s shown number over time', () => {
  it('gives the number in force at since, then each change of the shown tenth', async () => {
    await insertFact({ at: '2026-09-01T08:00:00Z', averageRating: 3.9, reviewCount: 250 })
    await insertFact({
      at: '2026-10-05T08:00:00Z',
      averageRating: 3.9000000953674316,
      reviewCount: 255,
    })
    // A float32 artefact of the same 3.9 is no change.
    await insertFact({
      at: '2026-10-14T08:00:00Z',
      averageRating: 3.9000000953674316,
      reviewCount: 258,
    })
    await insertFact({ at: '2026-10-20T08:00:00Z', averageRating: 4, reviewCount: 262 })
    // 3.95 shows 4.0 (half up): no change.
    await insertFact({
      at: '2026-10-22T08:00:00Z',
      averageRating: 3.95,
      reviewCount: 263,
    })
    await insertFact({
      at: '2026-10-28T08:00:00Z',
      averageRating: 3.94,
      reviewCount: 265,
    })
    // Never counted: an earlier epoch, another Property, another tenant.
    await insertFact({
      at: '2026-10-25T08:00:00Z',
      averageRating: 4.5,
      reviewCount: 9,
      epoch: 1,
    })
    await insertFact({
      at: '2026-10-25T08:00:00Z',
      averageRating: 4.5,
      reviewCount: 9,
      property: OTHER_PROPERTY,
    })
    await insertFact({
      at: '2026-10-25T08:00:00Z',
      averageRating: 4.5,
      reviewCount: 9,
      organization: OTHER_ORG,
      property: FOREIGN_PROPERTY,
    })

    const shown = await reads().getShownNumberChanges(ORG, PROPERTY, SINCE)

    expect(shown).toEqual([
      {
        at: new Date('2026-10-05T08:00:00Z'),
        averageRating: 3.9000000953674316,
        reviewCount: 255,
      },
      { at: new Date('2026-10-20T08:00:00Z'), averageRating: 4, reviewCount: 262 },
      { at: new Date('2026-10-28T08:00:00Z'), averageRating: 3.94, reviewCount: 265 },
    ])
  })

  it('reads nothing older than the number in force at since', async () => {
    // Years of earlier snapshots, flapping: none is returned, none is a change's "before".
    await insertFact({ at: '2024-03-01T08:00:00Z', averageRating: 4.5, reviewCount: 90 })
    await insertFact({ at: '2025-03-01T08:00:00Z', averageRating: 3.0, reviewCount: 150 })
    await insertFact({ at: '2026-10-05T08:00:00Z', averageRating: 3.9, reviewCount: 255 })
    await insertFact({ at: '2026-10-14T08:00:00Z', averageRating: 3.9, reviewCount: 258 })

    const shown = await reads().getShownNumberChanges(ORG, PROPERTY, SINCE)

    expect(shown).toEqual([
      { at: new Date('2026-10-05T08:00:00Z'), averageRating: 3.9, reviewCount: 255 },
    ])
  })

  it('starts with the first snapshot after since when none was in force', async () => {
    await insertFact({ at: '2026-10-20T08:00:00Z', averageRating: 4, reviewCount: 262 })
    await insertFact({
      at: '2026-10-22T08:00:00Z',
      averageRating: 3.95,
      reviewCount: 263,
    })

    const shown = await reads().getShownNumberChanges(ORG, PROPERTY, SINCE)

    expect(shown).toEqual([
      { at: new Date('2026-10-20T08:00:00Z'), averageRating: 4, reviewCount: 262 },
    ])
  })

  it('starts again from the first snapshot of a new binding epoch', async () => {
    await insertFact({ at: '2026-10-05T08:00:00Z', averageRating: 3.9, reviewCount: 255 })
    await held.client.query(`UPDATE properties SET source_epoch = 3 WHERE id = $1`, [
      PROPERTY,
    ])
    await insertFact({
      at: '2026-10-30T08:00:00Z',
      averageRating: 4.2,
      reviewCount: 12,
      epoch: 3,
    })

    const shown = await reads().getShownNumberChanges(ORG, PROPERTY, SINCE)

    expect(shown).toEqual([
      { at: new Date('2026-10-30T08:00:00Z'), averageRating: 4.2, reviewCount: 12 },
    ])
  })

  it('keeps the newest changes when there are more than one read returns', async () => {
    await insertFact({ at: '2026-10-01T08:00:00Z', averageRating: 3.9, reviewCount: 200 })
    for (let hour = 0; hour < 120; hour++) {
      await insertFact({
        at: new Date(Date.UTC(2026, 9, 13, hour)).toISOString(),
        averageRating: hour % 2 === 0 ? 4 : 3.9,
        reviewCount: 201 + hour,
      })
    }

    const shown = await reads().getShownNumberChanges(ORG, PROPERTY, SINCE)

    expect(shown).toHaveLength(100)
    expect(shown[0]).toMatchObject({ averageRating: 3.9, reviewCount: 200 })
    expect(shown[1]?.reviewCount).toBe(201 + 21)
    expect(shown.at(-1)?.reviewCount).toBe(201 + 119)
  })
})

describe('the low reviews since a goal was set', () => {
  // A goal of 4.1 starts at 4.05, one of 3.9 at 3.85.
  const BELOW_41 = 4050
  const BELOW_39 = 3850

  it('names each review under the threshold up to 4★, newest first', async () => {
    const two = await insertReview({ rating: 2, reviewedAt: '2026-10-20T10:00:00Z' })
    const four = await insertReview({ rating: 4, reviewedAt: '2026-10-28T10:00:00Z' })
    const one = await insertReview({ rating: 1, reviewedAt: '2026-11-02T09:00:00Z' })
    await insertReview({ rating: 5, reviewedAt: '2026-11-01T10:00:00Z' })

    const low = await reads().getLowReviews(ORG, PROPERTY, SINCE, BELOW_41, 25)

    expect(low).toEqual([
      { reviewId: one, stars: 1, reviewedAt: new Date('2026-11-02T09:00:00Z') },
      { reviewId: four, stars: 4, reviewedAt: new Date('2026-10-28T10:00:00Z') },
      { reviewId: two, stars: 2, reviewedAt: new Date('2026-10-20T10:00:00Z') },
    ])
  })

  it('leaves a 4★ review out of a goal it does not set back', async () => {
    await insertReview({ rating: 4, reviewedAt: '2026-10-28T10:00:00Z' })
    const three = await insertReview({ rating: 3, reviewedAt: '2026-10-29T10:00:00Z' })

    const low = await reads().getLowReviews(ORG, PROPERTY, SINCE, BELOW_39, 25)

    expect(low.map((review) => review.reviewId)).toEqual([three])
  })

  it('never names a 5★ review, even under a threshold above it', async () => {
    await insertReview({ rating: 5, reviewedAt: '2026-10-28T10:00:00Z' })
    const four = await insertReview({ rating: 4, reviewedAt: '2026-10-29T10:00:00Z' })

    const low = await reads().getLowReviews(ORG, PROPERTY, SINCE, 5050, 25)

    expect(low.map((review) => review.stars)).toEqual([4])
    expect(low[0]?.reviewId).toBe(four)
  })

  it('names only reviews since the set that every goal read counts', async () => {
    await seedCountedReviews()
    await seedExcludedReviews()

    const low = await reads().getLowReviews(ORG, PROPERTY, SINCE, BELOW_41, 25)

    // The 2★ of Sunday 11 Oct is before the set; every 1★ is excluded.
    expect(low.map((review) => review.stars)).toEqual([4, 3, 4])
  })

  it('keeps the newest within the limit, by time and then by id', async () => {
    const first = await insertReview({ rating: 2, reviewedAt: '2026-10-20T10:00:00Z' })
    const second = await insertReview({ rating: 3, reviewedAt: '2026-10-20T10:00:00Z' })
    await insertReview({ rating: 1, reviewedAt: '2026-10-13T10:00:00Z' })

    const low = await reads().getLowReviews(ORG, PROPERTY, SINCE, BELOW_41, 2)

    expect(low.map((review) => review.reviewId)).toEqual([second, first])
  })

  it('returns an id, stars and a time, nothing else', async () => {
    await insertReview({ rating: 2, reviewedAt: '2026-10-20T10:00:00Z' })

    const low = await reads().getLowReviews(ORG, PROPERTY, SINCE, BELOW_41, 25)

    expect(low).toHaveLength(1)
    expect(Object.keys(low[0] ?? {}).sort()).toEqual(['reviewId', 'reviewedAt', 'stars'])
  })

  it('refuses to read more than 25', async () => {
    await expect(
      reads().getLowReviews(ORG, PROPERTY, SINCE, BELOW_41, 26),
    ).rejects.toThrow(RangeError)
  })

  it('has nothing for another tenant', async () => {
    await insertReview({ rating: 2, reviewedAt: '2026-10-20T10:00:00Z' })

    await expect(
      reads().getLowReviews(OTHER_ORG, PROPERTY, SINCE, BELOW_41, 25),
    ).resolves.toEqual([])
  })
})
