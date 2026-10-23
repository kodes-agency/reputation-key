import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createReviewObservationRepository } from './repositories/review-observation.repository'

// On 2026-10-23 Google started sending translated reviews original-first. The
// parser of the day stored the whole envelope as the guest's text, which read as
// a guest edit and reopened handled Inbox items. Once the parser splits the
// envelope again, the next read must not count as a second edit.

const ORG = organizationId('review-envelope-org-a')
const OTHER_ORG = organizationId('review-envelope-org-b')
const PROPERTY = propertyId('e7a10000-0000-4000-8000-000000000001')
const REVIEW = reviewId('e7a10000-0000-4000-8000-000000000002')
const OBSERVED_AT = new Date('2026-10-23T04:35:00.000Z')
const CREATED_AT = new Date('2022-10-29T14:53:45.961Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'google_reply_observation_heads',
    'google_reply_observations',
    'replies',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_released_sequences',
    'review_ai_analysis_heads',
    'reviews',
  ],
})

function review(
  content: Readonly<{ text: string; translatedText: string | null }>,
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'provider-review-envelope',
    externalLocationId: 'locations/envelope',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 1,
    text: content.text,
    translatedText: content.translatedText,
    languageCode: null,
    reviewedAt: CREATED_AT,
    expiresAt: new Date('2027-10-29T14:53:45.961Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: CREATED_AT,
    // Google's updateTime never moved: the guest did not edit anything.
    sourceUpdatedAt: CREATED_AT,
    firstFetchedAt: CREATED_AT,
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt: new Date('2026-11-22T04:35:00.000Z'),
    contentHash: 'content-envelope',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 4,
    aiSourceDigest: 'a'.repeat(64),
  }
}

const updatedEvent = (persisted: Review) =>
  reviewUpdated({
    reviewId: persisted.id,
    propertyId: persisted.propertyId,
    organizationId: persisted.organizationId,
    platform: persisted.platform,
    sourceEpoch: persisted.sourceEpoch,
    sourceRevision: persisted.sourceRevision,
    analysisSequence: persisted.analysisSequence,
    occurredAt: OBSERVED_AT,
  })

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Envelope property', 'review-envelope-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('a review stored with a provider envelope glued to its text', () => {
  it('takes the split text back without a second material revision', async () => {
    const store = createAtomicReviewCommandStore(getDb(), () => new Date())
    const split = { text: 'Ок', translatedText: 'Ok' }
    await store.upsertAndRecord(
      review(split),
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
      '1'.repeat(64),
      'ongoing',
    )
    const glued = await store.upsertAndRecord(
      review({ text: 'Ок\n\n(Translated by Google)\nOk', translatedText: null }),
      updatedEvent,
      OBSERVED_AT,
      '2'.repeat(64),
      'ongoing',
    )

    const repaired = await store.upsertAndRecord(
      review(split),
      updatedEvent,
      OBSERVED_AT,
      '3'.repeat(64),
      'ongoing',
    )
    const reread = await store.upsertAndRecord(
      { ...review(split), reviewerName: 'Guest renamed' },
      updatedEvent,
      OBSERVED_AT,
      '4'.repeat(64),
      'ongoing',
    )

    expect(glued.sourceRevision).toBe(2)
    expect(repaired.sourceRevision).toBe(2)
    expect(reread.sourceRevision).toBe(2)
    const history = createReviewObservationRepository(getDb())
    const observations = await history.findObservations(REVIEW, ORG)
    expect(
      observations.map((entry) => [
        entry.observationSequence,
        entry.materialRevision,
        entry.comparison,
      ]),
    ).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 2, 'material_change'],
      [3, 2, 'normalization_shadow_match'],
      [4, 2, 'unchanged'],
    ])
    expect(await history.findMaterialRevisions(REVIEW, ORG)).toHaveLength(2)
    const current = await getPool().query<{ text: string; translated_text: string }>(
      `SELECT text, translated_text FROM reviews WHERE id = $1 AND organization_id = $2`,
      [REVIEW, ORG],
    )
    expect(current.rows[0]).toEqual({ text: 'Ок', translated_text: 'Ok' })
  })
})
