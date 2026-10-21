// The push health ledger against real PostgreSQL: the first-sighting row is
// written in the Review's own first-insert transaction, and a push read pairs
// with it afterwards.

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewFirstSightingRecorder } from './repositories/review-first-sighting.repository'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import type { ReviewFirstSighting } from '../application/ports/review-command-store.port'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

const ORG = organizationId('review-sighting-org-a')
const OTHER_ORG = organizationId('review-sighting-org-b')
const PROPERTY = propertyId('b5f1e000-0000-4000-8000-000000000001')
const REVIEW = reviewId('b5f1e000-0000-4000-8000-000000000002')
const OTHER_PROPERTY = propertyId('b5f1e000-0000-4000-8000-000000000003')
const OTHER_REVIEW = reviewId('b5f1e000-0000-4000-8000-000000000004')
const SEEN_AT = new Date('2026-10-20T12:00:00.000Z')
const ACCEPTED_AT = new Date('2026-10-20T11:59:30.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'review_first_sightings',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_heads',
    'reviews',
  ],
})

function review(
  overrides: Partial<Omit<Review, 'createdAt' | 'updatedAt'>> = {},
): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: REVIEW,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: 'sighting-review-1',
    externalLocationId: 'locations/sighting',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'A review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-10-20T11:00:00.000Z'),
    expiresAt: new Date('2027-10-20T11:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-10-20T11:00:00.000Z'),
    sourceUpdatedAt: null,
    firstFetchedAt: SEEN_AT,
    lastFetchedAt: SEEN_AT,
    contentExpiresAt: new Date('2026-11-20T12:00:00.000Z'),
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 8,
    aiSourceDigest: 'a'.repeat(64),
    ...overrides,
  }
}

const created = (persisted: Review) =>
  reviewCreated({
    reviewId: persisted.id,
    propertyId: persisted.propertyId,
    organizationId: persisted.organizationId,
    platform: persisted.platform,
    sourceEpoch: persisted.sourceEpoch,
    sourceRevision: persisted.sourceRevision,
    analysisSequence: persisted.analysisSequence,
    occurredAt: SEEN_AT,
  })

const updated = (persisted: Review) =>
  reviewUpdated({
    reviewId: persisted.id,
    propertyId: persisted.propertyId,
    organizationId: persisted.organizationId,
    platform: persisted.platform,
    sourceEpoch: persisted.sourceEpoch,
    sourceRevision: persisted.sourceRevision,
    analysisSequence: persisted.analysisSequence,
    occurredAt: SEEN_AT,
  })

async function sightings(organization: string = ORG) {
  const result = await getPool().query(
    `SELECT property_id, review_id, source_epoch, first_seen_at, first_seen_via, push_accepted_at
       FROM review_first_sightings WHERE organization_id = $1 ORDER BY review_id`,
    [organization],
  )
  return result.rows
}

const store = () => createAtomicReviewCommandStore(getDb(), () => SEEN_AT)

function writeFirst(sighting: ReviewFirstSighting | undefined, key = '1'.repeat(64)) {
  return store().upsertAndRecord(review(), created, SEEN_AT, key, 'ongoing', sighting)
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  vi.clearAllMocks()
  for (const [id, org, slug] of [
    [PROPERTY, ORG, 'review-sighting-property'],
    [OTHER_PROPERTY, OTHER_ORG, 'review-sighting-property-other'],
  ] as const) {
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Sighting property', $3, 'UTC')
       ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
      [id, org, slug],
    )
  }
})

afterAll(async () => {
  // The Properties this suite created outlive its `tables` cleanup, and a
  // Property id is global: leave none for another suite to find in this scope.
  await getPool().query(`DELETE FROM properties WHERE id = ANY($1)`, [
    [PROPERTY, OTHER_PROPERTY],
  ])
})

