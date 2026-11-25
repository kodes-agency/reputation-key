import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { seedInboxOrganization } from '#/contexts/reputation/inbox/inbox-database.test-fixtures'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { createReplyRepository } from './reply-repository.server'
import { createReviewRepository } from '../reviews/review-repository.server'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId, reviewId, replyId } from '#/shared/domain/ids'
import type { Review, Reply } from '../domain/review-types'

export const ORG_A = organizationId('org-rpl-test-aaaa-3333333333333333')
export const ORG_B = organizationId('org-rpl-test-bbbb-4444444444444444')
export const PROP_A = propertyId('2a000000-0000-0000-0000-000000000001')
export const PROP_B = propertyId('72b00000-0000-4000-8000-000000000002')

export const now = new Date('2025-06-01T12:00:00Z')
export const reviewedAt = new Date('2025-05-27T12:00:00Z')

async function truncateReplies(pool: Pool) {
  for (const table of ['google_reply_observation_heads', 'google_reply_observations']) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id IN ($1, $2)`, [
      ORG_A,
      ORG_B,
    ])
  }
  await pool.query('DELETE FROM inbox_items WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM replies WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM reviews WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
}

/**
 * Registers the pool lifecycle and the per-test reset for a reply repository
 * suite: both organizations and their properties exist, nothing else does.
 */
export function useReplyRepositoryDatabase(): () => Pool {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 5 })
    const client = await pool.connect()
    client.release()
  })

  afterAll(async () => {
    await truncateReplies(pool)
    await pool.end()
  })

  beforeEach(async () => {
    await truncateReplies(pool)
    await seedInboxOrganization(pool, ORG_A, [PROP_A])
    await seedInboxOrganization(pool, ORG_B, [PROP_B])
  })

  return () => pool
}

export async function seedReview(
  db: ReturnType<typeof getDb>,
  overrides: Partial<Review> = {},
): Promise<Review> {
  const reviewRepo = createReviewRepository(
    db,
    () => new Date(),
    undefined,
    replyScopeEffects,
  )
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
    googleReviewUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt,
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

/**
 * The common arrangement: one review in place and a repository over the real
 * database. Reads nothing ahead of time, so a test may change rows by SQL
 * between a read and a write.
 */
export async function arrangeRepo(
  overrides: Partial<Review> = {},
  clock: () => Date = () => new Date(),
) {
  const db = getDb()
  const review = await seedReview(db, overrides)
  return { db, review, repo: createReplyRepository(db, clock) }
}

/** A review as Google serves it, so its first material revision exists. */
export const servedReview = (n: number) =>
  seedReview(getDb(), {
    id: reviewId(`3a000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`),
    externalId: `rpl-google-${n}`,
    contentExpiresAt: new Date('2027-01-01T00:00:00Z'),
  })

/** What Google shows for a review now: one observation and the head on it. */
export async function observeGoogleReply(
  pool: Pool,
  review: Review,
  seed: Readonly<{
    state: 'live' | 'absent'
    providerUpdatedAt: Date | null
    observedAt: Date
  }>,
): Promise<void> {
  const live = seed.state === 'live'
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO google_reply_observations (
       organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance,
       normalized_text, normalization_version, normalized_digest,
       provider_updated_at, observed_at, content_expires_at
     ) VALUES ($1, $2, $3, 2, $4, $4, $5, $6, 1, $7, $8, $9, 'provider_snapshot', $10,
               $11, 'google-reply-v1', $12, $13, $14, '2027-01-01T00:00:00Z')
     RETURNING id`,
    [
      review.organizationId,
      review.propertyId,
      review.id,
      review.id.replaceAll('-', '').repeat(2),
      review.sourceEpoch,
      review.sourceRevision,
      seed.state,
      live ? 'added' : 'deleted',
      live ? 'external_current_live' : 'absent',
      live ? 'external_or_unknown' : 'none',
      live ? 'Thank you, from Google' : null,
      live ? 'd'.repeat(64) : null,
      seed.providerUpdatedAt,
      seed.observedAt,
    ],
  )
  await pool.query(
    `INSERT INTO google_reply_observation_heads (
       review_id, organization_id, property_id, observation_id,
       observation_revision, source_epoch, material_review_revision, state,
       provenance, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 2, $5, $6, $7, $8, $9, $9)`,
    [
      review.id,
      review.organizationId,
      review.propertyId,
      inserted.rows[0]?.id,
      review.sourceEpoch,
      review.sourceRevision,
      seed.state,
      live ? 'external_or_unknown' : 'none',
      seed.observedAt,
    ],
  )
}

export function makeReply(
  overrides: Partial<Omit<Reply, 'id'>> & { id?: string } = {},
): Reply {
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
