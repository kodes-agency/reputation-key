// Review context — reply repository integration tests
// Per architecture: integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createReplyRepository } from './reply.repository'
import { createPublicationReconciliationCandidateQuery } from './publication-reconciliation-candidate.repository'
import { createReviewRepository } from './review.repository'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, reviewId, replyId } from '#/shared/domain/ids'
import type { Review, Reply } from '../../domain/types'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

const ORG_A = organizationId('org-rpl-test-aaaa-3333333333333333')
const ORG_B = organizationId('org-rpl-test-bbbb-4444444444444444')
const PROP_A = propertyId('2a000000-0000-0000-0000-000000000001')
const PROP_B = propertyId('72b00000-0000-4000-8000-000000000002')

let pool: Pool

async function truncateReplies(pool: Pool) {
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
  const conflictingOrganizations = await pool.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = ANY($1) AND NOT (id = ANY($2))`,
    [slugs, ids],
  )
  await deleteTestOrganizations(
    pool,
    conflictingOrganizations.rows.map(({ id }) => id),
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
    [PROP_B, ORG_B, 'Test Property B', 'test-rpl-prop-b', 'UTC'],
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

async function seedReview(
  db: ReturnType<typeof getDb>,
  overrides: Partial<Review> = {},
): Promise<Review> {
  const reviewRepo = createReviewRepository(db, () => new Date())
  return reviewRepo.upsert({
    id: reviewId('3a000000-0000-0000-0000-000000000001'),
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'rpl-ext-001',
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt,
    expiresAt: new Date(now.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: reviewedAt,
    sourceUpdatedAt: null,
    firstFetchedAt: now,
    lastFetchedAt: now,
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
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
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: null,
    approvedAt: null,
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
      const repo = createReplyRepository(db, () => new Date())
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
      const repo = createReplyRepository(db, () => new Date())
      const found = await repo.findByReviewId(
        reviewId('00000000-0000-0000-0000-000000000999'),
        ORG_A,
      )
      expect(found).toHaveLength(0)
    })
  })

  describe('findMilestonesByReviewIds', () => {
    it('aggregates the earliest timestamps for a tenant in one content-free row per review', async () => {
      const db = getDb()
      const firstReview = await seedReview(db)
      const secondReview = await seedReview(db, {
        id: reviewId('3a000000-0000-0000-0000-000000000002'),
        externalId: 'rpl-ext-002',
      })
      const repo = createReplyRepository(db, () => new Date())
      const earlySubmission = new Date('2025-05-30T09:00:00Z')
      const laterSubmission = new Date('2025-05-31T09:00:00Z')
      const publication = new Date('2025-06-01T09:00:00Z')

      await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000011',
          reviewId: firstReview.id,
          source: 'internal',
          submittedAt: laterSubmission,
          publishedAt: null,
        }),
      )
      await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000012',
          reviewId: firstReview.id,
          source: 'google_sync',
          submittedAt: earlySubmission,
          publishedAt: publication,
        }),
      )
      const milestones = await repo.findMilestonesByReviewIds(
        [firstReview.id, secondReview.id],
        ORG_A,
      )

      expect(milestones).toEqual([
        {
          reviewId: firstReview.id,
          firstSubmittedAt: earlySubmission,
          firstPublishedAt: publication,
        },
      ])
      expect(Object.keys(milestones[0]!)).toEqual([
        'reviewId',
        'firstSubmittedAt',
        'firstPublishedAt',
      ])
      await expect(
        repo.findMilestonesByReviewIds([firstReview.id], ORG_B),
      ).resolves.toEqual([])
    })

    it('does not query for an empty review scope', async () => {
      const repo = createReplyRepository(getDb(), () => new Date())

      await expect(repo.findMilestonesByReviewIds([], ORG_A)).resolves.toEqual([])
    })
  })

  describe('findGoogleSyncByReviewId', () => {
    it('finds google_sync reply by review id', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())

      await repo.upsert(makeReply({ source: 'google_sync' }))
      await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000002',
          source: 'internal',
          status: 'draft',
        }),
      )

      const found = await repo.findGoogleSyncByReviewId(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        ORG_A,
      )

      expect(found).not.toBeNull()
      expect(found!.source).toBe('google_sync')
    })

    it('returns null when no google_sync reply exists', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())

      await repo.upsert(makeReply({ source: 'internal' }))

      const found = await repo.findGoogleSyncByReviewId(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        ORG_A,
      )
      expect(found).toBeNull()
    })
  })

  describe('upsert with conflict resolution', () => {
    it('updates existing reply on conflict (reviewId + source + org)', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())

      const reply = makeReply({ text: 'Original reply' })
      await repo.upsert(reply)

      const updated = await repo.upsert({
        ...reply,
        text: 'Updated reply',
      })

      expect(updated.text).toBe('Updated reply')
      expect(updated.id).toBe(reply.id)
    })

    it('increments the durable state revision on every internal reply update', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())
      const reply = makeReply({ text: 'Original reply', source: 'internal' })

      const created = await repo.upsert(reply)
      const updated = await repo.upsert({ ...reply, text: 'Updated reply' })

      expect(created.stateRevision).toBe(1)
      expect(updated.stateRevision).toBe(2)
    })
  })

  describe('publication reconciliation scheduling', () => {
    it('finds pending observations and advances only the exact due cycle', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())
      const candidates = createPublicationReconciliationCandidateQuery(db)
      const currentDueAt = new Date(now.getTime() - 60 * 1000)
      const nextDueAt = new Date(now.getTime() + 60 * 1000)
      const pending = await repo.upsert(
        makeReply({
          source: 'internal',
          status: 'approved',
          publicationState: 'pending_observation',
          publicationCycle: 2,
          publicationAttempts: 1,
          publicationLastErrorClass: null,
          reconcileDueAt: currentDueAt,
          publishedAt: null,
        }),
      )

      await expect(
        repo.findDuePublicationReconciliationBatch(now, null, 10),
      ).resolves.toEqual([
        expect.objectContaining({
          id: pending.id,
          publicationState: 'pending_observation',
          reconcileDueAt: currentDueAt,
        }),
      ])
      // The operator's explicit --all-ambiguous contract must not be widened
      // by the automatic sweep's inclusion of provider-pending rows.
      await expect(
        candidates.findAmbiguousCandidates({
          dueThrough: now,
          after: null,
          limit: 10,
        }),
      ).resolves.toEqual([])
      await expect(
        repo.deferPublicationReconciliation({
          replyId: pending.id,
          organizationId: ORG_A,
          publicationCycle: 2,
          publicationState: 'pending_observation',
          currentDueAt,
          nextDueAt,
          updatedAt: now,
        }),
      ).resolves.toBe(true)
      await expect(
        repo.findDuePublicationReconciliationBatch(now, null, 10),
      ).resolves.toEqual([])

      await expect(
        repo.deferPublicationReconciliation({
          replyId: pending.id,
          organizationId: ORG_A,
          publicationCycle: 1,
          publicationState: 'pending_observation',
          currentDueAt,
          nextDueAt: new Date(now.getTime() + 2 * 60 * 1000),
          updatedAt: now,
        }),
      ).resolves.toBe(false)
      await expect(repo.findById(pending.id, ORG_A)).resolves.toEqual(
        expect.objectContaining({ reconcileDueAt: nextDueAt, publicationCycle: 2 }),
      )
    })

    it('preserves millisecond CAS and keyset progress for due ambiguous rows', async () => {
      const db = getDb()
      const firstReview = await seedReview(db)
      const secondReview = await seedReview(db, {
        id: reviewId('3a000000-0000-0000-0000-000000000002'),
        externalId: 'rpl-ext-002',
      })
      const repo = createReplyRepository(db, () => new Date())
      const candidates = createPublicationReconciliationCandidateQuery(db)
      const first = await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000011',
          reviewId: firstReview.id,
          source: 'internal',
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationCycle: 2,
          publicationAttempts: 1,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date('2025-06-01T11:58:00.123Z'),
          publishedAt: null,
        }),
      )
      const second = await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000012',
          reviewId: secondReview.id,
          source: 'internal',
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationCycle: 3,
          publicationAttempts: 1,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date('2025-06-01T11:58:00.456Z'),
          publishedAt: null,
        }),
      )

      // A provider deadline can arrive with PostgreSQL microsecond precision.
      // The column contract must normalize it to the JavaScript Date scale so
      // the value returned by a page remains valid for both its next cursor
      // and the exact compare-and-swap deferral predicate.
      await pool.query(
        `UPDATE replies
         SET reconcile_due_at = TIMESTAMPTZ '2025-06-01 11:58:00.123456+00'
         WHERE id = $1 AND organization_id = $2`,
        [first.id, ORG_A],
      )

      const firstPage = await candidates.findAmbiguousCandidates({
        dueThrough: now,
        after: null,
        limit: 1,
      })
      expect(firstPage).toHaveLength(1)
      expect(firstPage[0]).toEqual({
        replyId: first.id,
        organizationId: ORG_A,
        publicationState: 'ambiguous',
        reconcileDueAt: new Date('2025-06-01T11:58:00.123Z'),
      })
      expect(firstPage[0]).not.toHaveProperty('text')

      const secondPage = await candidates.findAmbiguousCandidates({
        dueThrough: now,
        after: {
          reconcileDueAt: firstPage[0]!.reconcileDueAt!,
          replyId: firstPage[0]!.replyId,
        },
        limit: 1,
      })
      expect(secondPage).toEqual([expect.objectContaining({ replyId: second.id })])

      const nextDueAt = new Date('2025-06-01T12:05:00.789Z')
      await expect(
        repo.deferPublicationReconciliation({
          replyId: first.id,
          organizationId: ORG_A,
          publicationCycle: 2,
          publicationState: 'ambiguous',
          currentDueAt: firstPage[0]!.reconcileDueAt!,
          nextDueAt,
          updatedAt: now,
        }),
      ).resolves.toBe(true)
      await expect(repo.findById(first.id, ORG_A)).resolves.toEqual(
        expect.objectContaining({ reconcileDueAt: nextDueAt }),
      )
    })
  })

  describe('tenant isolation', () => {
    it('keeps replies isolated across tenant-owned reviews', async () => {
      const db = getDb()
      const reviewA = await seedReview(db)
      const reviewB = await seedReview(db, {
        id: reviewId('3b000000-0000-0000-0000-000000000002'),
        organizationId: ORG_B,
        propertyId: PROP_B,
        externalId: 'rpl-ext-tenant-b',
      })
      const repo = createReplyRepository(db, () => new Date())

      await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000001',
          reviewId: reviewA.id,
          organizationId: ORG_A,
          text: 'Reply from org A',
        }),
      )
      await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000002',
          organizationId: ORG_B,
          reviewId: reviewB.id,
          text: 'Reply from org B',
          status: 'draft',
        }),
      )

      const foundA = await repo.findByReviewId(reviewA.id, ORG_A)
      const foundB = await repo.findByReviewId(reviewB.id, ORG_B)
      const crossTenantA = await repo.findByReviewId(reviewA.id, ORG_B)
      const crossTenantB = await repo.findByReviewId(reviewB.id, ORG_A)

      expect(foundA).toHaveLength(1)
      expect(foundB).toHaveLength(1)
      expect(foundA[0].text).toBe('Reply from org A')
      expect(foundB[0].text).toBe('Reply from org B')
      expect(crossTenantA).toEqual([])
      expect(crossTenantB).toEqual([])
    })
  })

  describe('deleteByReviewIdAndSource', () => {
    it('deletes only matching source', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())

      await repo.upsert(makeReply({ source: 'google_sync' }))
      await repo.upsert(
        makeReply({
          id: '2a000000-0000-0000-0000-000000000002',
          source: 'internal',
          status: 'draft',
        }),
      )

      await repo.deleteByReviewIdAndSource(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        'google_sync',
        ORG_A,
      )

      const remaining = await repo.findByReviewId(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        ORG_A,
      )
      expect(remaining).toHaveLength(1)
      expect(remaining[0].source).toBe('internal')
    })
  })

  describe('deleteById', () => {
    it('deletes a reply by id', async () => {
      const db = getDb()
      await seedReview(db)
      const repo = createReplyRepository(db, () => new Date())
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
      const repo = createReplyRepository(db, () => new Date())
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
      const repo = createReplyRepository(db, () => new Date())

      await repo.upsert(makeReply({ source: 'google_sync' }))

      // Attempt delete with ORG_B (wrong org)
      await repo.deleteByReviewIdAndSource(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        'google_sync',
        ORG_B,
      )

      // Reply should still exist for ORG_A
      const found = await repo.findByReviewId(
        reviewId('3a000000-0000-0000-0000-000000000001'),
        ORG_A,
      )
      expect(found).toHaveLength(1)
      expect(found[0].source).toBe('google_sync')
    })
  })
})
