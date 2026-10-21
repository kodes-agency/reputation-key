// Review context — head check repository integration tests (real PostgreSQL).
//
// The baseline a dark head check compares Google's newest page with: the stored
// copies of the page's reviews with their reply heads, the live count and mean
// rating of the Property's current epoch, and the one history row it writes.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { sha256Hex } from '#/shared/domain/sha256'
import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import type { Review } from '../../domain/types'
import type { HeadComparison } from '../../domain/head-check'
import type { RecordGoogleReplyObservation } from '../../application/ports/google-reply-observation-store.port'
import { createGoogleReplyObservationStore } from '../google-reply-observation-store'
import { createReviewRepository } from './review.repository'
import { createReviewHeadCheckRepository } from './review-head-check.repository'

const ORG = organizationId('org-head-check-repo')
const OTHER_ORG = organizationId('org-head-check-other')
const PROP_A = propertyId('a2000000-0000-4000-8000-000000000001')
const PROP_B = propertyId('a2000000-0000-4000-8000-000000000002')
const PROP_OTHER_ORG = propertyId('a2000000-0000-4000-8000-000000000003')
const NOW = new Date('2026-10-21T12:00:00.000Z')
const EXPIRES = new Date('2026-11-20T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW.getTime() - ms)

let pool: Pool
let lease: TestLease
let nextReview = 0
let nextGeneration = 0
const db = getDb()

const reviewUuid = (n: number) => `b2000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeReview(
  externalId: string,
  over: Partial<Review> & { org?: typeof ORG; property?: typeof PROP_A } = {},
): Omit<Review, 'createdAt' | 'updatedAt'> {
  const { org, property, ...rest } = over
  nextReview++
  return {
    id: reviewId(reviewUuid(nextReview)),
    organizationId: org ?? ORG,
    propertyId: property ?? PROP_A,
    platform: 'google',
    externalId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Head check guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 5,
    text: 'Material review text',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: EXPIRES,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: ago(10 * DAY_MS),
    sourceUpdatedAt: ago(3 * DAY_MS),
    firstFetchedAt: ago(10 * DAY_MS),
    lastFetchedAt: ago(1 * DAY_MS),
    contentExpiresAt: EXPIRES,
    contentHash: null,
    sourceSeenGeneration: 'a2000000-0000-4000-8000-000000000100',
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    ...rest,
  }
}

async function seed(
  externalId: string,
  over: Parameters<typeof makeReview>[1] = {},
): Promise<Review> {
  return createReviewRepository(db, () => NOW).upsert(
    makeReview(externalId, over),
    NOW,
    sha256Hex(`head-check-seed:${externalId}:${over.org ?? ORG}:${nextReview}`),
  )
}

async function recordReply(
  review: Review,
  observedText: string | null,
  providerUpdatedAt: Date | null,
): Promise<void> {
  const input: RecordGoogleReplyObservation = {
    organizationId: review.organizationId,
    propertyId: review.propertyId,
    reviewId: review.id,
    sourceEpoch: review.sourceEpoch,
    materialReviewRevision: review.sourceRevision,
    readGeneration: ++nextGeneration,
    observationKey: sha256Hex(`head-check-reply:${review.id}`),
    source: 'provider_snapshot',
    observedText,
    providerUpdatedAt,
    observedAt: NOW,
    contentExpiresAt: EXPIRES,
  }
  await createGoogleReplyObservationStore(db).record(input)
}

async function resetFixture(): Promise<void> {
  nextReview = 0
  nextGeneration = 0
  await pool.query(
    'TRUNCATE google_reply_observation_heads, google_reply_observations CASCADE',
  )
  for (const org of [ORG, OTHER_ORG]) {
    await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [org])
    await pool.query('DELETE FROM reviews WHERE organization_id = $1', [org])
    await pool.query('DELETE FROM properties WHERE organization_id = $1', [org])
  }
  await pool.query('DELETE FROM review_sync_state WHERE property_id = ANY($1)', [
    [PROP_A, PROP_B, PROP_OTHER_ORG],
  ])
  await pool.query('DELETE FROM review_sync_runs WHERE property_id = ANY($1)', [
    [PROP_A, PROP_B, PROP_OTHER_ORG],
  ])
  await deleteTestOrganizations(pool, [ORG, OTHER_ORG])
  for (const [org, slug] of [
    [ORG, 'head-check-repo'],
    [OTHER_ORG, 'head-check-other'],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $3, NOW())`,
      [org, `Head check ${slug}`, slug],
    )
  }
  for (const [id, org, slug, epoch] of [
    [PROP_A, ORG, 'head-a', 2],
    [PROP_B, ORG, 'head-b', 0],
    [PROP_OTHER_ORG, OTHER_ORG, 'head-c', 0],
  ] as const) {
    await pool.query(
      `INSERT INTO properties
        (id, organization_id, name, slug, timezone, source_epoch, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', $5, NOW(), NOW())`,
      [id, org, `Head ${slug}`, slug, epoch],
    )
  }
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  pool = lease.pool
  clearEventSchemas()
  registerAllEventSchemas()
})

