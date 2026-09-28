import { beforeEach, describe, expect, it } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { createReviewResponseTargetAuthority } from './response-target-authority'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'

/**
 * Archive/Restore, a Google relink and disconnect/reconnect advance the
 * Property's source epoch; the next sync carries each unchanged Review into it
 * as its next Material Revision. Inbox must be able to follow the Review's
 * history across that carry, and must be told which revision was only a carry.
 */
const ORG = organizationId('review-epoch-carry-projection-org-a')
const OTHER_ORG = organizationId('review-epoch-carry-projection-org-b')
const PROPERTY = propertyId('af000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('af000000-0000-4000-8000-000000000002')
const OBSERVED = [
  new Date('2026-08-25T12:00:00.000Z'),
  new Date('2026-09-05T12:00:00.000Z'),
  new Date('2026-09-06T12:00:00.000Z'),
] as const

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_heads',
    'reviews',
  ],
})

const initial: Omit<Review, 'createdAt' | 'updatedAt'> = {
  id: REVIEW,
  organizationId: ORG,
  propertyId: PROPERTY,
  platform: 'google',
  externalId: 'provider-review-epoch-carry',
  externalLocationId: 'locations/epoch-carry',
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
  lastFetchedAt: OBSERVED[0],
  contentExpiresAt: new Date('2026-10-24T12:00:00.000Z'),
  contentHash: 'content-v1',
  sourceSeenGeneration: null,
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence: 0,
  aiSourceByteLength: 15,
  aiSourceDigest: 'a'.repeat(64),
}

/** One sync observation through Review's real write path. */
async function observe(
  candidate: Omit<Review, 'createdAt' | 'updatedAt'>,
  observedAt: Date,
  observationKey: string,
) {
  const store = createAtomicReviewCommandStore(getDb(), () => observedAt)
  const factory = candidate.sourceRevision === 1 ? reviewCreated : reviewUpdated
  return store.upsertAndRecord(
    candidate,
    (persisted) =>
      factory({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: observedAt,
      }),
    observedAt,
    observationKey,
    'ongoing',
  )
}

const projectionOf = (sourceEpoch: number, eventSourceRevision: number) =>
  createReviewResponseTargetAuthority(getDb()).withInboxProjection(
    {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      sourceEpoch,
      eventSourceRevision,
      eventKind: 'updated',
    },
    async (permit) =>
      permit.revisions.map((revision) => ({
        revision: revision.materialReviewRevision,
        sourceEpoch: revision.sourceEpoch,
        carry: revision.sourceEpochCarry,
      })),
  )

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Epoch carry projection', 'review-epoch-carry-projection', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('Review Inbox projection permit across a source-epoch carry', () => {
  it('follows a carried Review into its new epoch and marks only the carry', async () => {
    const created = await observe(initial, OBSERVED[0], '1'.repeat(64))
    await getPool().query('UPDATE properties SET source_epoch = 1 WHERE id = $1', [
      PROPERTY,
    ])
    const carried = await observe(
      { ...initial, sourceEpoch: 1, analysisSequence: created.analysisSequence },
      OBSERVED[1],
      '2'.repeat(64),
    )

    await expect(projectionOf(1, carried.sourceRevision)).resolves.toEqual({
      status: 'current',
      value: [
        { revision: 1, sourceEpoch: 0, carry: false },
        { revision: 2, sourceEpoch: 1, carry: true },
      ],
    })

    const edited = await observe(
      {
        ...initial,
        sourceEpoch: 1,
        text: 'Edited after the restore',
        analysisSequence: carried.analysisSequence,
        sourceUpdatedAt: OBSERVED[2],
        lastFetchedAt: OBSERVED[2],
      },
      OBSERVED[2],
      '3'.repeat(64),
    )

    expect(edited.sourceRevision).toBe(3)
    await expect(projectionOf(1, 3)).resolves.toEqual({
      status: 'current',
      value: [
        { revision: 1, sourceEpoch: 0, carry: false },
        { revision: 2, sourceEpoch: 1, carry: true },
        { revision: 3, sourceEpoch: 1, carry: false },
      ],
    })
    // The superseded epoch no longer speaks for the Review.
    await expect(projectionOf(0, 1)).resolves.toEqual({ status: 'obsolete' })
  })

  it('marks the carry of a Review whose earlier revision predates digests', async () => {
    const created = await observe(initial, OBSERVED[0], '6'.repeat(64))
    // A Review imported before material digests existed keeps an unverified
    // baseline; its carry is decided by Review's recorded shadow comparison.
    await getPool().query(
      `UPDATE material_review_revisions
       SET normalization_version = 'legacy-unverified-v0',
           source_digest = NULL, normalized_digest = NULL
       WHERE review_id = $1`,
      [REVIEW],
    )
    await getPool().query(
      `UPDATE reviews
       SET material_normalization_version = 'legacy-unverified-v0',
           material_source_digest = NULL, material_normalized_digest = NULL
       WHERE id = $1`,
      [REVIEW],
    )
    await getPool().query('UPDATE properties SET source_epoch = 1 WHERE id = $1', [
      PROPERTY,
    ])
    await observe(
      { ...initial, sourceEpoch: 1, analysisSequence: created.analysisSequence },
      OBSERVED[1],
      '7'.repeat(64),
    )

    await expect(projectionOf(1, 2)).resolves.toEqual({
      status: 'current',
      value: [
        { revision: 1, sourceEpoch: 0, carry: false },
        { revision: 2, sourceEpoch: 1, carry: true },
      ],
    })
  })

  it('does not mark a guest edit first seen in the new epoch as a carry', async () => {
    const created = await observe(initial, OBSERVED[0], '4'.repeat(64))
    await getPool().query('UPDATE properties SET source_epoch = 1 WHERE id = $1', [
      PROPERTY,
    ])
    await observe(
      {
        ...initial,
        sourceEpoch: 1,
        rating: 2,
        text: 'Edited while disconnected',
        analysisSequence: created.analysisSequence,
        sourceUpdatedAt: OBSERVED[1],
        lastFetchedAt: OBSERVED[1],
      },
      OBSERVED[1],
      '5'.repeat(64),
    )

    await expect(projectionOf(1, 2)).resolves.toEqual({
      status: 'current',
      value: [
        { revision: 1, sourceEpoch: 0, carry: false },
        { revision: 2, sourceEpoch: 1, carry: false },
      ],
    })
  })
})
