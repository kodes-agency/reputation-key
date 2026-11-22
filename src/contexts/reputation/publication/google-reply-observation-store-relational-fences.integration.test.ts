import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { sha256Hex } from '#/shared/domain/sha256'
import { compareObservedGoogleReply } from '../domain/google-reply-observation'
import { createGoogleReplyObservationStore } from './google-reply-observation-store.server'
import {
  EXPIRES,
  NOW,
  ORG,
  PROP_A,
  PROP_B,
  REPLY_A,
  REPLY_B,
  REVIEW_A,
  REVIEW_B,
  installObservationFixture,
  observationInput,
  pool,
  seedReviewAndReply,
} from './google-reply-observation.test-fixtures'

installObservationFixture()

describe.sequential('RPL evidence-chain relational fences (real PostgreSQL)', () => {
  async function expectConstraint(
    query: string,
    values: readonly unknown[],
    constraint: string,
  ): Promise<void> {
    await expect(pool.query(query, values as unknown[])).rejects.toMatchObject({
      constraint,
    })
  }

  const attemptInsert = `
    INSERT INTO reply_publication_attempts
      (organization_id, property_id, review_id, reply_id, publication_cycle,
       attempt_number, provider_operation_key, source_epoch,
       material_review_revision, reply_state_revision,
       normalization_version, expected_reply_digest, outcome)
    VALUES ($1, $2, $3, $4, 1, 1, $5, $6, $7, 1,
            'google-reply-v1', $8, 'sending')`

  const observationInsert = `
    INSERT INTO google_reply_observations
      (organization_id, property_id, review_id, observation_revision,
       observation_key, input_digest, source_epoch, material_review_revision,
       read_generation, state, change, resolution, source, provenance, normalized_text,
       normalization_version, normalized_digest, matched_reply_id,
       matched_publication_cycle, matched_attempt_number, observed_at,
       content_expires_at)
    VALUES ($1, $2, $3, 1, $4, $5, $6, $7, 1, 'live', 'added', $8,
            'targeted_reconciliation', $9, 'reply', 'google-reply-v1', $10,
            $11, $12, $13, $14, $15)`

  const attemptRow = (
    fields: Readonly<{
      propertyId?: typeof PROP_A | typeof PROP_B
      replyId?: typeof REPLY_A | typeof REPLY_B
      key: string
      materialRevision: number
    }>,
  ): unknown[] => [
    ORG,
    fields.propertyId ?? PROP_A,
    REVIEW_A,
    fields.replyId ?? REPLY_A,
    fields.key,
    0,
    fields.materialRevision,
    'a'.repeat(64),
  ]

  const observationRow = (
    fields: Readonly<{
      propertyId?: typeof PROP_A | typeof PROP_B
      materialRevision?: number
      resolution?: string
      provenance?: string
      matchedReplyId?: typeof REPLY_A | null
      matchedCycle?: number | null
      matchedAttempt?: number | null
    }> = {},
  ): unknown[] => [
    ORG,
    fields.propertyId ?? PROP_A,
    REVIEW_A,
    '1'.repeat(64),
    '2'.repeat(64),
    0,
    fields.materialRevision ?? 1,
    fields.resolution ?? 'external_current_live',
    fields.provenance ?? 'external_or_unknown',
    '3'.repeat(64),
    fields.matchedReplyId ?? null,
    fields.matchedCycle ?? null,
    fields.matchedAttempt ?? null,
    NOW,
    EXPIRES,
  ]

  const insertFences: ReadonlyArray<{
    title: string
    seed: 'one' | 'two' | 'claimed'
    query: string
    params: unknown[]
    constraint: string
  }> = [
    {
      title: 'rejects an attempt cross-wired to another Review tenant tuple',
      seed: 'one',
      query: attemptInsert,
      params: attemptRow({
        propertyId: PROP_B,
        key: 'bad-review-scope',
        materialRevision: 1,
      }),
      constraint: 'reply_publication_attempts_review_tenant_fk',
    },
    {
      title: 'rejects an attempt cross-wired to a Reply owned by another Review',
      seed: 'two',
      query: attemptInsert,
      params: attemptRow({
        replyId: REPLY_B,
        key: 'bad-reply-binding',
        materialRevision: 1,
      }),
      constraint: 'reply_publication_attempts_reply_binding_fk',
    },
    {
      title: 'rejects an attempt cross-wired to a nonexistent material revision',
      seed: 'one',
      query: attemptInsert,
      params: attemptRow({ key: 'bad-material', materialRevision: 2 }),
      constraint: 'reply_publication_attempts_material_revision_fk',
    },
    {
      title: 'rejects an observation cross-wired to another property',
      seed: 'one',
      query: observationInsert,
      params: observationRow({ propertyId: PROP_B }),
      constraint: 'google_reply_observations_review_tenant_fk',
    },
    {
      title: 'rejects an observation cross-wired to a nonexistent material revision',
      seed: 'one',
      query: observationInsert,
      params: observationRow({ materialRevision: 2 }),
      constraint: 'google_reply_observations_material_revision_fk',
    },
    {
      title: 'rejects a claimed match that does not identify one exact attempt',
      seed: 'claimed',
      query: observationInsert,
      params: observationRow({
        resolution: 'confirmed_on_google',
        provenance: 'repkey_confirmed',
        matchedReplyId: REPLY_A,
        matchedCycle: 1,
        matchedAttempt: 99,
      }),
      constraint: 'google_reply_observations_matched_attempt_fk',
    },
    {
      title: 'requires matched Reply, cycle, and attempt fields all together',
      seed: 'one',
      query: observationInsert,
      params: observationRow({ matchedReplyId: REPLY_A }),
      constraint: 'google_reply_observations_match_valid',
    },
    {
      title: 'rejects a relationally impossible live observation resolution',
      seed: 'one',
      query: observationInsert.replace("'live', 'added'", "'live', 'deleted'"),
      params: observationRow(),
      constraint: 'google_reply_observations_semantics_valid',
    },
  ]

  it.each(insertFences)('$title', async ({ seed, query, params, constraint }) => {
    if (seed === 'two') {
      await seedReviewAndReply({ claim: false })
      await seedReviewAndReply({
        reviewId: REVIEW_B,
        replyId: REPLY_B,
        externalId: 'external-review-b',
        claim: false,
      })
    } else {
      await seedReviewAndReply(seed === 'claimed' ? {} : { claim: false })
    }
    await expectConstraint(query, params, constraint)
  })

  it('binds every head field to the same exact observation row', async () => {
    const { review } = await seedReviewAndReply({ claim: false })
    await createGoogleReplyObservationStore(getDb()).record(observationInput(review))
    await expectConstraint(
      `UPDATE google_reply_observation_heads
       SET provenance = 'none' WHERE review_id = $1`,
      [REVIEW_A],
      'google_reply_observation_heads_exact_observation_fk',
    )
  })

  it('binds attempt confirmation to an observation from that exact Review', async () => {
    await seedReviewAndReply({})
    const { review: otherReview } = await seedReviewAndReply({
      reviewId: REVIEW_B,
      replyId: REPLY_B,
      externalId: 'external-review-b',
      claim: false,
    })
    await createGoogleReplyObservationStore(getDb()).record(
      observationInput(otherReview, {
        observationKey: sha256Hex('other-review-observation'),
      }),
    )
    await expectConstraint(
      `UPDATE reply_publication_attempts
       SET outcome = 'confirmed', confirmed_observation_revision = 1
       WHERE reply_id = $1`,
      [REPLY_A],
      'reply_publication_attempts_exact_confirmation_fk',
    )
  })

  it('rejects confirmation with an observation matched to another attempt on the same Review', async () => {
    const { review, reply } = await seedReviewAndReply({ providerPending: false })
    const digest = compareObservedGoogleReply(reply.text, reply.text).desiredDigest
    await pool.query(
      `INSERT INTO reply_publication_attempts
        (organization_id, property_id, review_id, reply_id, publication_cycle,
         attempt_number, provider_operation_key, source_epoch,
         material_review_revision, reply_state_revision,
         normalization_version, expected_reply_digest, outcome)
       VALUES ($1, $2, $3, $4, 1, 2, $5, $6, $7, $8,
               'google-reply-v1', $9, 'sending')`,
      [
        ORG,
        PROP_A,
        REVIEW_A,
        REPLY_A,
        'same-review-attempt-2',
        0,
        1,
        reply.stateRevision,
        digest,
      ],
    )
    await pool.query(observationInsert, [
      ORG,
      PROP_A,
      REVIEW_A,
      '4'.repeat(64),
      '5'.repeat(64),
      review.sourceEpoch,
      review.sourceRevision,
      'confirmed_on_google',
      'repkey_confirmed',
      digest,
      REPLY_A,
      1,
      2,
      NOW,
      EXPIRES,
    ])

    await expectConstraint(
      `UPDATE reply_publication_attempts
       SET outcome = 'confirmed', confirmed_observation_revision = 1
       WHERE reply_id = $1 AND attempt_number = 1`,
      [REPLY_A],
      'reply_publication_attempts_exact_confirmation_fk',
    )
  })
})
