import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  eraseReviewSourceContent,
  replyScopeEffects,
} from '#/contexts/reputation/application/public-api'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { computeAiReviewSourceProvenance } from '../../application/ai-review-source'
import { createEligibleReads } from '../../application/eligible-reads'
import type { Review } from '../../domain/types'
import { createGoogleRatingReads } from '../google-rating-reads'
import { createServingStats } from '../serving-stats'
import { createReviewRepository } from './review.repository'

const ORG = organizationId('org-content-writes-1250973801')
const PROPERTY = propertyId('7e210000-0000-4000-8000-000000000001')
const REVIEW = reviewId('7e210000-0000-4000-8000-0000000000a1')
const NOW = new Date()
const DAY = 24 * 60 * 60 * 1000
const REVIEWED_AT = new Date(NOW.getTime() - 2 * DAY)
const EXPIRES_AT = new Date(NOW.getTime() + 30 * DAY)
const ORIGINAL = 'The room was clean and quiet.'
const EDITED = 'The room was clean but the breakfast was cold.'

let lease: TestLease | undefined
const db = getDb()
const repo = createReviewRepository(db, () => NOW, undefined, replyScopeEffects)
const eligible = createEligibleReads({ reviewRepo: repo, clock: () => NOW })
const stats = createServingStats({ db, clock: () => NOW })
const ratings = createGoogleRatingReads({ db, clock: () => NOW })

function pool() {
  if (!lease) throw new Error('Disposable database lease was not acquired')
  return lease.pool
}

async function clean(): Promise<void> {
  await pool().query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool().query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool(), [ORG])
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
})

afterAll(async () => {
  if (!lease) return
  try {
    await clean()
  } finally {
    await lease.release()
  }
})

beforeEach(async () => {
  await clean()
  await pool().query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Content writes', $2, NOW())`,
    [ORG, `content-writes-${process.pid}`],
  )
  await pool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Content writes property', 'content-writes', 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG],
  )
})

function observation(
  text = ORIGINAL,
  overrides: Partial<Omit<Review, 'createdAt' | 'updatedAt'>> = {},
): Omit<Review, 'createdAt' | 'updatedAt'> {
  const review = {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google' as const,
    externalId: 'content-writes-review',
    externalLocationId: 'locations/content-writes',
    googleConnectionId: null,
    reviewerName: 'A guest',
    reviewerProfilePhotoUrl: 'https://example.com/guest.png',
    googleReviewUrl: 'https://example.com/review',
    rating: 4 as const,
    text,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: REVIEWED_AT,
    expiresAt: EXPIRES_AT,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: REVIEWED_AT,
    sourceUpdatedAt: REVIEWED_AT,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: EXPIRES_AT,
    contentHash: 'a'.repeat(64),
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 1,
    ...overrides,
  }
  const provenance = computeAiReviewSourceProvenance({
    text: review.text,
    rating: review.rating,
    languageCode: review.languageCode,
    reviewedAtEpochMillis: review.reviewedAt.getTime(),
    reviewerDisplayName: review.reviewerName,
  })
  return {
    ...review,
    aiSourceByteLength: provenance.byteLength,
    aiSourceDigest: provenance.digest,
  }
}

async function firstFetchHistory(): Promise<Date | null> {
  const result = await pool().query<{ first_fetched_at: Date | null }>(
    'SELECT first_fetched_at FROM reviews WHERE id = $1 AND organization_id = $2',
    [REVIEW, ORG],
  )
  return result.rows[0]?.first_fetched_at ?? null
}

async function assertServedText(text: string): Promise<void> {
  expect(await repo.findById(REVIEW, ORG)).toMatchObject({ text, rating: 4 })
  expect(await eligible.getReviewSnippetById(REVIEW, ORG)).toMatchObject({
    status: 'available',
    snippet: { text },
  })
  const result = await pool().query<{ text: string }>(
    'SELECT text FROM review_source_contents WHERE review_id = $1',
    [REVIEW],
  )
  expect(result.rows).toEqual([{ text }])
}

