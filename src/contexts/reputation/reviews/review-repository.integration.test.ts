import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import type { Review } from '../domain/review-types'
import {
  ORG_A,
  ORG_B,
  PROP_A,
  PROP_B,
  buildTestReview as makeReview,
  seedOrgs,
  seedProperties,
  truncateReviews,
} from './review.test-fixtures'
import { testReviewRepository } from './review-stores.test-fixtures'
import { getDb } from '#/shared/db'

// Review context — review repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

let pool: Pool

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateReviews(pool)
  await seedOrgs(pool, [ORG_A, ORG_B])
  await seedProperties(pool)
})

/** `count` live Reviews of one Property, newest first by their review date. */
async function seedBulkReviews(count: number) {
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id,
       external_location_id, expires_at, first_fetched_at, source_epoch,
       source_revision, analysis_sequence
     )
     SELECT gen_random_uuid(), $1, $2, 'google', 'bulk-' || n, 'locations/bulk',
            NOW() + INTERVAL '25 days', NOW(), 0, 0, 0
     FROM generate_series(1, $3::int) AS n`,
    [ORG_A, PROP_A, count],
  )
  await pool.query(
    `INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, reviewer_name, rating, text, reviewed_at,
       first_fetched_at, last_fetched_at, content_expires_at, source_epoch,
       source_revision, ai_source_byte_length, ai_source_digest
     )
     SELECT id, organization_id, property_id, platform, external_id,
            external_location_id, 'Jane Doe', 5, 'A live review',
            NOW() - (substring(external_id from 6)::int * INTERVAL '1 minute'),
            first_fetched_at, NOW(), NOW() + INTERVAL '30 days', source_epoch,
            source_revision, 1, repeat('0', 64)
     FROM reviews
     WHERE organization_id = $1 AND external_id ~ '^bulk-[0-9]+$'`,
    [ORG_A],
  )
}

describe.sequential('reviewRepository (integration)', () => {
  describe('upsert and findByExternalId', () => {
    it('inserts and retrieves a review', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const review = makeReview()

      const created = await repo.upsert(review)
      const found = await repo.findByExternalId('google', review.externalId, ORG_A)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.rating).toBe(5)
      expect(found!.organizationId).toBe(ORG_A)
    })

    it('returns null for non-existent review', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const found = await repo.findByExternalId('google', 'non-existent', ORG_A)
      expect(found).toBeNull()
    })

    it('updates existing review on upsert', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const review = makeReview({ rating: 5 })

      await repo.upsert(review)

      const updated = await repo.upsert({
        ...review,
        rating: 3,
        text: 'Changed my mind',
      })

      expect(updated.rating).toBe(3)
      expect(updated.text).toBe('Changed my mind')
      expect(updated.id).toBe(review.id) // Same ID
    })
  })

  describe('successful-refetch lifecycle persistence (BQC-1.3)', () => {
    const T1 = new Date('2025-06-01T12:00:00Z')
    const T2 = new Date('2025-06-10T12:00:00Z')
    const E1 = new Date('2025-07-01T12:00:00Z')
    const E2 = new Date('2025-07-10T12:00:00Z')

    it('advances fetch clock + hash baseline on an unchanged refetch, preserving firstFetchedAt', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)

      await repo.upsert(
        makeReview({
          rating: 5,
          text: 'Great place!',
          firstFetchedAt: T1,
          lastFetchedAt: T1,
          contentExpiresAt: E1,
          contentHash: 'hash-v1',
          sourceCreatedAt: new Date('2025-05-27T12:00:00Z'),
          sourceUpdatedAt: null,
        } as Partial<Omit<Review, 'id'>>),
      )

      // Unchanged successful refetch 9 days later: same content/hash, newer clock.
      await repo.upsert(
        makeReview({
          rating: 5,
          text: 'Great place!',
          firstFetchedAt: T1,
          lastFetchedAt: T2,
          contentExpiresAt: E2,
          contentHash: 'hash-v1',
          sourceCreatedAt: new Date('2025-05-27T12:00:00Z'),
          sourceUpdatedAt: null,
        } as Partial<Omit<Review, 'id'>>),
      )

      const found = await repo.findByExternalId('google', 'ext-001', ORG_A)
      expect(found).not.toBeNull()
      expect(found!.lastFetchedAt).toEqual(T2)
      expect(found!.contentExpiresAt).toEqual(E2)
      expect(found!.contentHash).toBe('hash-v1')
      expect(found!.firstFetchedAt).toEqual(T1)
    })

    it('advances the clock and updates content + baseline on a changed refetch', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)

      await repo.upsert(
        makeReview({
          rating: 5,
          text: 'Great place!',
          firstFetchedAt: T1,
          lastFetchedAt: T1,
          contentExpiresAt: E1,
          contentHash: 'hash-v1',
        } as Partial<Omit<Review, 'id'>>),
      )

      await repo.upsert(
        makeReview({
          rating: 2,
          text: 'Changed my mind',
          firstFetchedAt: T1,
          lastFetchedAt: T2,
          contentExpiresAt: E2,
          contentHash: 'hash-v2',
        } as Partial<Omit<Review, 'id'>>),
      )

      const found = await repo.findByExternalId('google', 'ext-001', ORG_A)
      expect(found).not.toBeNull()
      expect(found!.rating).toBe(2)
      expect(found!.text).toBe('Changed my mind')
      expect(found!.contentHash).toBe('hash-v2')
      expect(found!.lastFetchedAt).toEqual(T2)
      expect(found!.contentExpiresAt).toEqual(E2)
      expect(found!.firstFetchedAt).toEqual(T1)
    })
  })

  describe('findIdsByContentFilter', () => {
    it('returns the complete match set for organizations with more than 1,000 reviews', async () => {
      await pool.query(
        `INSERT INTO reviews (
           id, organization_id, property_id, platform, external_id,
           external_location_id, expires_at, first_fetched_at, source_epoch,
           source_revision, analysis_sequence
         )
         SELECT
           ('1c000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
           $1, $2, 'google', 'bulk-filter-' || series,
           $3, NOW() + INTERVAL '30 days', NOW(), 0, 0, 0
         FROM generate_series(1, 1001) AS series`,
        [ORG_A, PROP_A, GOOGLE_LOCATION_PRIMARY_RESOURCE],
      )
      await pool.query(
        `INSERT INTO review_source_contents (
           review_id, organization_id, property_id, platform, external_id,
           external_location_id, rating, text, reviewed_at, first_fetched_at,
           last_fetched_at, content_expires_at, source_epoch, source_revision,
           ai_source_byte_length, ai_source_digest
         )
         SELECT id, organization_id, property_id, platform, external_id,
                external_location_id, 5, 'Complete filter match', NOW(),
                first_fetched_at, NOW(), expires_at, source_epoch, source_revision,
                1, repeat('0', 64)
         FROM reviews
         WHERE organization_id = $1 AND external_id LIKE 'bulk-filter-%'`,
        [ORG_A],
      )

      const ids = await testReviewRepository(getDb()).findIdsByContentFilter(
        ORG_A,
        { ratingMin: 5, textQuery: 'complete filter' },
        new Date(),
      )

      expect(ids).toHaveLength(1001)
    })
  })

  describe('tenant isolation', () => {
    it('same externalId, different org → separate reviews', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const sharedExternalId = 'ext-shared'

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000001',
          organizationId: ORG_A,
          propertyId: PROP_A,
          externalId: sharedExternalId,
          rating: 5,
        }),
      )

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000002',
          organizationId: ORG_B,
          propertyId: PROP_B,
          externalId: sharedExternalId,
          rating: 1,
        }),
      )

      const foundA = await repo.findByExternalId('google', sharedExternalId, ORG_A)
      const foundB = await repo.findByExternalId('google', sharedExternalId, ORG_B)

      expect(foundA).not.toBeNull()
      expect(foundB).not.toBeNull()
      expect(foundA!.rating).toBe(5)
      expect(foundB!.rating).toBe(1)
      expect(foundA!.id).not.toBe(foundB!.id)
    })

    it('findByExternalId does not leak across orgs', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000001',
          organizationId: ORG_A,
          externalId: 'ext-secret',
        }),
      )

      const found = await repo.findByExternalId('google', 'ext-secret', ORG_B)
      expect(found).toBeNull()
    })
  })

  describe('findByPropertyId', () => {
    it('returns reviews for a property', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)

      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }),
      )
      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }),
      )

      const reviews = await repo.findByPropertyId(PROP_A, ORG_A)
      expect(reviews).toHaveLength(2)
    })

    it('returns every review of the Property, past the per-request page size', async () => {
      // The Inbox repair command reads "all review sources"; a silent cap at 500
      // made a repair of a larger Property look complete (S14-04).
      const repo = testReviewRepository(getDb())
      await seedBulkReviews(501)

      const reviews = await repo.findByPropertyId(PROP_A, ORG_A)

      expect(reviews).toHaveLength(501)
      expect(reviews[0]?.externalId).toBe('bulk-1')
    })

    it('still honours an explicit limit, newest first', async () => {
      const repo = testReviewRepository(getDb())
      await seedBulkReviews(5)

      const reviews = await repo.findByPropertyId(PROP_A, ORG_A, { limit: 2 })

      expect(reviews.map((review) => review.externalId)).toEqual(['bulk-1', 'bulk-2'])
    })

    it('returns empty for property with no reviews', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)
      const reviews = await repo.findByPropertyId(PROP_B, ORG_B)
      expect(reviews).toHaveLength(0)
    })
  })

  describe('findByOrganizationId', () => {
    it('returns all reviews for an organization', async () => {
      const db = getDb()
      const repo = testReviewRepository(db)

      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }),
      )
      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }),
      )

      const reviews = await repo.findByOrganizationId(ORG_A)
      expect(reviews).toHaveLength(2)
    })

    it('returns every review of the organization, past the per-request page size', async () => {
      const repo = testReviewRepository(getDb())
      await seedBulkReviews(501)

      const reviews = await repo.findByOrganizationId(ORG_A)

      expect(reviews).toHaveLength(501)
      expect(new Set(reviews.map((review) => review.id)).size).toBe(501)
    })

    it('returns the reviews of the organization in id order', async () => {
      const repo = testReviewRepository(getDb())
      await seedBulkReviews(40)

      const ids = (await repo.findByOrganizationId(ORG_A)).map((review) => review.id)

      expect(ids).toEqual([...ids].sort())
    })
  })

  describe('stable identity lifecycle surface', () => {
    it('does not expose destructive Review deletion entry points', () => {
      const repo = testReviewRepository(getDb())

      expect(repo).not.toHaveProperty('deleteById')
      expect(repo).not.toHaveProperty('deleteByPropertyId')
    })
  })
})