describe('first-sighting ledger written with the Review', () => {
  it('records a polling first sighting in the same transaction as the Review', async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })

    expect(await sightings()).toEqual([
      expect.objectContaining({
        property_id: PROPERTY,
        review_id: REVIEW,
        source_epoch: 0,
        first_seen_at: SEEN_AT,
        first_seen_via: 'snapshot',
        push_accepted_at: null,
      }),
    ])
  })

  it('records a push first sighting with the time Pub/Sub accepted the push', async () => {
    await writeFirst({ seenVia: 'push', pushAcceptedAt: ACCEPTED_AT })

    expect(await sightings()).toEqual([
      expect.objectContaining({ first_seen_via: 'push', push_accepted_at: ACCEPTED_AT }),
    ])
  })

  it('records nothing when the write carries no first sighting', async () => {
    await writeFirst(undefined)

    expect(await sightings()).toEqual([])
  })

  it('records nothing for a write that is an update rather than the Review creation', async () => {
    await store().upsertAndRecord(review(), updated, SEEN_AT, '2'.repeat(64), 'ongoing', {
      seenVia: 'snapshot',
      pushAcceptedAt: null,
    })

    expect(await sightings()).toEqual([])
  })

  it('keeps the first sighting when the same Review is written again', async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })
    await store().upsertAndRecord(
      review({ text: 'Edited review' }),
      created,
      new Date(SEEN_AT.getTime() + 60_000),
      '3'.repeat(64),
      'ongoing',
      { seenVia: 'push', pushAcceptedAt: ACCEPTED_AT },
    )

    expect(await sightings()).toEqual([
      expect.objectContaining({
        first_seen_at: SEEN_AT,
        first_seen_via: 'snapshot',
        push_accepted_at: ACCEPTED_AT,
      }),
    ])
  })

  it('leaves a replayed observation as the one row', async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })

    expect(await sightings()).toHaveLength(1)
  })

  it('rolls the Review back with a sighting the database refuses', async () => {
    await expect(
      writeFirst({
        seenVia: 'carrier-pigeon' as ReviewFirstSighting['seenVia'],
        pushAcceptedAt: null,
      }),
    ).rejects.toThrow(/insert into "review_first_sightings"/)

    expect(await sightings()).toEqual([])
    const reviews = await getPool().query(`SELECT id FROM reviews WHERE id = $1`, [
      REVIEW,
    ])
    expect(reviews.rows).toEqual([])
  })

  it('keeps one row per Organization when two Organizations hold the same location', async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })
    await store().upsertAndRecord(
      review({
        id: OTHER_REVIEW,
        organizationId: OTHER_ORG,
        propertyId: OTHER_PROPERTY,
      }),
      created,
      SEEN_AT,
      '4'.repeat(64),
      'ongoing',
      { seenVia: 'push', pushAcceptedAt: ACCEPTED_AT },
    )

    expect(await sightings(ORG)).toEqual([
      expect.objectContaining({ review_id: REVIEW, first_seen_via: 'snapshot' }),
    ])
    expect(await sightings(OTHER_ORG)).toEqual([
      expect.objectContaining({ review_id: OTHER_REVIEW, first_seen_via: 'push' }),
    ])
  })
})

describe('pairing a push with a first sighting', () => {
  const recorder = () => createReviewFirstSightingRecorder(getDb())

  it('stamps the push acceptance time on a Review polling saw first', async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })

    await recorder().markPushArrived({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      acceptedAt: ACCEPTED_AT,
    })

    expect(await sightings()).toEqual([
      expect.objectContaining({
        first_seen_via: 'snapshot',
        push_accepted_at: ACCEPTED_AT,
      }),
    ])
  })

  it('keeps the first acceptance time when a later push is paired', async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })
    const markAt = (acceptedAt: Date) =>
      recorder().markPushArrived({
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: REVIEW,
        acceptedAt,
      })

    await markAt(ACCEPTED_AT)
    await markAt(new Date(ACCEPTED_AT.getTime() + 3_600_000))

    expect(await sightings()).toEqual([
      expect.objectContaining({ push_accepted_at: ACCEPTED_AT }),
    ])
  })

  it('does nothing for a Review that has no first-sighting row', async () => {
    await writeFirst(undefined)

    await recorder().markPushArrived({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      acceptedAt: ACCEPTED_AT,
    })

    expect(await sightings()).toEqual([])
  })

  it("never stamps another Organization's row", async () => {
    await writeFirst({ seenVia: 'snapshot', pushAcceptedAt: null })

    await recorder().markPushArrived({
      organizationId: OTHER_ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      acceptedAt: ACCEPTED_AT,
    })

    expect(await sightings()).toEqual([
      expect.objectContaining({ push_accepted_at: null }),
    ])
  })
})
