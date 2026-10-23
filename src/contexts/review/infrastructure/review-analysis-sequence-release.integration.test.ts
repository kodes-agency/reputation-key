// The Review writer allocates an AI-analysis sequence before it knows whether
// the observation will be applied. A replayed observation, or one older than
// what is stored, is not applied: no Review takes the number and no event
// announces it. Coverage owes a settlement for every number up to the head, so
// the writer must give that number back in the same transaction.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAtomicReviewCommandStore,
  type ProviderRestatement,
} from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createReviewObservationRepository } from './repositories/review-observation.repository'

const ORG = organizationId('review-seq-release-org-a')
const OTHER_ORG = organizationId('review-seq-release-org-b')
const PROPERTY = propertyId('5eed0001-0000-4000-8000-000000000001')
const REVIEW = reviewId('5eed0001-0000-4000-8000-000000000002')
const OBSERVED_AT = new Date('2026-08-25T12:00:00.000Z')
const CONTENT_EXPIRES_AT = new Date('2026-09-24T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_released_sequences',
    'review_ai_analysis_heads',
    'reviews',
    'properties',
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
    externalId: 'provider-review-release-1',
    externalLocationId: 'locations/release',
    googleConnectionId: null,
    reviewerName: 'Guest',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    text: 'Original review',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date('2026-08-01T12:00:00.000Z'),
    expiresAt: new Date('2027-08-01T12:00:00.000Z'),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date('2026-08-01T12:00:00.000Z'),
    sourceUpdatedAt: new Date('2026-08-01T12:00:00.000Z'),
    firstFetchedAt: new Date('2026-08-01T12:00:00.000Z'),
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt: CONTENT_EXPIRES_AT,
    contentHash: 'content-v1',
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 15,
    aiSourceDigest: 'a'.repeat(64),
    ...overrides,
  }
}

const announce = (persisted: Review) =>
  persisted.analysisSequence === 1
    ? reviewCreated({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: OBSERVED_AT,
      })
    : reviewUpdated({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: OBSERVED_AT,
      })

async function headSequence(): Promise<number> {
  const result = await getPool().query<{ head_sequence: string }>(
    `SELECT head_sequence FROM review_ai_analysis_heads
     WHERE organization_id = $1 AND property_id = $2 AND source_epoch = 0`,
    [ORG, PROPERTY],
  )
  return Number(result.rows[0]?.head_sequence ?? 0)
}

async function releasedRows(): Promise<
  ReadonlyArray<Readonly<{ sequence: number; reason: string }>>
> {
  const result = await getPool().query<{ analysis_sequence: string; reason: string }>(
    `SELECT analysis_sequence, reason FROM review_ai_analysis_released_sequences
     WHERE organization_id = $1 AND property_id = $2 AND source_epoch = 0
     ORDER BY analysis_sequence`,
    [ORG, PROPERTY],
  )
  return result.rows.map((row) => ({
    sequence: Number(row.analysis_sequence),
    reason: row.reason,
  }))
}

/** Sequences an announcement (outbox fact) carries for the Property. */
async function announcedSequences(): Promise<readonly number[]> {
  const result = await getPool().query<{ sequence: string }>(
    `SELECT DISTINCT (payload->>'analysisSequence') AS sequence FROM outbox_events
     WHERE organization_id = $1 AND property_id = $2
       AND payload->>'analysisSequence' IS NOT NULL`,
    [ORG, PROPERTY],
  )
  return result.rows.map((row) => Number(row.sequence)).sort((a, b) => a - b)
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Sequence release property', 'review-seq-release-property', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
})

