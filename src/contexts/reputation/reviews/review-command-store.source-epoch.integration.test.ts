import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { createReviewResponseTargetAuthority } from '#/contexts/reputation/reviews/response-target-authority.server'
import { createReviewRepository } from './review-repository.server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { readObservationHistory } from './review-observation-history.test-fixtures'
import { createGoogleReplyObservationStore } from '../publication/google-reply-observation-store.server'
import {
  ORG,
  OTHER_ORG,
  PROPERTY,
  REVIEW,
  OTHER_PROPERTY,
  OTHER_REVIEW,
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
  clearEventSchemas()
  registerAllEventSchemas()
  vi.clearAllMocks()
  await seedReobserveProperties(getPool())
})

describe('atomic review re-observation', () => {
  it('carries one provider identity and its current material state into a newer source epoch', async () => {
    const store = testReviewCommandStore(getDb())
    const initial = review(REFRESHED_UNTIL)
    const created = await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
      OBSERVED_AT,
      '7'.repeat(64),
      'ongoing',
    )
    const replyObservations = createGoogleReplyObservationStore(getDb())
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
    const repository = createReviewRepository(
      getDb(),
      () => OBSERVED_AT,
      undefined,
      replyScopeEffects,
    )

    const carried = await store.upsertAndRecord(
      {
        ...initial,
        sourceEpoch: 1,
        analysisSequence: created.analysisSequence,
      },
      updatedEvent(new Date('2026-09-05T12:00:00.000Z')),
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

    await expect(readObservationHistory(getDb(), REVIEW, ORG)).resolves.toMatchObject([
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
    const store = testReviewCommandStore(getDb())
    const initial = review(EXPIRED_AT)
    await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
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
    await expect(readObservationHistory(getDb(), REVIEW, ORG)).resolves.toMatchObject([
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
    const store = testReviewCommandStore(getDb())
    const initial = review(REFRESHED_UNTIL)
    await store.upsertAndRecord(
      initial,
      createdEvent(OBSERVED_AT),
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
        createdEvent(OBSERVED_AT),
        OBSERVED_AT,
        'd'.repeat(64),
      ),
    ).rejects.toThrow('scope collision')

    const persisted = await getPool().query<{ id: string; property_id: string }>(
      `SELECT r.id, r.property_id FROM reviews r
         JOIN review_source_contents c ON c.review_id = r.id
        WHERE r.organization_id = $1 AND c.external_id = $2`,
      [ORG, initial.externalId],
    )
    expect(persisted.rows).toEqual([{ id: REVIEW, property_id: PROPERTY }])
  })
})
