import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAtomicReviewCommandStore } from './review-command-store'
import { reviewCreated, reviewUpdated } from '../domain/events'
import type { Review } from '../domain/types'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { EventBus } from '#/shared/events/event-bus'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { eraseReviewSourceContent } from './review-source-content-store'
import { createReviewObservationRepository } from './repositories/review-observation.repository'
import { createReviewRepository } from './repositories/review.repository'
import { createReviewResponseTargetAuthority } from './response-target-authority'
import { createGoogleReplyObservationStore } from './google-reply-observation-store'

const ORG = organizationId('review-reobserve-org-a')
const OTHER_ORG = organizationId('review-reobserve-org-b')
const PROPERTY = propertyId('ae000000-0000-4000-8000-000000000001')
const REVIEW = reviewId('ae000000-0000-4000-8000-000000000002')
const OTHER_PROPERTY = propertyId('ae000000-0000-4000-8000-000000000004')
const OTHER_REVIEW = reviewId('ae000000-0000-4000-8000-000000000005')
const REPLY = 'ae000000-0000-4000-8000-000000000003'
const OBSERVED_AT = new Date('2026-08-25T12:00:00.000Z')
const EXPIRED_AT = new Date('2026-08-24T12:00:00.000Z')
const REFRESHED_UNTIL = new Date('2026-09-24T12:00:00.000Z')

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
    'review_ai_analysis_heads',
    'reviews',
  ],
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
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [PROPERTY, ORG],
  )
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Other re-observe property', 'review-reobserve-property-other', 'UTC')
     ON CONFLICT (id) DO UPDATE SET source_epoch = 0`,
    [OTHER_PROPERTY, ORG],
  )
})

describe('atomic review re-observation', () => {
  it('issues exact current target permits and orders a complete batch', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const first = review(REFRESHED_UNTIL)
    const second = {
      ...first,
      id: OTHER_REVIEW,
      propertyId: OTHER_PROPERTY,
      externalId: 'provider-review-2',
    }
    for (const [index, candidate] of [first, second].entries()) {
      await store.upsertAndRecord(
        candidate,
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
        String(index + 8).repeat(64),
        'ongoing',
      )
    }

    const authority = createReviewResponseTargetAuthority(getDb())
    await expect(
      authority.withExactCurrent(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
        },
        async (permit) => permit,
      ),
    ).resolves.toMatchObject({
      status: 'current',
      value: {
        materialReviewRevision: 1,
        eligibility: 'measured',
        responseTargetStartAt: first.sourceCreatedAt,
      },
    })
    await expect(
      authority.withExactCurrent(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 1,
        },
        async () => 'must-not-run',
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    const expectations = [
      {
        organizationId: ORG,
        propertyId: OTHER_PROPERTY,
        reviewId: OTHER_REVIEW,
        sourceEpoch: 0,
      },
      {
        organizationId: ORG,
        propertyId: PROPERTY,
        reviewId: REVIEW,
        sourceEpoch: 0,
      },
    ] as const
    await expect(
      authority.withExactCurrentBatch(expectations, async (permits) =>
        permits.map((permit) => permit.reviewId),
      ),
    ).resolves.toEqual({ status: 'current', value: [REVIEW, OTHER_REVIEW] })
    await expect(
      authority.withExactCurrentBatch(
        [expectations[0], expectations[0]],
        async () => undefined,
      ),
    ).rejects.toThrow('contains duplicates')
  })

  it('excludes a material revision first seen during historical onboarding', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const initial = review(REFRESHED_UNTIL)

    await store.upsertAndRecord(
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
      '0'.repeat(64),
      'historical_onboarding',
    )

    const revisions = await createReviewObservationRepository(
      getDb(),
    ).findMaterialRevisions(REVIEW, ORG)
    expect(revisions).toEqual([
      expect.objectContaining({
        revision: 1,
        responseTargetEligibility: 'historical_onboarding',
        responseTargetStartAt: null,
      }),
    ])
  })

  it('keeps a future provider timestamp as source evidence but excludes it from measured targets', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const futureProviderTime = new Date('2026-08-25T12:05:00.000Z')
    const initial = {
      ...review(REFRESHED_UNTIL),
      sourceCreatedAt: futureProviderTime,
    }

    await store.upsertAndRecord(
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
      'f'.repeat(64),
      'ongoing',
    )

    const observations = await createReviewObservationRepository(
      getDb(),
    ).findObservations(REVIEW, ORG)
    const revisions = await createReviewObservationRepository(
      getDb(),
    ).findMaterialRevisions(REVIEW, ORG)
    expect(observations[0]).toMatchObject({
      sourceEpoch: 0,
      materialRevision: 1,
    })
    expect(revisions).toEqual([
      expect.objectContaining({
        revision: 1,
        responseTargetEligibility: 'legacy_unknown',
        responseTargetStartAt: null,
      }),
    ])

    const authority = createReviewResponseTargetAuthority(getDb())
    await expect(
      authority.withExactCurrent(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
        },
        async (permit) => permit,
      ),
    ).resolves.toMatchObject({
      status: 'current',
      value: {
        eligibility: 'legacy_unknown',
        responseTargetStartAt: null,
      },
    })
  })

  it('preserves staff-authored reply history while advancing the source lifecycle', async () => {
    // @proof REVIEW_REOBSERVATION_IDENTITY#1
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
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
    // Re-observation crosses the database expiry boundary in one transaction:
    // old provider values are redacted before the fresh observation is linked.
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

    const history = createReviewObservationRepository(getDb())
    const observations = await history.findObservations(REVIEW, ORG)
    const revisions = await history.findMaterialRevisions(REVIEW, ORG)
    await expect(history.findObservations(REVIEW, OTHER_ORG)).resolves.toEqual([])
    await expect(history.findMaterialRevisions(REVIEW, OTHER_ORG)).resolves.toEqual([])
    expect(observations).toMatchObject([
      {
        observationSequence: 1,
        materialRevision: 1,
        contentState: 'source_expired',
        rating: null,
        originalText: null,
      },
      {
        observationSequence: 2,
        materialRevision: 2,
        contentState: 'active',
        rating: 4,
        originalText: 'Re-observed review',
      },
    ])
    expect(revisions).toMatchObject([
      {
        revision: 1,
        contentState: 'source_expired',
        rating: null,
        normalizedText: null,
      },
      {
        revision: 2,
        contentState: 'active',
        rating: 4,
        normalizedText: 'Re-observed review',
      },
    ])
  })

  it('versions every observation but advances material revision only for rating or normalized original text', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const initial = {
      ...review(REFRESHED_UNTIL),
      sourceUpdatedAt: new Date('2026-08-01T12:00:00.000Z'),
    }
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
      '1'.repeat(64),
      'ongoing',
    )

    const metadataOnly = await store.upsertAndRecord(
      {
        ...initial,
        text: '  Original\n\treview ',
        translatedText: 'Updated machine translation',
        reviewerName: 'Guest profile update',
        sourceUpdatedAt: new Date('2026-08-02T12:00:00.000Z'),
      },
      (persisted) =>
        reviewUpdated({
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
      '2'.repeat(64),
      'historical_onboarding',
    )

    const materialChangeInput = {
      ...initial,
      rating: 5 as const,
      text: 'Material edit',
      sourceUpdatedAt: new Date('2026-08-03T12:00:00.000Z'),
      contentHash: 'content-v2',
    }
    const materialChange = await store.upsertAndRecord(
      materialChangeInput,
      (persisted) =>
        reviewUpdated({
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
      '3'.repeat(64),
      'ongoing',
    )

    const duplicateEvent = vi.fn((persisted: Review) =>
      reviewUpdated({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: OBSERVED_AT,
      }),
    )
    await store.upsertAndRecord(
      materialChangeInput,
      duplicateEvent,
      OBSERVED_AT,
      '3'.repeat(64),
    )
    await expect(
      store.upsertAndRecord(
        { ...materialChangeInput, text: 'Conflicting replay' },
        duplicateEvent,
        OBSERVED_AT,
        '3'.repeat(64),
      ),
    ).rejects.toThrow('observation key collision')

    const outOfOrderEvent = vi.fn((persisted: Review) =>
      reviewUpdated({
        reviewId: persisted.id,
        propertyId: persisted.propertyId,
        organizationId: persisted.organizationId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: OBSERVED_AT,
      }),
    )
    await store.upsertAndRecord(
      {
        ...materialChangeInput,
        text: 'Stale provider edit',
        sourceUpdatedAt: new Date('2026-08-02T18:00:00.000Z'),
      },
      outOfOrderEvent,
      OBSERVED_AT,
      '4'.repeat(64),
    )

    expect(created.sourceRevision).toBe(1)
    expect(metadataOnly.sourceRevision).toBe(1)
    expect(materialChange.sourceRevision).toBe(2)
    expect(duplicateEvent).not.toHaveBeenCalled()
    expect(outOfOrderEvent).not.toHaveBeenCalled()

    const history = createReviewObservationRepository(getDb())
    const observations = await history.findObservations(REVIEW, ORG)
    const revisions = await history.findMaterialRevisions(REVIEW, ORG)
    expect(
      observations.map((entry) => [
        entry.observationSequence,
        entry.materialRevision,
        entry.comparison,
      ]),
    ).toEqual([
      [1, 1, 'initial_material_revision'],
      [2, 1, 'unchanged'],
      [3, 2, 'material_change'],
      [4, 2, 'out_of_order_ignored'],
    ])
    expect(revisions).toMatchObject([
      {
        revision: 1,
        responseTargetEligibility: 'measured',
        responseTargetStartAt: initial.sourceCreatedAt,
      },
      {
        revision: 2,
        responseTargetEligibility: 'measured',
        responseTargetStartAt: materialChangeInput.sourceUpdatedAt,
      },
    ])

    const current = await getPool().query<{
      rating: number
      text: string
      source_revision: string
      source_observation_sequence: string
    }>(
      `SELECT rating, text, source_revision, source_observation_sequence
       FROM reviews WHERE id = $1 AND organization_id = $2`,
      [REVIEW, ORG],
    )
    expect(current.rows[0]).toEqual({
      rating: 5,
      text: 'Material edit',
      source_revision: '2',
      source_observation_sequence: '4',
    })
    const outbox = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbox_events
       WHERE organization_id = $1 AND source_aggregate_id = $2`,
      [ORG, REVIEW],
    )
    expect(outbox.rows[0]?.count).toBe('3')
  })

  it('restores erased content on the same identity without inventing a material edit', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const initial = review(REFRESHED_UNTIL)
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
      'a'.repeat(64),
    )
    const erased = await getDb().transaction((tx) =>
      eraseReviewSourceContent(tx, {
        reviewId: REVIEW,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: 0,
        expectedSourceRevision: 1,
        state: 'source_expired',
      }),
    )
    expect(erased).toBe(true)

    const restored = await store.reobserveExpiredAndRecord(
      {
        ...initial,
        text: '  Original\n review ',
        sourceUpdatedAt: new Date('2026-08-20T12:00:00.000Z'),
        contentExpiresAt: REFRESHED_UNTIL,
      },
      OBSERVED_AT,
      'b'.repeat(64),
    )

    expect(restored).toMatchObject({
      id: created.id,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 2,
    })
    const history = createReviewObservationRepository(getDb())
    const observations = await history.findObservations(REVIEW, ORG)
    const revisions = await history.findMaterialRevisions(REVIEW, ORG)
    expect(observations).toMatchObject([
      { observationSequence: 1, materialRevision: 1, contentState: 'source_expired' },
      { observationSequence: 2, materialRevision: 1, contentState: 'active' },
    ])
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({
      revision: 1,
      contentState: 'active',
      rating: 4,
      normalizedText: 'Original review',
    })
  })

  it('carries one provider identity and its current material state into a newer source epoch', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const initial = review(REFRESHED_UNTIL)
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
      '7'.repeat(64),
      'ongoing',
    )
    const replyObservations = createGoogleReplyObservationStore(getDb(), events)
    await replyObservations.record({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      sourceEpoch: 0,
      materialReviewRevision: created.sourceRevision,
      readGeneration: 1,
      observationKey: '9'.repeat(64),
      source: 'provider_snapshot',
      observedText: null,
      providerUpdatedAt: null,
      observedAt: OBSERVED_AT,
      contentExpiresAt: REFRESHED_UNTIL,
    })
    await getPool().query(
      `UPDATE properties
       SET source_epoch = 1
       WHERE id = $1 AND organization_id = $2`,
      [PROPERTY, ORG],
    )
    const repository = createReviewRepository(getDb(), () => OBSERVED_AT)

    const carried = await store.upsertAndRecord(
      {
        ...initial,
        sourceEpoch: 1,
        analysisSequence: created.analysisSequence,
      },
      (persisted) =>
        reviewUpdated({
          reviewId: persisted.id,
          propertyId: persisted.propertyId,
          organizationId: persisted.organizationId,
          platform: persisted.platform,
          sourceEpoch: persisted.sourceEpoch,
          sourceRevision: persisted.sourceRevision,
          analysisSequence: persisted.analysisSequence,
          occurredAt: new Date('2026-09-05T12:00:00.000Z'),
        }),
      new Date('2026-09-05T12:00:00.000Z'),
      '8'.repeat(64),
      'ongoing',
    )
    await replyObservations.record({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW,
      sourceEpoch: 1,
      materialReviewRevision: carried.sourceRevision,
      readGeneration: 2,
      observationKey: 'a'.repeat(64),
      source: 'provider_snapshot',
      observedText: null,
      providerUpdatedAt: null,
      observedAt: new Date('2026-09-05T12:00:00.000Z'),
      contentExpiresAt: REFRESHED_UNTIL,
    })

    expect(carried).toMatchObject({
      id: REVIEW,
      propertyId: PROPERTY,
      sourceEpoch: 1,
      sourceRevision: 2,
    })
    const currentRows = await getPool().query<{
      review_epoch: number
      content_epoch: number
      revision_epoch: number
    }>(
      `SELECT review.source_epoch AS review_epoch,
              content.source_epoch AS content_epoch,
              revision.source_epoch AS revision_epoch
       FROM reviews AS review
       INNER JOIN review_source_contents AS content
         ON content.review_id = review.id
       INNER JOIN material_review_revisions AS revision
         ON revision.review_id = review.id
        AND revision.revision = review.source_revision
       WHERE review.organization_id = $1
         AND review.id = $2`,
      [ORG, REVIEW],
    )
    expect(currentRows.rows).toEqual([
      {
        review_epoch: 1,
        content_epoch: 1,
        revision_epoch: 1,
      },
    ])
    const materialHistory = await getPool().query<{
      source_epoch: number
      revision: string
    }>(
      `SELECT source_epoch, revision
       FROM material_review_revisions
       WHERE review_id = $1
       ORDER BY revision`,
      [REVIEW],
    )
    expect(materialHistory.rows).toEqual([
      { source_epoch: 0, revision: '1' },
      { source_epoch: 1, revision: '2' },
    ])
    const replyHistory = await getPool().query<{
      source_epoch: number
      material_review_revision: string
    }>(
      `SELECT source_epoch, material_review_revision
       FROM google_reply_observations
       WHERE review_id = $1
       ORDER BY observation_revision`,
      [REVIEW],
    )
    expect(replyHistory.rows).toEqual([
      { source_epoch: 0, material_review_revision: '1' },
      { source_epoch: 1, material_review_revision: '2' },
    ])

    const history = createReviewObservationRepository(getDb())
    await expect(history.findObservations(REVIEW, ORG)).resolves.toMatchObject([
      { sourceEpoch: 0, materialRevision: 1, comparison: 'initial_material_revision' },
      { sourceEpoch: 1, materialRevision: 2, comparison: 'unchanged' },
    ])
    const authority = createReviewResponseTargetAuthority(getDb())
    await expect(
      authority.withExactCurrent(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 1,
        },
        async (permit) => permit.materialReviewRevision,
      ),
    ).resolves.toEqual({ status: 'current', value: 2 })
    await expect(
      authority.withExactCurrent(
        {
          organizationId: ORG,
          propertyId: PROPERTY,
          reviewId: REVIEW,
          sourceEpoch: 0,
        },
        async () => 'must-not-run',
      ),
    ).resolves.toEqual({ status: 'obsolete' })
    await expect(
      repository.upsert(
        {
          ...initial,
          analysisSequence: carried.analysisSequence,
        },
        new Date('2026-09-05T12:01:00.000Z'),
        '6'.repeat(64),
        'ongoing',
      ),
    ).rejects.toThrow('Review stable identity scope collision')
  })

  it('re-observes an expired provider identity from a superseded source epoch', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const initial = review(EXPIRED_AT)
    await store.upsertAndRecord(
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
      '9'.repeat(64),
      'ongoing',
    )
    await getPool().query(
      `UPDATE properties
       SET source_epoch = 1
       WHERE id = $1 AND organization_id = $2`,
      [PROPERTY, ORG],
    )

    const refreshed = await store.reobserveExpiredAndRecord(
      {
        ...initial,
        sourceEpoch: 1,
        sourceUpdatedAt: new Date('2026-08-20T12:00:00.000Z'),
        lastFetchedAt: new Date('2026-09-05T12:00:00.000Z'),
        contentExpiresAt: REFRESHED_UNTIL,
      },
      OBSERVED_AT,
      'a'.repeat(64),
      'ongoing',
    )

    expect(refreshed).toMatchObject({
      id: REVIEW,
      sourceEpoch: 1,
      sourceRevision: 2,
      analysisSequence: 1,
    })
    const history = createReviewObservationRepository(getDb())
    await expect(history.findObservations(REVIEW, ORG)).resolves.toMatchObject([
      {
        sourceEpoch: 0,
        materialRevision: 1,
        contentState: 'active',
      },
      {
        sourceEpoch: 1,
        materialRevision: 2,
        contentState: 'active',
      },
    ])
    const heads = await getPool().query<{ source_epoch: number; head_sequence: string }>(
      `SELECT source_epoch, head_sequence
       FROM review_ai_analysis_heads
       WHERE organization_id = $1 AND property_id = $2
       ORDER BY source_epoch`,
      [ORG, PROPERTY],
    )
    expect(heads.rows).toEqual([
      { source_epoch: 0, head_sequence: '1' },
      { source_epoch: 1, head_sequence: '1' },
    ])
  })

  it('fails closed when one provider identity is presented in another Property scope', async () => {
    const store = createAtomicReviewCommandStore(getDb(), events, () => new Date())
    const initial = review(REFRESHED_UNTIL)
    await store.upsertAndRecord(
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
      'c'.repeat(64),
    )

    await expect(
      store.upsertAndRecord(
        {
          ...initial,
          id: OTHER_REVIEW,
          propertyId: OTHER_PROPERTY,
        },
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
        'd'.repeat(64),
      ),
    ).rejects.toThrow('scope collision')

    const persisted = await getPool().query<{ id: string; property_id: string }>(
      `SELECT id, property_id FROM reviews
       WHERE organization_id = $1 AND external_id = $2`,
      [ORG, initial.externalId],
    )
    expect(persisted.rows).toEqual([{ id: REVIEW, property_id: PROPERTY }])
  })
})
