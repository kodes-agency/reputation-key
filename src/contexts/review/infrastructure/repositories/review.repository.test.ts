// Review context — review repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createReviewRepository } from './review.repository'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { Review } from '../../domain/types'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-rev-test-aaaa-1111111111111111')
const ORG_B = organizationId('org-rev-test-bbbb-2222222222222222')
const PROP_A = propertyId('1a000000-0000-0000-0000-000000000001')
const PROP_B = propertyId('1b000000-0000-0000-0000-000000000002')

let pool: Pool

async function truncateReviews(pool: Pool) {
  await pool.query('DELETE FROM replies WHERE organization_id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.query('DELETE FROM reviews WHERE organization_id IN ($1, $2)', [ORG_A, ORG_B])
}

async function seedOrgs(pool: Pool, ids: string[]) {
  // Clean up stale rows that hold our target slugs (from previous test runs with different IDs)
  const slugs = ids.map(id => 't-' + id.replace(/-/g, '').slice(-12))
  await pool.query(
    `DELETE FROM organization WHERE slug = ANY($1) AND NOT (id = ANY($2))`,
    [slugs, ids],
  )
  for (const id of ids) {
    const slug = 't-' + id.replace(/-/g, '').slice(-12)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
      [id, `Test Org ${slug}`, slug],
    )
  }
}

async function seedProperties(pool: Pool) {
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A, ORG_A, 'Test Property A', 'test-prop-a', 'UTC'],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_B, ORG_B, 'Test Property B', 'test-prop-b', 'UTC'],
  )
}

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

function makeReview(overrides: Partial<Omit<Review, 'id'>> & { id?: string } = {}): Review {
  const idStr = overrides.id ?? '1a000000-0000-0000-0000-000000000001'
  const now = new Date('2025-06-01T12:00:00Z')
  const reviewedAt = new Date('2025-05-27T12:00:00Z')
  const { id: _ignored, ...rest } = overrides
  return {
    id: reviewId(idStr),
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'ext-001',
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt,
    expiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    createdAt: now,
    updatedAt: now,
    ...rest,
  } as Review
}

describe.sequential('reviewRepository (integration)', () => {
  describe('upsert and findByExternalId', () => {
    it('inserts and retrieves a review', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
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
      const repo = createReviewRepository(db)
      const found = await repo.findByExternalId('google', 'non-existent', ORG_A)
      expect(found).toBeNull()
    })

    it('updates existing review on upsert', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
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

  describe('tenant isolation', () => {
    it('same externalId, different org → separate reviews', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const sharedExternalId = 'ext-shared'

      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000001',
        organizationId: ORG_A,
        propertyId: PROP_A,
        externalId: sharedExternalId,
        rating: 5,
      }))

      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000002',
        organizationId: ORG_B,
        propertyId: PROP_B,
        externalId: sharedExternalId,
        rating: 1,
      }))

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
      const repo = createReviewRepository(db)

      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000001',
        organizationId: ORG_A,
        externalId: 'ext-secret',
      }))

      const found = await repo.findByExternalId('google', 'ext-secret', ORG_B)
      expect(found).toBeNull()
    })
  })

  describe('findByPropertyId', () => {
    it('returns reviews for a property', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }))
      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }))

      const reviews = await repo.findByPropertyId(PROP_A, ORG_A)
      expect(reviews).toHaveLength(2)
    })

    it('returns empty for property with no reviews', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const reviews = await repo.findByPropertyId(PROP_B, ORG_B)
      expect(reviews).toHaveLength(0)
    })
  })

  describe('findByOrganizationId', () => {
    it('returns all reviews for an organization', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }))
      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }))

      const reviews = await repo.findByOrganizationId(ORG_A)
      expect(reviews).toHaveLength(2)
    })
  })

  describe('findAllExpiringBefore / findAllExpiredBefore', () => {
    it('findAllExpiringBefore returns reviews where expiresAt <= date', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const now = new Date('2025-06-01T12:00:00Z')

      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000001',
        externalId: 'ext-soon',
        expiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days
      }))
      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000002',
        externalId: 'ext-later',
        expiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000), // 20 days
      }))

      const threshold = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
      const expiring = await repo.findAllExpiringBefore(threshold)

      expect(expiring).toHaveLength(1)
      expect(expiring[0].externalId).toBe('ext-soon')
    })

    it('findAllExpiredBefore uses exclusive boundary', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const now = new Date('2025-06-01T12:00:00Z')

      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000001',
        externalId: 'ext-expired',
        expiresAt: new Date(now.getTime() - 1), // 1ms before now
      }))
      await repo.upsert(makeReview({
        id: '1a000000-0000-0000-0000-000000000002',
        externalId: 'ext-active',
        expiresAt: now, // exactly now — should NOT be included (exclusive)
      }))

      const expired = await repo.findAllExpiredBefore(now)

      expect(expired).toHaveLength(1)
      expect(expired[0].externalId).toBe('ext-expired')
    })
  })

  describe('deleteById', () => {
    it('deletes a review by id', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const review = makeReview()

      await repo.upsert(review)
      await repo.deleteById(review.id, ORG_A)

      const found = await repo.findByExternalId('google', review.externalId, ORG_A)
      expect(found).toBeNull()
    })
  })

  describe('deleteByPropertyId', () => {
    it('deletes all reviews for a property', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }))
      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }))

      await repo.deleteByPropertyId(PROP_A, ORG_A)

      const reviews = await repo.findByPropertyId(PROP_A, ORG_A)
      expect(reviews).toHaveLength(0)
    })
  })

  describe('cross-org delete protection', () => {
    it('deleteById with wrong org does not delete the review', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const review = makeReview()

      await repo.upsert(review)

      // Attempt delete with ORG_B (wrong org)
      await repo.deleteById(review.id, ORG_B)

      // Review should still exist for ORG_A
      const found = await repo.findByExternalId('google', review.externalId, ORG_A)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(review.id)
    })

    it('deleteByPropertyId with wrong org does not delete reviews', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }))
      await repo.upsert(makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }))

      // Attempt delete with ORG_B (wrong org)
      await repo.deleteByPropertyId(PROP_A, ORG_B)

      // Reviews should still exist for ORG_A
      const reviews = await repo.findByPropertyId(PROP_A, ORG_A)
      expect(reviews).toHaveLength(2)
    })
  })
})
