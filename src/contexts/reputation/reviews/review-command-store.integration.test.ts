import {
  eraseReviewSourceContent,
  replyScopeEffects,
} from '#/contexts/reputation/public-api'
import { createReviewResponseTargetAuthority } from '#/contexts/reputation/reviews/response-target-authority.server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createReviewObservationRepository } from './review-observation-repository.server'
import { readObservationHistory } from './review-observation-history.test-fixtures'
import {
  ORG,
  OTHER_ORG,
  PROPERTY,
  REVIEW,
  OTHER_PROPERTY,
  OTHER_REVIEW,
  REPLY,
  OBSERVED_AT,
  EXPIRED_AT,
  REFRESHED_UNTIL,
  REOBSERVE_TABLES,
  reobserveReview as review,
  seedReobserveProperties,
} from './review-command-store.test-fixtures'
import {
  createdEvent,
  updatedEvent,
  testReviewCommandStore,
} from './review-stores.test-fixtures'

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: REOBSERVE_TABLES,
})

beforeEach(async () => {
  vi.clearAllMocks()
  await seedReobserveProperties(getPool())
})

describe('atomic review re-observation', () => {
  it('issues exact current target permits and orders a complete batch', async () => {
    const store = testReviewCommandStore(getDb())
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
        createdEvent(OBSERVED_AT),
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
    const store = testReviewCommandStore(getDb())
    const initial = review(REFRESHED_UNTIL)

    await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
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
    const store = testReviewCommandStore(getDb())
    const futureProviderTime = new Date('2026-08-25T12:05:00.000Z')
    const initial = {
      ...review(REFRESHED_UNTIL),
      sourceCreatedAt: futureProviderTime,
    }

    await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
      OBSERVED_AT,
      'f'.repeat(64),
      'ongoing',
    )

    const observations = await readObservationHistory(getDb(), REVIEW, ORG)
    const revisions = await createReviewObservationRepository(
      getDb(),
    ).findMaterialRevisions(REVIEW, ORG)
    expect(observations[0]).toMatchObject({
      sourceEpoch: 0,
      materialRevision: 1,
      originalText: null,
      translatedText: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
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
    const store = testReviewCommandStore(getDb())
    const initial = review(EXPIRED_AT)
    const created = await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
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
      `SELECT review.created_at, review.source_revision, review.analysis_sequence, content.text,
              review.source_content_state, review.source_content_erased_at
       FROM reviews AS review
       JOIN review_source_contents AS content ON content.review_id = review.id
         AND content.organization_id = review.organization_id
         AND content.property_id = review.property_id
       WHERE review.id = $1 AND review.organization_id = $2`,
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
    const observations = await readObservationHistory(getDb(), REVIEW, ORG)
    const revisions = await history.findMaterialRevisions(REVIEW, ORG)
    await expect(readObservationHistory(getDb(), REVIEW, OTHER_ORG)).resolves.toEqual([])
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
        originalText: null,
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

  // The other store entry that records a guest edit: the Review's content had
  // expired, and the re-observation finds the guest rewrote it meanwhile.
  it.each([
    ['rewritten', 'The guest rewrote it', 'draft', ['source_changed']],
    ['as it was', 'Original review', 'pending_approval', []],
  ] as const)(
    'returns a reply awaiting approval to draft only when the expired review comes back %s',
    async (_how, reobservedText, status, causes) => {
      const store = testReviewCommandStore(getDb())
      const initial = review(EXPIRED_AT)
      await store.upsertAndRecord(initial, createdEvent(OBSERVED_AT), OBSERVED_AT)
      await getPool().query(
        `INSERT INTO replies (
           id, review_id, organization_id, text, status, source, created_by,
           submitted_by, ai_generated, authorship, state_revision
         ) VALUES ($1, $2, $3, 'Sorry about the room', 'pending_approval',
           'internal', 'staff-user-1', 'staff-user-2', false, 'human', 1)`,
        [REPLY, REVIEW, ORG],
      )

      await store.reobserveExpiredAndRecord(
        {
          ...initial,
          text: reobservedText,
          lastFetchedAt: OBSERVED_AT,
          contentExpiresAt: REFRESHED_UNTIL,
        },
        OBSERVED_AT,
      )

      const reply = await getPool().query<{ status: string; text: string }>(
        `SELECT status::text AS status, text FROM replies
          WHERE id = $1 AND organization_id = $2`,
        [REPLY, ORG],
      )
      expect(reply.rows).toEqual([{ status, text: 'Sorry about the room' }])
      const cancelled = await getPool().query<{ cause: string; author_id: string }>(
        `SELECT payload->>'cause' AS cause, payload->>'authorId' AS author_id
           FROM outbox_events
          WHERE organization_id = $1
            AND event_type = 'review.reply.publication_cancelled'`,
        [ORG],
      )
      expect(cancelled.rows).toEqual(
        causes.map((cause) => ({ cause, author_id: 'staff-user-2' })),
      )
    },
  )

  it('versions every observation but advances material revision only for rating or normalized original text', async () => {
    const store = testReviewCommandStore(getDb())
    const initial = {
      ...review(REFRESHED_UNTIL),
      sourceUpdatedAt: new Date('2026-08-01T12:00:00.000Z'),
    }
    const created = await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
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
      updatedEvent(OBSERVED_AT),
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
      updatedEvent(OBSERVED_AT),
      OBSERVED_AT,
      '3'.repeat(64),
      'ongoing',
    )

    const duplicateEvent = vi.fn(updatedEvent(OBSERVED_AT))
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

    const outOfOrderEvent = vi.fn(updatedEvent(OBSERVED_AT))
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
    const observations = await readObservationHistory(getDb(), REVIEW, ORG)
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
      `SELECT content.rating, content.text, review.source_revision, review.source_observation_sequence
       FROM reviews AS review
       JOIN review_source_contents AS content ON content.review_id = review.id
         AND content.organization_id = review.organization_id
         AND content.property_id = review.property_id
       WHERE review.id = $1 AND review.organization_id = $2`,
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
    const store = testReviewCommandStore(getDb())
    const initial = review(REFRESHED_UNTIL)
    const created = await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
      OBSERVED_AT,
      'a'.repeat(64),
    )
    const erased = await getDb().transaction((tx) =>
      eraseReviewSourceContent(
        tx,
        {
          reviewId: REVIEW,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceEpoch: 0,
          expectedSourceRevision: 1,
          state: 'source_expired',
        },
        replyScopeEffects,
      ),
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
    const observations = await readObservationHistory(getDb(), REVIEW, ORG)
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
})
