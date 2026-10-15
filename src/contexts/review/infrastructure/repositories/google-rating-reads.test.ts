// ReviewGoogleRatingReads against real PostgreSQL. The Property's Google
// rating goal plans with these counts and sums, so what counts matters: only
// servable Google reviews observed under the Property's CURRENT binding epoch,
// windowed by the date Google created them, with weeks running Monday to
// Sunday in the Property's time zone (Sofia here, UTC+3 until 25 Oct).
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

const ORG = organizationId('org-google-rating-reads-0000000000001')
const OTHER_ORG = organizationId('org-google-rating-reads-0000000000002')
const PROPERTY = propertyId('2c100000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('2c100000-0000-4000-8000-000000000002')
const FOREIGN_PROPERTY = propertyId('2c100000-0000-4000-8000-000000000003')
const NOW = new Date('2026-10-20T12:00:00.000Z')
const CACHE_VALID_UNTIL = '2026-11-30T00:00:00Z'
const DAY = 24 * 60 * 60 * 1000

let held: HeldTransaction

type ReviewSeed = Readonly<{
  id: string
  organization?: string
  property?: string
  rating: number
  reviewedAt: string
  epoch?: number
  contentExpiresAt?: string
}>

async function insertReview(seed: ReviewSeed): Promise<void> {
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
      seed.id,
      seed.organization ?? ORG,
      seed.property ?? PROPERTY,
      `ext-${seed.id.slice(-4)}`,
      GOOGLE_LOCATION_PRIMARY_RESOURCE,
      seed.rating,
      seed.reviewedAt,
      seed.contentExpiresAt ?? CACHE_VALID_UNTIL,
      seed.epoch ?? 2,
      '0'.repeat(64),
    ],
  )
}