beforeEach(resetFixture)

afterAll(async () => {
  await resetFixture()
  await deleteTestOrganizations(pool, [ORG, OTHER_ORG])
  clearEventSchemas()
  await lease.release()
})

describe.sequential('reviewHeadCheckRepository.readBaseline (real PostgreSQL)', () => {
  const repo = createReviewHeadCheckRepository(db)
  const baseline = (externalIds: readonly string[], property = PROP_A, epoch = 2) =>
    repo.readBaseline({
      organizationId: ORG,
      propertyId: property,
      sourceEpoch: epoch,
      externalIds,
    })

  it('returns the stored copy of each requested review with its clocks and epoch', async () => {
    await seed('ext-1', { sourceEpoch: 2, sourceUpdatedAt: ago(3 * DAY_MS) })
    await seed('ext-2', { sourceEpoch: 2, lastFetchedAt: ago(6 * DAY_MS) })
    await seed('ext-3', { sourceEpoch: 2 })

    const result = await baseline(['ext-1', 'ext-2', 'ext-unknown'])

    expect(result.copies).toHaveLength(2)
    expect(result.copies).toContainEqual({
      externalId: 'ext-1',
      sourceEpoch: 2,
      sourceUpdatedAt: ago(3 * DAY_MS),
      lastFetchedAt: ago(1 * DAY_MS),
      reply: null,
    })
    expect(result.copies.find((c) => c.externalId === 'ext-2')?.lastFetchedAt).toEqual(
      ago(6 * DAY_MS),
    )
  })

  it('carries a stored copy of an older source epoch as it is', async () => {
    await seed('ext-old-epoch', { sourceEpoch: 1 })

    const result = await baseline(['ext-old-epoch'])

    expect(result.copies).toEqual([
      expect.objectContaining({ externalId: 'ext-old-epoch', sourceEpoch: 1 }),
    ])
  })

  it('reads the reply head: live with its provider updateTime, absent, or none', async () => {
    const withReply = await seed('ext-live-reply', { sourceEpoch: 2 })
    const withoutReply = await seed('ext-absent-reply', { sourceEpoch: 2 })
    await seed('ext-no-head', { sourceEpoch: 2 })
    await recordReply(withReply, 'Thank you for staying', ago(2 * DAY_MS))
    await recordReply(withoutReply, null, null)

    const result = await baseline(['ext-live-reply', 'ext-absent-reply', 'ext-no-head'])

    const reply = (id: string) => result.copies.find((c) => c.externalId === id)?.reply
    expect(reply('ext-live-reply')).toEqual({
      state: 'live',
      providerUpdatedAt: ago(2 * DAY_MS),
    })
    expect(reply('ext-absent-reply')).toEqual({
      state: 'absent',
      providerUpdatedAt: null,
    })
    expect(reply('ext-no-head')).toBeNull()
  })

  it('counts the live reviews of the current epoch only, with their mean rating', async () => {
    await seed('ext-a1', { sourceEpoch: 2, rating: 5 })
    await seed('ext-a2', { sourceEpoch: 2, rating: 4 })
    await seed('ext-a3', { sourceEpoch: 2, rating: 3 })
    await seed('ext-old', { sourceEpoch: 1, rating: 1 })
    await seed('ext-other-property', { sourceEpoch: 2, rating: 1, property: PROP_B })
    await seed('ext-other-org', {
      sourceEpoch: 2,
      rating: 1,
      org: OTHER_ORG,
      property: PROP_OTHER_ORG,
    })
    await pool.query(
      `UPDATE reviews SET source_content_state = 'source_expired',
         source_content_erased_at = NOW(), external_id = NULL, external_location_id = NULL,
         google_connection_id = NULL, reviewer_name = NULL, reviewer_profile_photo_url = NULL,
         google_review_url = NULL, rating = NULL, text = NULL, translated_text = NULL,
         language_code = NULL, reviewed_at = NULL, source_created_at = NULL,
         source_updated_at = NULL, content_hash = NULL, ai_source_byte_length = NULL,
         ai_source_digest = NULL
       WHERE organization_id = $1 AND external_id = 'ext-a3'`,
      [ORG],
    )

    const result = await baseline(['ext-a1'])

    expect(result.storedLiveCount).toBe(2)
    expect(result.storedAverageRating).toBe(4.5)
  })

  it('reads a tombstoned review as no copy: its Google id is gone', async () => {
    await seed('ext-gone', { sourceEpoch: 2 })
    await pool.query(
      `UPDATE reviews SET source_content_state = 'provider_deleted',
         source_content_erased_at = NOW(), external_id = NULL, external_location_id = NULL,
         google_connection_id = NULL, reviewer_name = NULL, reviewer_profile_photo_url = NULL,
         google_review_url = NULL, rating = NULL, text = NULL, translated_text = NULL,
         language_code = NULL, reviewed_at = NULL, source_created_at = NULL,
         source_updated_at = NULL, content_hash = NULL, ai_source_byte_length = NULL,
         ai_source_digest = NULL
       WHERE organization_id = $1 AND external_id = 'ext-gone'`,
      [ORG],
    )

    const result = await baseline(['ext-gone'])

    expect(result.copies).toEqual([])
    expect(result.storedLiveCount).toBe(0)
    expect(result.storedAverageRating).toBeNull()
  })

  it('never reads another organization’s or another property’s copy of a review id', async () => {
    await seed('ext-shared-id', { org: OTHER_ORG, property: PROP_OTHER_ORG })
    await seed('ext-b-only', { sourceEpoch: 0, property: PROP_B })

    const result = await baseline(['ext-shared-id', 'ext-b-only'])

    expect(result.copies).toEqual([])
  })

  it('reads no copies for an empty page but still counts the Property’s live reviews', async () => {
    await seed('ext-held', { sourceEpoch: 2, rating: 2 })

    await expect(baseline([])).resolves.toEqual({
      copies: [],
      storedLiveCount: 1,
      storedAverageRating: 2,
    })
  })
})

