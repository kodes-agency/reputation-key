// Review context — reply repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createReplyRepository } from './reply.repository'
import { createReviewRepository } from './review.repository'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId, replyId } from '#/shared/domain/ids'
import type { Review, Reply } from '../../domain/types'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-rpl-test-aaaa-3333333333333333')
const ORG_B = organizationId('org-rpl-test-bbbb-4444444444444444')
const PROP_A = propertyId('2a000000-0000-0000-0000-000000000001')

let pool: Pool

async function truncateReplies(pool: Pool) {
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
  await truncateReplies(pool)
  await seedOrgs(pool, [ORG_A, ORG_B])
  await seedProperties(pool)
})

const now = new Date('2025-06-01T12:00:00Z')
const reviewedAt = new Date('2025-05-27T12:00:00Z')

async function seedReview(db: ReturnType<typeof getDb>, overrides: Partial<Review> = {}): Promise<Review> {
  const reviewRepo = createReviewRepository(db)
  return reviewRepo.upsert({
    id: reviewId('3a000000-0000-0000-0000-000000000001'),
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'rpl-ext-001',
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
    ...overrides,
  })
}

function makeReply(overrides: Partial<Omit<Reply, 'id'>> & { id?: string } = {}): Reply {
  const idStr = overrides.id ?? '2a000000-0000-0000-0000-000000000001'
  const { id: _ignored, ...rest } = overrides
  return {
    id: replyId(idStr),
    reviewId: reviewId('3a000000-0000-0000-0000-000000000001'),
    organizationId: ORG_A,
    text: 'Thank you!',
    status: 'published',
    source: 'google_sync',
    createdBy: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    ...rest,
  } as Reply
}

describe.sequential('replyRepository (integration)', () => {
  describe('upsert and findByReviewId', () => {
    it('inserts and retrieves a reply', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)
      const reply = makeReply()

      const created = await repo.upsert(reply)
      const found = await repo.findByReviewId(reply.reviewId, ORG_A)

      expect(found).toHaveLength(1)
      expect(found[0].id).toBe(created.id)
      expect(found[0].text).toBe('Thank you!')
    })

    it('returns empty array for review with no replies', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)
      const found = await repo.findByReviewId(reviewId('00000000-0000-0000-0000-000000000999'), ORG_A)
      expect(found).toHaveLength(0)
    })
  })

  describe('findGoogleSyncByReviewId', () => {
    it('finds google_sync reply by review id', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)

      await repo.upsert(makeReply({ source: 'google_sync' }))
      await repo.upsert(makeReply({ id: '2a000000-0000-0000-0000-000000000002', source: 'internal' }))

      const found = await repo.findGoogleSyncByReviewId(reviewId('3a000000-0000-0000-0000-000000000001'), ORG_A)

      expect(found).not.toBeNull()
      expect(found!.source).toBe('google_sync')
    })

    it('returns null when no google_sync reply exists', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)

      await repo.upsert(makeReply({ source: 'internal' }))

      const found = await repo.findGoogleSyncByReviewId(reviewId('3a000000-0000-0000-0000-000000000001'), ORG_A)
      expect(found).toBeNull()
    })
  })

  describe('upsert with conflict resolution', () => {
    it('updates existing reply on conflict (reviewId + source + org)', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)

      const reply = makeReply({ text: 'Original reply' })
      await repo.upsert(reply)

      const updated = await repo.upsert({
        ...reply,
        text: 'Updated reply',
      })

      expect(updated.text).toBe('Updated reply')
      expect(updated.id).toBe(reply.id)
    })
  })

  describe('tenant isolation', () => {
    it('same reviewId, different org → separate replies', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)

      await repo.upsert(makeReply({
        id: '2a000000-0000-0000-0000-000000000001',
        organizationId: ORG_A,
        text: 'Reply from org A',
      }))
      await repo.upsert(makeReply({
        id: '2a000000-0000-0000-0000-000000000002',
        organizationId: ORG_B,
        reviewId: reviewId('3a000000-0000-0000-0000-000000000001'),
        text: 'Reply from org B',
      }))

      const foundA = await repo.findByReviewId(reviewId('3a000000-0000-0000-0000-000000000001'), ORG_A)
      const foundB = await repo.findByReviewId(reviewId('3a000000-0000-0000-0000-000000000001'), ORG_B)

      expect(foundA).toHaveLength(1)
      expect(foundB).toHaveLength(1)
      expect(foundA[0].text).toBe('Reply from org A')
      expect(foundB[0].text).toBe('Reply from org B')
    })
  })

  describe('deleteByReviewIdAndSource', () => {
    it('deletes only matching source', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)

      await repo.upsert(makeReply({ source: 'google_sync' }))
      await repo.upsert(makeReply({ id: '2a000000-0000-0000-0000-000000000002', source: 'internal' }))

      await repo.deleteByReviewIdAndSource(reviewId('3a000000-0000-0000-0000-000000000001'), 'google_sync', ORG_A)

      const remaining = await repo.findByReviewId(reviewId('3a000000-0000-0000-0000-000000000001'), ORG_A)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].source).toBe('internal')
    })
  })

  describe('deleteById', () => {
    it('deletes a reply by id', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)
      const reply = makeReply()

      await repo.upsert(reply)
      await repo.deleteById(reply.id, ORG_A)

      const found = await repo.findByReviewId(reply.reviewId, ORG_A)
      expect(found).toHaveLength(0)
    })
  })

  describe('cross-org delete protection', () => {
    it('deleteById with wrong org does not delete the reply', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)
      const reply = makeReply()

      await repo.upsert(reply)

      // Attempt delete with ORG_B (wrong org)
      await repo.deleteById(reply.id, ORG_B)

      // Reply should still exist for ORG_A
      const found = await repo.findByReviewId(reply.reviewId, ORG_A)
      expect(found).toHaveLength(1)
      expect(found[0].id).toBe(reply.id)
    })

    it('deleteByReviewIdAndSource with wrong org does not delete the reply', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db)

      await repo.upsert(makeReply({ source: 'google_sync' }))

      // Attempt delete with ORG_B (wrong org)
      await repo.deleteByReviewIdAndSource(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        'google_sync',
        ORG_B,
      )

      // Reply should still exist for ORG_A
      const found = await repo.findByReviewId(reviewId('3a000000-0000-0000-0000-000000000001'), ORG_A)
      expect(found).toHaveLength(1)
      expect(found[0].source).toBe('google_sync')
    })
  })
})
