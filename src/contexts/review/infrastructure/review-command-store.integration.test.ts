import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { EventBus } from '#/shared/events/event-bus'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

const ORG = organizationId('review-reobserve-org-a')
const OTHER_ORG = organizationId('review-reobserve-org-b')
const PROPERTY = propertyId('ae000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('ae000000-0000-4000-8000-000000000002')
const REPLY = 'ae000000-0000-4000-8000-000000000003'
const OBSERVED_AT = new Date('2026-08-25T12:00:00.000Z')
const EXPIRED_AT = new Date('2026-08-24T12:00:00.000Z')
const REFRESHED_UNTIL = new Date('2026-09-24T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: ['outbox_events', 'replies', 'review_ai_analysis_heads', 'reviews'],
})

const events: EventBus = {
  on: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn(),
}

function review(contentExpiresAt: Date): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-1',
    externalLocationId: 'locations/reobserve',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    rating: 4,
    text: 'Original review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2027-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: null,
    firstFetchedAt: new Date('2026-08-01T12:00:00.000Z'),
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt,
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 15,
    aiSourceDigest: 'a'.repeat(64),
  }
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  vi.clearAllMocks()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Re-observe property', 'review-reobserve-property', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
})

describe('atomic review re-observation', () => {
  it('preserves staff-authored reply history while advancing the source lifecycle', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events)
    const initial = review(EXPIRED_AT)
    const created = await store.upsertAndRecord(
      initial,
      (persisted) =>
        reviewCreated({
          reviewId: persisted.id,
          propertyId: persisted.propertyId,
          organizationId: persisted.organizationId,
          platform: persisted.platform,
          sourceEpoch: persisted.sourceEpoch,
          sourceRevision: persisted.sourceRevision,
          analysisSequence: persisted.analysisSequence,
          occurredAt: OBSERVED_AT,
        }),
      OBSERVED_AT,
    )
    await getPool().query(
      `INSERT INTO replies (
         id, review_id, organization_id, text, status, source, created_by,
         ai_generated, authorship, state_revision
       ) VALUES ($1, $2, $3, 'Manager draft', 'draft', 'internal',
         'staff-user-1', false, 'human', 1)`,
      [REPLY, REVIEW, ORG],
    )
    // The lifecycle process has erased provider-controlled content, leaving
    // only the stable Review identity and manager Reply history.
    await getPool().query(`DELETE FROM review_source_contents WHERE review_id = $1`, [
      REVIEW,
    ])
    await getPool().query(
      `UPDATE reviews
       SET external_id = NULL,
           external_location_id = NULL,
           google_connection_id = NULL,
           reviewer_name = NULL,
           reviewer_profile_photo_url = NULL,
           rating = NULL,
           text = NULL,
           translated_text = NULL,
           language_code = NULL,
           reviewed_at = NULL,
           expires_at = NULL,
           source_created_at = NULL,
           source_updated_at = NULL,
           content_hash = NULL,
           ai_source_byte_length = NULL,
           ai_source_digest = NULL,
           content_expires_at = $3,
           source_content_state = 'provider_deleted',
           source_content_erased_at = $2
       WHERE id = $1`,
      [REVIEW, OBSERVED_AT, REFRESHED_UNTIL],
    )

    const refreshed = await store.reobserveExpiredAndRecord(
      {
        ...initial,
        text: 'Re-observed review',
        lastFetchedAt: OBSERVED_AT,
        contentExpiresAt: REFRESHED_UNTIL,
        contentHash: 'content-v2',
        aiSourceByteLength: 19,
        aiSourceDigest: 'b'.repeat(64),
      },
      OBSERVED_AT,
    )

    const reply = await getPool().query<{
      id: string
      text: string
      state_revision: string
      created_by: string
    }>(
      `SELECT id, text, state_revision, created_by
       FROM replies
       WHERE id = $1 AND organization_id = $2`,
      [REPLY, ORG],
    )
    const persistedReview = await getPool().query<{
      created_at: Date
      source_revision: string
      analysis_sequence: string
      text: string
    }>(
      `SELECT created_at, source_revision, analysis_sequence, text,
              source_content_state, source_content_erased_at
       FROM reviews
       WHERE id = $1 AND organization_id = $2`,
      [REVIEW, ORG],
    )

    expect(reply.rows).toEqual([
      {
        id: REPLY,
        text: 'Manager draft',
        state_revision: '1',
        created_by: 'staff-user-1',
      },
    ])
    expect(persistedReview.rows[0]).toMatchObject({
      created_at: created.createdAt,
      source_revision: '2',
      analysis_sequence: '3',
      text: 'Re-observed review',
      source_content_state: 'active',
      source_content_erased_at: null,
    })
    const sourceContent = await getPool().query<{
      review_id: string
      source_revision: string
      text: string
    }>(
      `SELECT review_id, source_revision, text
       FROM review_source_contents
       WHERE review_id = $1`,
      [REVIEW],
    )
    expect(sourceContent.rows).toEqual([
      {
        review_id: REVIEW,
        source_revision: '2',
        text: 'Re-observed review',
      },
    ])
    expect(refreshed).toMatchObject({
      id: REVIEW,
      sourceRevision: 2,
      analysisSequence: 3,
      text: 'Re-observed review',
    })
  })
})