describe.sequential('provider content writes and serving', () => {
  it('ingests and edits content in its source row', async () => {
    const ingested = await repo.upsert(observation(), NOW)
    expect(ingested.text).toBe(ORIGINAL)
    await assertServedText(ORIGINAL)
    expect(await firstFetchHistory()).toEqual(NOW)

    const editedAt = new Date(NOW.getTime() + DAY)
    const edited = await repo.upsert(
      observation(EDITED, {
        sourceUpdatedAt: editedAt,
        lastFetchedAt: editedAt,
        contentExpiresAt: new Date(editedAt.getTime() + 30 * DAY),
        expiresAt: new Date(editedAt.getTime() + 30 * DAY),
        analysisSequence: 2,
      }),
      editedAt,
    )

    expect(edited.sourceRevision).toBe(ingested.sourceRevision + 1)
    await assertServedText(EDITED)
    expect(await firstFetchHistory()).toEqual(NOW)
    const history = await pool().query<{ original_text: string | null }>(
      `SELECT original_text FROM review_source_observations
       WHERE review_id = $1 ORDER BY observation_sequence`,
      [REVIEW],
    )
    expect(history.rows.map((row) => row.original_text)).toEqual([null, null])
  })

  it('keeps a provider restatement at the same revision and renews only its source clock', async () => {
    const ingested = await repo.upsert(observation(), NOW, 'a'.repeat(64))
    const fetchedAt = new Date(NOW.getTime() + DAY)
    const renewedUntil = new Date(fetchedAt.getTime() + 30 * DAY)
    const restated = await repo.upsert(
      observation('The room was clean. It was quiet.', {
        lastFetchedAt: fetchedAt,
        contentExpiresAt: renewedUntil,
        expiresAt: renewedUntil,
      }),
      fetchedAt,
    )
    expect(restated.sourceRevision).toBe(ingested.sourceRevision)
    expect(restated.lastFetchedAt).toEqual(fetchedAt)
    expect(restated.contentExpiresAt).toEqual(renewedUntil)
    await assertServedText('The room was clean. It was quiet.')
    expect(await firstFetchHistory()).toEqual(NOW)

    // Replaying an already recorded provider read is no new fetch authority.
    await repo.upsert(observation(), new Date(NOW.getTime() + 2 * DAY), 'a'.repeat(64))
    const source = await pool().query<{
      last_fetched_at: Date
      content_expires_at: Date
    }>(
      `SELECT last_fetched_at, content_expires_at FROM review_source_contents
       WHERE review_id = $1`,
      [REVIEW],
    )
    expect(source.rows).toEqual([
      { last_fetched_at: fetchedAt, content_expires_at: renewedUntil },
    ])
    expect(await firstFetchHistory()).toEqual(NOW)
  })

  it('retains the first-fetch history after erasure and a later provider reobservation', async () => {
    const ingested = await repo.upsert(observation(), NOW)
    expect(
      await db.transaction((tx) =>
        eraseReviewSourceContent(
          tx,
          {
            reviewId: REVIEW,
            organizationId: ORG,
            propertyId: PROPERTY,
            sourceEpoch: 0,
            expectedSourceRevision: ingested.sourceRevision,
            state: 'source_expired',
          },
          replyScopeEffects,
        ),
      ),
    ).toBe(true)
    expect(await repo.findById(REVIEW, ORG)).toBeNull()
    expect(await firstFetchHistory()).toEqual(NOW)

    const fetchedAt = new Date(NOW.getTime() + 2 * DAY)
    const renewedUntil = new Date(fetchedAt.getTime() + 30 * DAY)
    await repo.upsert(
      observation(ORIGINAL, {
        firstFetchedAt: fetchedAt,
        lastFetchedAt: fetchedAt,
        contentExpiresAt: renewedUntil,
        expiresAt: renewedUntil,
      }),
      fetchedAt,
    )
    await assertServedText(ORIGINAL)
    expect(await firstFetchHistory()).toEqual(NOW)
  })

  it('uses the source expiry across snippets, filters, AI and every stats read', async () => {
    await repo.upsert(observation(), NOW)
    const from = new Date(REVIEWED_AT.getTime() - DAY)
    const to = new Date(NOW.getTime() + DAY)
    expect(await stats.getPeriodStats(ORG, PROPERTY, from, to)).toEqual({
      count: 1,
      avgRating: 4,
    })
    expect(
      await ratings.getRatingSummary(ORG, PROPERTY, {
        mixWindowStart: from,
        mostRecentLimit: 10,
        countSince: [from],
      }),
    ).toMatchObject({ all: { count: 1, sum: 4 } })
    await pool().query(
      'UPDATE review_source_contents SET content_expires_at = $2 WHERE review_id = $1',
      [REVIEW, new Date(NOW.getTime() - DAY)],
    )

    expect(await eligible.getReviewSnippetById(REVIEW, ORG)).toEqual({
      status: 'expired',
    })
    expect((await eligible.getReviewSnippetsByIds([REVIEW], ORG)).size).toBe(0)
    expect(await eligible.getEligibleRatingById(REVIEW, ORG)).toBeNull()
    expect(await repo.findIdsByContentFilter(ORG, { textQuery: 'room' }, NOW)).toEqual([])
    const request = {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      expected: {
        kind: 'analysis' as const,
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 1,
      },
    }
    expect(await repo.readForAi(request)).toEqual({ status: 'expired' })
    expect(await repo.assertCurrentForAi(request)).toEqual({ status: 'expired' })
    expect(await stats.getPeriodStats(ORG, PROPERTY, from, to)).toEqual({
      count: 0,
      avgRating: null,
    })
    expect(
      (await stats.getRatingDistribution(ORG, PROPERTY, from, to)).every(
        (bucket) => bucket.count === 0,
      ),
    ).toBe(true)
    expect(await stats.getRatingTrend(ORG, PROPERTY, from, to)).toEqual([])
    expect(await stats.getReviewVolume(ORG, PROPERTY, from, to)).toEqual([])
    expect(await stats.getReplyPerformance(ORG, PROPERTY, from, to)).toEqual({
      totalReviews: 0,
      repliedCount: 0,
      avgReplyHours: null,
    })
    expect(await stats.getRecentReviews(ORG, PROPERTY, 5)).toEqual([])
    expect(
      await ratings.getRatingSummary(ORG, PROPERTY, {
        mixWindowStart: from,
        mostRecentLimit: 10,
        countSince: [from],
      }),
    ).toMatchObject({ all: { count: 0, sum: 0 }, countsSince: [0] })
    expect(await ratings.getYearlyTotals(ORG, PROPERTY)).toEqual([])
    expect(await ratings.getMonthlyTotals(ORG, PROPERTY, from, 10)).toEqual([])
    expect(await ratings.getDailyCounts(ORG, PROPERTY, from)).toEqual([])
    expect(await ratings.getWeeklyHistory(ORG, PROPERTY, from)).toEqual({
      startAverageThousandths: null,
      weeks: [],
    })
    expect(await ratings.getLowReviews(ORG, PROPERTY, from, 5000, 10)).toEqual([])
    expect(await ratings.getStarDistribution(ORG, PROPERTY, from)).toEqual(
      [1, 2, 3, 4, 5].map((stars) => ({ stars, count: 0 })),
    )
  })
})
