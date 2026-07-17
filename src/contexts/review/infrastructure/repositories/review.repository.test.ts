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
  await pool.query('DELETE FROM replies WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM reviews WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
}

async function seedOrgs(pool: Pool, ids: string[]) {
  // Clean up stale rows that hold our target slugs (from previous test runs with different IDs)
  const slugs = ids.map((id) => 't-' + id.replace(/-/g, '').slice(-12))
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

function makeReview(
  overrides: Partial<Omit<Review, 'id'>> & { id?: string } = {},
): Review {
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

  describe('successful-refetch lifecycle persistence (BQC-1.3)', () => {
    const T1 = new Date('2025-06-01T12:00:00Z')
    const T2 = new Date('2025-06-10T12:00:00Z')
    const E1 = new Date('2025-07-01T12:00:00Z')
    const E2 = new Date('2025-07-10T12:00:00Z')

    it('advances fetch clock + hash baseline on an unchanged refetch, preserving firstFetchedAt', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

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
      const repo = createReviewRepository(db)

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

  describe('findRecentEligibleByPropertyId (BQC-1.4 serving read)', () => {
    const T1 = new Date('2025-06-01T12:00:00Z')
    const FUTURE = new Date('2099-01-01T00:00:00Z')

    it('returns only eligible reviews: excludes expired and clock-less rows', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000e1',
          externalId: 'ext-eligible',
          contentExpiresAt: FUTURE,
        } as Partial<Omit<Review, 'id'>>),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000e2',
          externalId: 'ext-expired',
          contentExpiresAt: new Date('2020-01-01T00:00:00Z'),
        } as Partial<Omit<Review, 'id'>>),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000e3',
          externalId: 'ext-clockless',
          contentExpiresAt: null,
        } as unknown as Partial<Omit<Review, 'id'>>),
      )

      const rows = await repo.findRecentEligibleByPropertyId(
        PROP_A,
        ORG_A,
        { limit: 10 },
        T1,
      )
      expect(rows.map((r) => r.externalId)).toEqual(['ext-eligible'])
    })

    it('excludes rows at the exact expiry boundary (strictly future)', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-0000000000e4',
          externalId: 'ext-boundary',
          contentExpiresAt: T1,
        } as Partial<Omit<Review, 'id'>>),
      )

      const rows = await repo.findRecentEligibleByPropertyId(
        PROP_A,
        ORG_A,
        { limit: 10 },
        T1,
      )
      expect(rows).toHaveLength(0)
    })
  })

  describe('findExpiringBatchAcrossTenants keyset batches (BQC-1.5)', () => {
    const NOW = new Date('2025-06-01T12:00:00Z')

    async function seedExpiring(
      repo: ReturnType<typeof createReviewRepository>,
      idSuffix: string,
      expiresAt: Date,
    ) {
      await repo.upsert(
        makeReview({
          id: `1a000000-0000-0000-0000-0000000000${idSuffix}`,
          externalId: `ext-${idSuffix}`,
          contentExpiresAt: expiresAt,
        } as Partial<Omit<Review, 'id'>>),
      )
    }

    it('walks all expiring rows in order with no duplicates or skips', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const threshold = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
      const base = NOW.getTime()
      for (let i = 0; i < 5; i++) {
        await seedExpiring(repo, `b${i}`, new Date(base + (i + 1) * 60 * 1000))
      }

      const seen: string[] = []
      let cursor: { contentExpiresAt: Date; id: string } | null = null
      for (let batch = 0; batch < 10; batch++) {
        const rows = await repo.findExpiringBatchAcrossTenants(threshold, cursor, 2)
        if (rows.length === 0) break
        for (const r of rows) seen.push(r.externalId)
        const last = rows[rows.length - 1]
        cursor = {
          contentExpiresAt: last.contentExpiresAt as Date,
          id: last.id as string,
        }
      }

      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
      expect(seen).toEqual(['ext-b0', 'ext-b1', 'ext-b2', 'ext-b3', 'ext-b4'])
    })

    it('does not re-scan rows inserted behind the cursor mid-walk', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const threshold = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000)
      await seedExpiring(repo, 'c1', new Date(NOW.getTime() + 3 * 60 * 1000))
      await seedExpiring(repo, 'c2', new Date(NOW.getTime() + 4 * 60 * 1000))

      const first = await repo.findExpiringBatchAcrossTenants(threshold, null, 1)
      expect(first).toHaveLength(1)
      const cursor = {
        contentExpiresAt: first[0].contentExpiresAt as Date,
        id: first[0].id as string,
      }

      // Insert a row that sorts BEFORE the cursor — next run will catch it;
      // this run must not reprocess or loop.
      await seedExpiring(repo, 'c0', new Date(NOW.getTime() + 1 * 60 * 1000))

      const rest: string[] = []
      let c: typeof cursor | null = cursor
      for (let batch = 0; batch < 5; batch++) {
        const rows = await repo.findExpiringBatchAcrossTenants(threshold, c, 1)
        if (rows.length === 0) break
        rest.push(rows[0].externalId)
        c = {
          contentExpiresAt: rows[0].contentExpiresAt as Date,
          id: rows[0].id as string,
        }
      }
      expect(rest).toEqual(['ext-c2'])
    })
  })

  describe('tenant isolation', () => {
    it('same externalId, different org → separate reviews', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
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
      const repo = createReviewRepository(db)

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
      const repo = createReviewRepository(db)

      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }),
      )
      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }),
      )

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

      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }),
      )
      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }),
      )

      const reviews = await repo.findByOrganizationId(ORG_A)
      expect(reviews).toHaveLength(2)
    })
  })

  describe('findAllExpiringBeforeAcrossTenants / findAllExpiredBeforeAcrossTenants', () => {
    it('findAllExpiringBeforeAcrossTenants returns reviews where contentExpiresAt <= date', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const now = new Date('2025-06-01T12:00:00Z')

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000001',
          externalId: 'ext-soon',
          contentExpiresAt: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000), // 2 days
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000002',
          externalId: 'ext-later',
          contentExpiresAt: new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000), // 20 days
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000003',
          externalId: 'ext-null-lifecycle',
          contentExpiresAt: null, // pre-BQR-3.1 rows are ignored
        }),
      )

      const threshold = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
      const expiring = await repo.findAllExpiringBeforeAcrossTenants(threshold)

      expect(expiring).toHaveLength(1)
      expect(expiring[0].externalId).toBe('ext-soon')
    })

    it('findAllExpiredBeforeAcrossTenants uses exclusive contentExpiresAt boundary', async () => {
      const db = getDb()
      const repo = createReviewRepository(db)
      const now = new Date('2025-06-01T12:00:00Z')

      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000001',
          externalId: 'ext-expired',
          contentExpiresAt: new Date(now.getTime() - 1), // 1ms before now
        }),
      )
      await repo.upsert(
        makeReview({
          id: '1a000000-0000-0000-0000-000000000002',
          externalId: 'ext-active',
          contentExpiresAt: now, // exactly now — should NOT be included (exclusive)
        }),
      )

      const expired = await repo.findAllExpiredBeforeAcrossTenants(now)

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

      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }),
      )
      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }),
      )

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

      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000001', externalId: 'ext-1' }),
      )
      await repo.upsert(
        makeReview({ id: '1a000000-0000-0000-0000-000000000002', externalId: 'ext-2' }),
      )

      // Attempt delete with ORG_B (wrong org)
      await repo.deleteByPropertyId(PROP_A, ORG_B)

      // Reviews should still exist for ORG_A
      const reviews = await repo.findByPropertyId(PROP_A, ORG_A)
      expect(reviews).toHaveLength(2)
    })
  })
})