/** A review Google removed: its content is erased, the stable identity stays. */
async function insertProviderDeletedReview(id: string): Promise<void> {
  await held.client.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, source_epoch, source_revision,
       analysis_sequence, source_content_state, source_content_erased_at
     ) VALUES ($1, $2, $3, 'google', 2, 0, 0, 'provider_deleted', $4::timestamptz)`,
    [id, ORG, PROPERTY, '2026-10-16T00:00:00Z'],
  )
}

beforeEach(async () => {
  held = await holdTransaction()
  for (const org of [ORG, OTHER_ORG]) {
    await held.client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Google rating reads', $1, now())`,
      [org],
    )
  }
  for (const [id, org, slug] of [
    [PROPERTY, ORG, 'rating-reads-sofia'],
    [OTHER_PROPERTY, ORG, 'rating-reads-other'],
    [FOREIGN_PROPERTY, OTHER_ORG, 'rating-reads-foreign'],
  ] as const) {
    await held.client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
       VALUES ($1, $2, $3, $3, 'Europe/Sofia', 2)`,
      [id, org, slug],
    )
  }
  // Counted: four current Google reviews.
  // 21:30 UTC on Sunday 18 Oct is 00:30 on Monday 19 Oct in Sofia.
  await insertReview({
    id: '2c200000-0000-4000-8000-00000000000a',
    rating: 5,
    reviewedAt: '2026-10-18T21:30:00Z',
  })
  // 20:30 UTC on Sunday 18 Oct is 23:30 on Sunday in Sofia: the week before.
  await insertReview({
    id: '2c200000-0000-4000-8000-00000000000b',
    rating: 4,
    reviewedAt: '2026-10-18T20:30:00Z',
  })
  await insertReview({
    id: '2c200000-0000-4000-8000-00000000000c',
    rating: 3,
    reviewedAt: '2026-10-01T10:00:00Z',
  })
  // Outside the 90-day window.
  await insertReview({
    id: '2c200000-0000-4000-8000-00000000000d',
    rating: 5,
    reviewedAt: '2026-06-01T10:00:00Z',
  })
  // Never counted: an earlier binding, an expired cache, another Property,
  // and a review Google removed.
  await insertReview({
    id: '2c200000-0000-4000-8000-00000000000e',
    rating: 5,
    reviewedAt: '2026-10-10T10:00:00Z',
    epoch: 1,
  })
  await insertReview({
    id: '2c200000-0000-4000-8000-00000000000f',
    rating: 1,
    reviewedAt: '2026-10-15T10:00:00Z',
    contentExpiresAt: '2026-10-19T00:00:00Z',
  })
  await insertReview({
    id: '2c200000-0000-4000-8000-000000000010',
    rating: 2,
    reviewedAt: '2026-10-15T10:00:00Z',
    property: OTHER_PROPERTY,
  })
  await insertProviderDeletedReview('2c200000-0000-4000-8000-000000000011')
  // Another Organization's current Google review, in this Sofia week. (Google
  // is the only review platform there is, so no other platform can be seeded.)
  await insertReview({
    id: '2c200000-0000-4000-8000-000000000012',
    organization: OTHER_ORG,
    property: FOREIGN_PROPERTY,
    rating: 1,
    reviewedAt: '2026-10-19T10:00:00Z',
  })
})

afterEach(async () => {
  await held.rollBack()
})

const reads = () => createGoogleRatingReads({ db: held.db, clock: () => NOW })

describe('Google rating reads for the rating goal', () => {
  it('sums the current Google reviews, the mix window, the most recent and each count window', async () => {
    const summary = await reads().getRatingSummary(ORG, PROPERTY, {
      mixWindowStart: new Date(NOW.getTime() - 90 * DAY),
      mostRecentLimit: 2,
      // The last 28 days, and this Sofia week from Monday 19 Oct, 00:00.
      countSince: [new Date(NOW.getTime() - 28 * DAY), new Date('2026-10-18T21:00:00Z')],
    })

    expect(summary).toEqual({
      all: { count: 4, sum: 17 },
      mixWindow: { count: 3, sum: 12 },
      mostRecent: { count: 2, sum: 9 },
      countsSince: [3, 1],
      totalsSince: null,
    })
  })

  it('sums the reviews created since an instant when asked, as a goal set then', async () => {
    const summary = await reads().getRatingSummary(ORG, PROPERTY, {
      mixWindowStart: new Date(NOW.getTime() - 90 * DAY),
      mostRecentLimit: 25,
      countSince: [],
      // Set on 1 October: the 3★, 4★ and 5★ reviews since count; June's does not.
      totalsSince: new Date('2026-10-01T10:00:00Z'),
    })

    expect(summary.totalsSince).toEqual({ count: 3, sum: 12 })
  })

  it('sums each calendar year of the Property time zone', async () => {
    // 22:30 UTC on 31 Dec 2025 is 00:30 on 1 Jan 2026 in Sofia; 21:30 is 23:30 on 31 Dec.
    await insertReview({
      id: '2c200000-0000-4000-8000-000000000020',
      rating: 2,
      reviewedAt: '2025-12-31T22:30:00Z',
    })
    await insertReview({
      id: '2c200000-0000-4000-8000-000000000021',
      rating: 4,
      reviewedAt: '2025-12-31T21:30:00Z',
    })

    const years = await reads().getYearlyTotals(ORG, PROPERTY)

    // The earlier binding, the expired cache, another Property and the removed
    // review never count.
    expect(years).toEqual([
      { year: 2025, count: 1, sum: 4 },
      { year: 2026, count: 5, sum: 19 },
    ])
  })

  it('takes every review there is when fewer than the most recent limit', async () => {
    const summary = await reads().getRatingSummary(ORG, PROPERTY, {
      mixWindowStart: NOW,
      mostRecentLimit: 25,
      countSince: [],
    })

    expect(summary.mostRecent).toEqual({ count: 4, sum: 17 })
    expect(summary.mixWindow).toEqual({ count: 0, sum: 0 })
    expect(summary.countsSince).toEqual([])
  })

  it('counts nothing once the Property moves to another binding epoch', async () => {
    await held.client.query('UPDATE properties SET source_epoch = 3 WHERE id = $1', [
      PROPERTY,
    ])

    const summary = await reads().getRatingSummary(ORG, PROPERTY, {
      mixWindowStart: new Date(NOW.getTime() - 90 * DAY),
      mostRecentLimit: 25,
      countSince: [],
    })

    expect(summary.all).toEqual({ count: 0, sum: 0 })
  })

  it('counts each Monday-to-Sunday week of the Property time zone', async () => {
    const weeks = await reads().getWeeklyCounts(
      ORG,
      PROPERTY,
      new Date('2026-09-27T21:00:00Z'),
    )

    expect(weeks).toEqual([
      { weekStart: '2026-09-28', count: 1 },
      { weekStart: '2026-10-12', count: 1 },
      { weekStart: '2026-10-19', count: 1 },
    ])
  })

  it('gives every star of the distribution, empty ones as zero', async () => {
    const stars = await reads().getStarDistribution(
      ORG,
      PROPERTY,
      new Date(NOW.getTime() - 90 * DAY),
    )

    expect(stars).toEqual([
      { stars: 1, count: 0 },
      { stars: 2, count: 0 },
      { stars: 3, count: 1 },
      { stars: 4, count: 1 },
      { stars: 5, count: 1 },
    ])
  })

  it('never counts another Organization’s reviews, even asked with this Property’s id', async () => {
    const since = new Date(NOW.getTime() - 90 * DAY)
    const request = { mixWindowStart: since, mostRecentLimit: 25, countSince: [since] }
    const none = { count: 0, sum: 0 }

    // Another Organization asking for this Property sees none of its reviews.
    await expect(reads().getRatingSummary(OTHER_ORG, PROPERTY, request)).resolves.toEqual(
      {
        all: none,
        mixWindow: none,
        mostRecent: none,
        countsSince: [0],
        totalsSince: null,
      },
    )
    await expect(reads().getWeeklyCounts(OTHER_ORG, PROPERTY, since)).resolves.toEqual([])
    await expect(reads().getYearlyTotals(OTHER_ORG, PROPERTY)).resolves.toEqual([])
    await expect(
      reads().getStarDistribution(OTHER_ORG, PROPERTY, since),
    ).resolves.toEqual([1, 2, 3, 4, 5].map((stars) => ({ stars, count: 0 })))
    // Its own review counts for its own Property, and nowhere else.
    await expect(
      reads().getRatingSummary(OTHER_ORG, FOREIGN_PROPERTY, request),
    ).resolves.toMatchObject({ all: { count: 1, sum: 1 } })
    await expect(reads().getRatingSummary(ORG, PROPERTY, request)).resolves.toMatchObject(
      {
        all: { count: 4, sum: 17 },
      },
    )
  })

  it('refuses more count windows than one read answers', async () => {
    await expect(
      reads().getRatingSummary(ORG, PROPERTY, {
        mixWindowStart: NOW,
        mostRecentLimit: 25,
        countSince: [NOW, NOW, NOW, NOW, NOW],
      }),
    ).rejects.toThrow(/Too many count windows/u)
  })
})