describe('the Review writer gives back a sequence it did not use', () => {
  it('releases nothing when every observation is applied', async () => {
    const store = createAtomicReviewCommandStore(getDb(), () => new Date())

    await store.upsertAndRecord(
      review(),
      announce,
      OBSERVED_AT,
      '1'.repeat(64),
      'ongoing',
    )
    await store.upsertAndRecord(
      review({ sourceUpdatedAt: new Date('2026-08-02T12:00:00.000Z') }),
      announce,
      OBSERVED_AT,
      '2'.repeat(64),
      'ongoing',
    )

    expect(await headSequence()).toBe(2)
    expect(await releasedRows()).toEqual([])
    expect(await announcedSequences()).toEqual([1, 2])
  })

  it('releases the sequence of a replayed observation, so head = announced + released', async () => {
    const store = createAtomicReviewCommandStore(getDb(), () => new Date())
    await store.upsertAndRecord(
      review(),
      announce,
      OBSERVED_AT,
      '1'.repeat(64),
      'ongoing',
    )

    // The same observation key again: a retried snapshot page.
    await store.upsertAndRecord(
      review(),
      announce,
      OBSERVED_AT,
      '1'.repeat(64),
      'ongoing',
    )
    await store.upsertAndRecord(
      review(),
      announce,
      OBSERVED_AT,
      '1'.repeat(64),
      'ongoing',
    )

    expect(await headSequence()).toBe(3)
    expect(await releasedRows()).toEqual([
      { sequence: 2, reason: 'replayed_observation' },
      { sequence: 3, reason: 'replayed_observation' },
    ])
    const announced = await announcedSequences()
    const released = (await releasedRows()).map((row) => row.sequence)
    expect([...announced, ...released].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('releases the sequence of an out-of-order observation and still records its history', async () => {
    const store = createAtomicReviewCommandStore(getDb(), () => new Date())
    await store.upsertAndRecord(
      review({ sourceUpdatedAt: new Date('2026-08-03T12:00:00.000Z') }),
      announce,
      OBSERVED_AT,
      '1'.repeat(64),
      'ongoing',
    )

    await store.upsertAndRecord(
      review({
        text: 'Older provider version',
        sourceUpdatedAt: new Date('2026-08-02T12:00:00.000Z'),
      }),
      announce,
      OBSERVED_AT,
      '2'.repeat(64),
      'ongoing',
    )

    expect(await headSequence()).toBe(2)
    expect(await releasedRows()).toEqual([
      { sequence: 2, reason: 'out_of_order_observation' },
    ])
    const history = await createReviewObservationRepository(getDb()).findObservations(
      REVIEW,
      ORG,
    )
    expect(history.map((entry) => entry.comparison)).toEqual([
      'initial_material_revision',
      'out_of_order_ignored',
    ])
    const held = await getPool().query<{ analysis_sequence: string }>(
      `SELECT analysis_sequence FROM reviews WHERE id = $1 AND organization_id = $2`,
      [REVIEW, ORG],
    )
    expect(held.rows[0]?.analysis_sequence).toBe('1')
  })

  it('applies, announces and keeps the sequence of a restatement at an equal provider version', async () => {
    const report = vi.fn<(restatement: ProviderRestatement) => void>()
    const store = createAtomicReviewCommandStore(
      getDb(),
      () => new Date(),
      undefined,
      report,
    )
    await store.upsertAndRecord(
      review(),
      announce,
      OBSERVED_AT,
      '1'.repeat(64),
      'ongoing',
    )

    // Equal versions are applied in order. The net calls this Google rewording
    // the review, so it is no older evidence and nothing is given back.
    await store.upsertAndRecord(
      review({ text: 'Reworded by Google' }),
      announce,
      OBSERVED_AT,
      '2'.repeat(64),
      'ongoing',
    )

    expect(await headSequence()).toBe(2)
    expect(await releasedRows()).toEqual([])
    expect(await announcedSequences()).toEqual([1, 2])
    const history = await createReviewObservationRepository(getDb()).findObservations(
      REVIEW,
      ORG,
    )
    // Stored as the shadow match; the report is what says the net fired.
    expect(history.map((entry) => entry.comparison)).toEqual([
      'initial_material_revision',
      'normalization_shadow_match',
    ])
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('leaves the head and the ledger unchanged when the write fails', async () => {
    const failing = createAtomicReviewCommandStore(
      getDb(),
      () => new Date(),
      async () => {
        throw new Error('observation could not be stored')
      },
    )

    await expect(
      failing.upsertAndRecord(review(), announce, OBSERVED_AT, '1'.repeat(64), 'ongoing'),
    ).rejects.toThrow('observation could not be stored')

    expect(await headSequence()).toBe(0)
    expect(await releasedRows()).toEqual([])
  })
})
