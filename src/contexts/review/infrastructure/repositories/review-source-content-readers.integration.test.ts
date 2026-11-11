// Review context — every reader that serves provider content reads it from the
// erasable content row (`review_source_contents`), not from the copy that
// `reviews` still carries. Real PostgreSQL.
//
// Each case plants a different value in the `reviews` copy and checks the
// reader answers with the content row's, then moves the content clock or erases
// the content and checks nothing is served.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { insertLiveReview } from '#/shared/testing/review-tombstone-fixtures'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createEligibleReads } from '../../application/eligible-reads'
import { createServingStats } from '../serving-stats'
import { eraseReviewSourceContent } from '#/contexts/reputation/application/public-api'
import { createReviewRepository } from './review.repository'

const ORG = organizationId('org-review-content-readers-1111111111')
const PROPERTY = propertyId('7e200000-0000-4000-8000-000000000001')
const REVIEW = reviewId('7e200000-0000-4000-8000-0000000000a1')
const EXTERNAL_ID = 'content-readers-a1'

const READ_AT = new Date('2026-10-14T09:00:00.000Z')
const CLOCK_STILL_RUNNING = new Date('2026-11-01T09:00:00.000Z')
const CLOCK_LAPSED = new Date('2026-10-14T08:00:00.000Z')

const CONTENT_TEXT = 'The content row says the pool was warm'

let pool: Pool
const db = getDb()
const repo = createReviewRepository(db, () => READ_AT, undefined, replyScopeEffects)
const eligible = createEligibleReads({ reviewRepo: repo, clock: () => READ_AT })
const stats = createServingStats({ db, clock: () => READ_AT })

async function clean(): Promise<void> {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

async function seedReview(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Content readers', $2, NOW())`,
    [ORG, `content-readers-${process.pid}`],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Content readers property', $3, 'UTC', NOW(), NOW())`,
    [PROPERTY, ORG, `content-readers-property-${process.pid}`],
  )
  await insertLiveReview(pool, {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    externalId: EXTERNAL_ID,
    contentExpiresAt: CLOCK_STILL_RUNNING,
    reviewedAt: new Date('2026-10-10T09:00:00.000Z'),
    lastFetchedAt: new Date('2026-10-12T09:00:00.000Z'),
    rating: 4,
    text: CONTENT_TEXT,
  })
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await clean()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seedReview()
})

describe('readers of provider content', () => {
  it('whole-row reads return the content row text, rating and reviewer', async () => {
    const byId = await repo.findById(REVIEW, ORG)
    const byIds = await repo.findByIds([REVIEW], ORG)
    const byProperty = await repo.findByPropertyId(PROPERTY, ORG)
    const byOrganization = await repo.findByOrganizationId(ORG)
    const byExternalId = await repo.findByExternalId('google', EXTERNAL_ID, ORG)

    for (const review of [
      byId,
      byIds[0],
      byProperty[0],
      byOrganization[0],
      byExternalId,
    ]) {
      expect(review).toMatchObject({
        text: CONTENT_TEXT,
        rating: 4,
        reviewerName: 'Jane Doe',
      })
    }
  })

  it('the eligible snippet carries the content row text', async () => {
    const one = await eligible.getReviewSnippetById(REVIEW, ORG)
    const many = await eligible.getReviewSnippetsByIds([REVIEW], ORG)

    expect(one).toMatchObject({ status: 'available', snippet: { text: CONTENT_TEXT } })
    expect(many.get(REVIEW)?.text).toBe(CONTENT_TEXT)
    expect(await eligible.getEligibleRatingById(REVIEW, ORG)).toBe(4)
  })

  it('text and rating search match the content row, not the reviews copy', async () => {
    const find = (filter: Parameters<typeof repo.findIdsByContentFilter>[1]) =>
      repo.findIdsByContentFilter(ORG, filter, READ_AT)

    expect(await find({ textQuery: 'pool was warm' })).toEqual([REVIEW])
    expect(await find({ textQuery: 'something else entirely' })).toEqual([])
    expect(await find({ ratingMin: 4, ratingMax: 4 })).toEqual([REVIEW])
    expect(await find({ ratingMax: 1 })).toEqual([])
  })

  it('recent-review text is the content row text', async () => {
    const recent = await stats.getRecentReviews(ORG, PROPERTY, 5)

    expect(recent.map((review) => review.text)).toEqual([CONTENT_TEXT])
  })

  it('serves nothing once the content clock has lapsed', async () => {
    await pool.query(
      `UPDATE review_source_contents SET content_expires_at = $2 WHERE review_id = $1`,
      [REVIEW, CLOCK_LAPSED],
    )

    expect(await eligible.getReviewSnippetById(REVIEW, ORG)).toEqual({
      status: 'expired',
    })
    expect((await eligible.getReviewSnippetsByIds([REVIEW], ORG)).size).toBe(0)
    expect(await eligible.getEligibleRatingById(REVIEW, ORG)).toBeNull()
    expect(
      await repo.findIdsByContentFilter(ORG, { textQuery: 'pool' }, READ_AT),
    ).toEqual([])
    expect(await stats.getRecentReviews(ORG, PROPERTY, 5)).toEqual([])
  })

  it('serves nothing after the content is erased, and a review without a content row reads as absent', async () => {
    const erased = await db.transaction((tx) =>
      eraseReviewSourceContent(
        tx,
        {
          reviewId: REVIEW,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceEpoch: 0,
          expectedSourceRevision: 0,
          state: 'source_expired',
        },
        replyScopeEffects,
      ),
    )
    expect(erased).toBe(true)

    expect(await repo.findById(REVIEW, ORG)).toBeNull()
    expect(await repo.findByPropertyId(PROPERTY, ORG)).toEqual([])
    expect(
      await repo.findIdsByContentFilter(ORG, { textQuery: 'pool' }, READ_AT),
    ).toEqual([])
    expect(await stats.getRecentReviews(ORG, PROPERTY, 5)).toEqual([])
  })

  it('a review whose content row is missing is not read', async () => {
    await pool.query('DELETE FROM review_source_contents WHERE review_id = $1', [REVIEW])

    expect(await repo.findById(REVIEW, ORG)).toBeNull()
    expect(await repo.findByOrganizationId(ORG)).toEqual([])
    expect(await stats.getRecentReviews(ORG, PROPERTY, 5)).toEqual([])
  })
})