describe.sequential(
  'reviewHeadCheckRepository.hasOutstandingFailure (real PostgreSQL)',
  () => {
    const repo = createReviewHeadCheckRepository(db)

    it('is false for a Property with no sync state or no recorded failure', async () => {
      await expect(repo.hasOutstandingFailure(PROP_A)).resolves.toBe(false)
      await pool.query(
        `INSERT INTO review_sync_state (property_id, source, next_incremental_at)
       VALUES ($1, 'google', NOW())`,
        [PROP_A],
      )
      await expect(repo.hasOutstandingFailure(PROP_A)).resolves.toBe(false)
    })

    it('is true while an error class is recorded, and only for that Property', async () => {
      await pool.query(
        `INSERT INTO review_sync_state (property_id, source, error_class)
       VALUES ($1, 'google', 'cursor_failure')`,
        [PROP_A],
      )

      await expect(repo.hasOutstandingFailure(PROP_A)).resolves.toBe(true)
      await expect(repo.hasOutstandingFailure(PROP_B)).resolves.toBe(false)
    })
  },
)

describe.sequential('reviewHeadCheckRepository.recordRun (real PostgreSQL)', () => {
  const repo = createReviewHeadCheckRepository(db)
  const STARTED = new Date('2026-10-21T12:00:00.000Z')
  const COMPLETED = new Date('2026-10-21T12:00:01.500Z')
  const comparison: HeadComparison = {
    listed: 50,
    newCount: 2,
    changedCount: 1,
    replyChangedCount: 3,
    leaseRefreshCount: 4,
    wouldPersist: 8,
    googleTotal: 120,
    storedLiveCount: 117,
    totalDifference: 3,
    googleAverage: 4.62,
    storedAverage: 4.6,
    averageDifference: 0.02,
    hasMore: true,
  }
  const rows = async () =>
    (
      await pool.query(
        `SELECT mode, source, source_epoch, started_at, completed_at, page_count,
                review_count, created_count, updated_count, deleted_count, failed_count,
                result, error_class
           FROM review_sync_runs WHERE property_id = $1`,
        [PROP_A],
      )
    ).rows

  it('writes one head_dark row carrying the counts, queryable as JSON', async () => {
    await repo.recordRun({
      propertyId: PROP_A,
      sourceEpoch: 2,
      startedAt: STARTED,
      completedAt: COMPLETED,
      outcome: 'compared',
      comparison,
    })

    const [row, ...rest] = await rows()
    expect(rest).toEqual([])
    expect(row).toMatchObject({
      mode: 'head_dark',
      source: 'google',
      source_epoch: 2,
      started_at: STARTED,
      completed_at: COMPLETED,
      page_count: 1,
      review_count: 50,
      created_count: 2,
      updated_count: 6,
      deleted_count: 0,
      failed_count: 0,
      error_class: null,
    })
    expect(JSON.parse(row.result)).toEqual({
      outcome: 'compared',
      new: 2,
      changed: 1,
      replyChanged: 3,
      leaseRefresh: 4,
      wouldPersist: 8,
      googleTotal: 120,
      storedLive: 117,
      totalDifference: 3,
      googleAverage: 4.62,
      storedAverage: 4.6,
      averageDifference: 0.02,
      hasMore: true,
    })
    const queried = await pool.query(
      `SELECT (result::jsonb)->>'totalDifference' AS diff
         FROM review_sync_runs WHERE mode = 'head_dark' AND property_id = $1`,
      [PROP_A],
    )
    expect(queried.rows[0].diff).toBe('3')
  })

  it.each([
    ['order_violation', 0],
    ['rate_limited', 1],
    ['provider_unavailable', 1],
    ['provider_rejected', 1],
    ['authorization_changed', 1],
    ['malformed_response', 1],
    ['error', 1],
  ] as const)(
    'writes a %s row with its error class and no counts',
    async (outcome, failed) => {
      await repo.recordRun({
        propertyId: PROP_A,
        sourceEpoch: 2,
        startedAt: STARTED,
        completedAt: COMPLETED,
        outcome,
        comparison: null,
      })

      const [row] = await rows()
      expect(row).toMatchObject({
        mode: 'head_dark',
        page_count: outcome === 'order_violation' ? 1 : 0,
        review_count: 0,
        created_count: 0,
        updated_count: 0,
        failed_count: failed,
        error_class: outcome,
      })
      expect(JSON.parse(row.result)).toEqual({ outcome })
    },
  )
})
