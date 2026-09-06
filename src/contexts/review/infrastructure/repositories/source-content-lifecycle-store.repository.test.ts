import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, reviewId, type ReviewId } from '#/shared/domain/ids'
import type { Review } from '../../domain/types'
import { reviewCreated } from '../../domain/events'
import { createAtomicReviewCommandStore } from '../review-command-store'
import { eraseReviewSourceContent } from '../review-source-content-store'
import { createGoogleReplyObservationStore } from '../google-reply-observation-store'
import { sha256Hex } from '#/shared/domain/sha256'
import { createReviewSourceContentLifecycleStore } from './source-content-lifecycle-store.repository'

const ORG = organizationId('review-lifecycle-store-org-a')
const OTHER_ORG = organizationId('review-lifecycle-store-org-b')
const PROPERTY = propertyId('b9000000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('b9000000-0000-4000-8000-000000000002')
const MATCHED = reviewId('b9000000-0000-4000-8000-000000000011')
const DRIFTED = reviewId('b9000000-0000-4000-8000-000000000012')
const TOMBSTONE = reviewId('b9000000-0000-4000-8000-000000000013')
const STALE_REPLY_HEAD = reviewId('b9000000-0000-4000-8000-000000000014')
const OBSERVED_AT = new Date('2026-08-26T10:00:00.000Z')
const REOBSERVED_AT = new Date('2026-08-26T22:00:00.000Z')
const EXPIRED_AT = new Date('2026-08-26T12:00:00.000Z')
const EXPIRES_AT = new Date('2026-09-25T10:00:00.000Z')
const EVALUATED_AT = new Date('2026-08-26T20:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'outbox_events',
    'google_reply_observation_heads',
    'google_reply_observations',
    'inbox_items',
    'replies',
    'review_source_observations',
    'material_review_revisions',
    'review_source_contents',
    'review_ai_analysis_heads',
    'reviews',
  ],
})

function review(id: ReviewId, ordinal: number): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id,
    organizationId: ORG,
    propertyId: PROPERTY,
    platform: 'google',
    externalId: `provider-review-${ordinal}`,
    externalLocationId: 'locations/review-lifecycle-store',
    googleConnectionId: null,
    reviewerName: `Guest ${ordinal}`,
    reviewerProfilePhotoUrl: null,
    rating: 4,
    text: `Original review ${ordinal}`,
    translatedText: null,
    languageCode: 'en',
    reviewedAt: new Date(`2026-08-${10 + ordinal}T10:00:00.000Z`),
    expiresAt: EXPIRES_AT,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: new Date(`2026-08-${10 + ordinal}T10:00:00.000Z`),
    sourceUpdatedAt: null,
    firstFetchedAt: OBSERVED_AT,
    lastFetchedAt: OBSERVED_AT,
    contentExpiresAt: EXPIRES_AT,
    contentHash: `content-${ordinal}`,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 17,
    aiSourceDigest: String(ordinal).repeat(64),
  }
}

async function seedReview(id: ReviewId, ordinal: number): Promise<Review> {
  const commandStore = createAtomicReviewCommandStore(getDb(), () => new Date())
  return commandStore.upsertAndRecord(
    review(id, ordinal),
    (persisted) =>
      reviewCreated({
        reviewId: persisted.id,
        organizationId: persisted.organizationId,
        propertyId: persisted.propertyId,
        platform: persisted.platform,
        sourceEpoch: persisted.sourceEpoch,
        sourceRevision: persisted.sourceRevision,
        analysisSequence: persisted.analysisSequence,
        occurredAt: OBSERVED_AT,
      }),
    OBSERVED_AT,
    String(ordinal).repeat(64),
  )
}

async function markExpired(id: ReviewId): Promise<void> {
  await getPool().query('UPDATE reviews SET content_expires_at = $2 WHERE id = $1', [
    id,
    EXPIRED_AT,
  ])
  await getPool().query(
    'UPDATE review_source_contents SET content_expires_at = $2 WHERE review_id = $1',
    [id, EXPIRED_AT],
  )
  await getPool().query(
    'UPDATE review_source_observations SET content_expires_at = $2 WHERE review_id = $1',
    [id, EXPIRED_AT],
  )
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  vi.clearAllMocks()
  await getPool().query(
    `DELETE FROM retention_runs
     WHERE subject IN (
       'reviews.purge', 'reviews.purge.connection',
       'reviews.purge.property', 'reviews.purge.organization'
     )`,
  )
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Lifecycle property', 'review-lifecycle-store', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Other lifecycle property', 'review-lifecycle-store-other', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [OTHER_PROPERTY, OTHER_ORG],
  )
})

describe('Review source-content lifecycle store (real PostgreSQL)', () => {
  it('returns content-free parity findings, resumes by stable cursor, and repairs tombstone drift', async () => {
    await seedReview(MATCHED, 1)
    await seedReview(DRIFTED, 2)
    const tombstone = await seedReview(TOMBSTONE, 3)

    await getPool().query(
      `UPDATE reviews SET text = 'compatibility drift' WHERE id = $1`,
      [DRIFTED],
    )
    await getDb().transaction((tx) =>
      eraseReviewSourceContent(tx, {
        reviewId: TOMBSTONE,
        organizationId: ORG,
        propertyId: PROPERTY,
        sourceEpoch: tombstone.sourceEpoch,
        expectedSourceRevision: tombstone.sourceRevision,
        state: 'source_expired',
      }),
    )
    await getPool().query(
      `INSERT INTO review_source_contents (
         review_id, organization_id, property_id, platform, external_id,
         external_location_id, reviewer_name, rating, text, reviewed_at,
         first_fetched_at, last_fetched_at, content_expires_at, content_hash,
         source_epoch, source_revision, ai_source_byte_length, ai_source_digest
       ) VALUES (
         $1, $2, $3, 'google', 'residual-provider-review',
         'locations/review-lifecycle-store', 'Residual guest', 1, 'residual text',
         $4, $4, $4, $5, 'residual-hash', 0, 1, 17, $6
       )`,
      [TOMBSTONE, ORG, PROPERTY, OBSERVED_AT, EXPIRES_AT, 'f'.repeat(64)],
    )
    await getPool().query(
      `INSERT INTO replies (id, review_id, organization_id, text, status, source)
       VALUES ('b9000000-0000-4000-8000-000000000099', $1, $2,
               'provider mirror', 'published', 'google_sync')`,
      [TOMBSTONE, ORG],
    )

    const store = createReviewSourceContentLifecycleStore(getDb())
    const rows = await store.readInspectionBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 100,
      scope: { kind: 'expired', organizationId: ORG },
    })

    const ownedRows = rows.filter((row) =>
      ([MATCHED, DRIFTED, TOMBSTONE] as readonly ReviewId[]).includes(row.reviewId),
    )
    expect(ownedRows.map((row) => row.reviewId)).toEqual([MATCHED, DRIFTED, TOMBSTONE])
    expect(rows.find((row) => row.reviewId === MATCHED)).toMatchObject({
      sourceContentState: 'active',
      lifecycleClock: EXPIRES_AT,
      shadowFindings: [],
    })
    expect(rows.find((row) => row.reviewId === DRIFTED)?.shadowFindings).toEqual([
      'active_compatibility_drift',
    ])
    expect(rows.find((row) => row.reviewId === TOMBSTONE)).toMatchObject({
      sourceContentState: 'source_expired',
      lifecycleClock: null,
      shadowFindings: [
        'tombstone_source_cache_present',
        'tombstone_google_sync_reply_present',
      ],
    })
    expect(JSON.stringify(rows)).not.toContain('Original review')
    expect(JSON.stringify(rows)).not.toContain('Residual guest')

    const first = ownedRows[0]!
    const resumed = await store.readInspectionBatch({
      evaluatedAt: EVALUATED_AT,
      after: { createdAt: first.createdAt, reviewId: first.reviewId },
      limit: 100,
      scope: { kind: 'expired', organizationId: ORG },
    })
    expect(
      resumed
        .map((row) => row.reviewId)
        .filter((id) =>
          ([MATCHED, DRIFTED, TOMBSTONE] as readonly ReviewId[]).includes(id),
        ),
    ).toEqual([DRIFTED, TOMBSTONE])

    const repaired = await store.applyLifecycleBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })
    expect(repaired).toMatchObject({ rowsRedacted: 1 })
    const repairProof = await getPool().query(
      `SELECT
         (SELECT count(*)::int FROM review_source_contents
          WHERE review_id = $1) AS source_cache_count,
         (SELECT count(*)::int FROM replies
          WHERE review_id = $1 AND source = 'google_sync') AS mirror_count,
         (SELECT count(*)::int FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.source_transitioned') AS transition_count,
         (SELECT count(*)::int FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.created') AS created_fact_count,
         (SELECT count(*)::int FROM retention_runs
          WHERE subject = 'reviews.purge' AND rows_redacted = 1) AS evidence_count`,
      [TOMBSTONE],
    )
    expect(repairProof.rows[0]).toMatchObject({
      source_cache_count: 0,
      mirror_count: 0,
      transition_count: 0,
      evidence_count: 1,
    })
  })

  it('excludes Reviews created beyond the frozen report window', async () => {
    await seedReview(MATCHED, 1)
    const store = createReviewSourceContentLifecycleStore(getDb())

    const rows = await store.readInspectionBatch({
      evaluatedAt: new Date('2000-01-01T00:00:00.000Z'),
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })

    expect(rows).toEqual([])
  })

  it('atomically redacts one expired batch while preserving stable Review, internal Reply, Inbox, and lifecycle facts', async () => {
    await seedReview(MATCHED, 1)
    await markExpired(MATCHED)
    await getPool().query(
      `INSERT INTO review_source_observations (
         review_id, observation_sequence, organization_id, property_id,
         source_epoch, observation_key, observation_digest, material_revision,
         observed_at, content_expires_at, source_created_at, source_updated_at,
         source_digest, normalization_version, normalized_digest,
         comparison_result, rating, original_text, translated_text,
         language_code, reviewer_name, reviewer_profile_photo_url, reviewed_at
       )
       SELECT
         review_id, observation_sequence + 100, organization_id, property_id,
         source_epoch + 1, $2, $3, material_revision,
         observed_at, content_expires_at, source_created_at, source_updated_at,
         source_digest, normalization_version, normalized_digest,
         'unchanged', rating, 'Historical epoch provider text', translated_text,
         language_code, reviewer_name, reviewer_profile_photo_url, reviewed_at
       FROM review_source_observations
       WHERE review_id = $1 AND source_epoch = 0`,
      [MATCHED, '7'.repeat(64), '8'.repeat(64)],
    )
    await getPool().query(
      `INSERT INTO replies (id, review_id, organization_id, text, status, source)
       VALUES
         ('b9000000-0000-4000-8000-000000000091', $1, $2,
          'Manager-owned reply', 'draft', 'internal'),
         ('b9000000-0000-4000-8000-000000000092', $1, $2,
          'Legacy provider mirror', 'published', 'google_sync')`,
      [MATCHED, ORG],
    )
    await getPool().query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id, status, source_date
       ) VALUES (
         'b9000000-0000-4000-8000-000000000093', $1, $2,
         'review', $3, 'open', $4
       )`,
      [ORG, PROPERTY, MATCHED, OBSERVED_AT],
    )

    const store = createReviewSourceContentLifecycleStore(getDb())
    const first = await store.applyLifecycleBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })
    const replay = await store.applyLifecycleBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })

    expect(first).toMatchObject({
      hasMore: false,
      rowsRedacted: 1,
      legacyGoogleRepliesReconciled: 0,
    })
    expect(replay).toMatchObject({ rowsRedacted: 0 })
    expect(JSON.stringify(first)).not.toContain('Manager-owned reply')
    expect(JSON.stringify(first)).not.toContain('Legacy provider mirror')

    const proof = await getPool().query(
      `SELECT
         (SELECT count(*)::int FROM reviews WHERE id = $1::uuid) AS review_count,
         (SELECT count(*)::int FROM replies
          WHERE review_id = $1::uuid AND source = 'internal') AS internal_reply_count,
         (SELECT count(*)::int FROM replies
          WHERE review_id = $1::uuid AND source = 'google_sync') AS mirror_count,
         (SELECT count(*)::int FROM inbox_items
          WHERE source_id = $1::uuid) AS inbox_count,
         (SELECT count(*)::int FROM review_source_contents
          WHERE review_id = $1::uuid) AS source_cache_count,
         (SELECT count(*)::int FROM review_source_observations
          WHERE review_id = $1::uuid AND content_state = 'active') AS active_observation_count,
         (SELECT count(*)::int FROM review_source_observations
          WHERE review_id = $1::uuid) AS observation_identity_count,
         (SELECT count(*)::int FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.source_transitioned') AS transition_count,
         (SELECT count(*)::int FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.created') AS created_fact_count,
         (SELECT count(*)::int FROM retention_runs
          WHERE subject = 'reviews.purge' AND rows_redacted = 1) AS evidence_count,
         (SELECT source_content_state FROM reviews WHERE id = $1::uuid) AS state,
         (SELECT analysis_sequence::int FROM reviews WHERE id = $1::uuid)
           AS review_analysis_sequence,
         (SELECT (payload->>'analysisSequence')::int FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.source_transitioned'
          ORDER BY created_at DESC LIMIT 1) AS event_analysis_sequence,
         (SELECT source_content_erased_at FROM reviews WHERE id = $1::uuid)
           AS source_content_erased_at,
         (SELECT (payload->>'occurredAt')::timestamptz FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.source_transitioned'
          ORDER BY created_at DESC LIMIT 1) AS event_occurred_at,
         (SELECT text FROM reviews WHERE id = $1::uuid) AS review_text`,
      [MATCHED],
    )
    expect(proof.rows[0]).toMatchObject({
      review_count: 1,
      internal_reply_count: 1,
      mirror_count: 0,
      inbox_count: 1,
      source_cache_count: 0,
      active_observation_count: 0,
      observation_identity_count: 2,
      transition_count: 1,
      created_fact_count: 1,
      evidence_count: 1,
      state: 'source_expired',
      review_text: null,
    })
    expect(proof.rows[0]?.review_analysis_sequence).toBe(
      proof.rows[0]?.event_analysis_sequence,
    )
    expect(new Date(String(proof.rows[0]?.source_content_erased_at)).getTime()).toBe(
      new Date(String(proof.rows[0]?.event_occurred_at)).getTime(),
    )
  })

  it('serializes concurrent apply replays so one transition and one redaction land', async () => {
    await seedReview(MATCHED, 1)
    await markExpired(MATCHED)
    const store = createReviewSourceContentLifecycleStore(getDb())
    const input = {
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired' as const, organizationId: ORG },
    }

    const results = await Promise.all([
      store.applyLifecycleBatch(input),
      store.applyLifecycleBatch(input),
    ])

    expect(results.map((result) => result.rowsRedacted).sort()).toEqual([0, 1])
    const facts = await getPool().query(
      `SELECT count(*)::int AS count FROM outbox_events
       WHERE source_aggregate_id = $1::text
         AND event_type = 'review.source_transitioned'`,
      [MATCHED],
    )
    expect(facts.rows[0]?.count).toBe(1)
  })

  it('fails closed before mutation when the apply window is ahead of the database clock', async () => {
    await seedReview(MATCHED, 1)
    await markExpired(MATCHED)

    await expect(
      createReviewSourceContentLifecycleStore(getDb()).applyLifecycleBatch({
        evaluatedAt: new Date('2099-01-01T00:00:00.000Z'),
        after: null,
        limit: 10,
        scope: { kind: 'expired', organizationId: ORG },
      }),
    ).rejects.toThrow('apply window is ahead of the database clock')

    const proof = await getPool().query(
      `SELECT
         (SELECT source_content_state FROM reviews WHERE id = $1) AS state,
         (SELECT count(*)::int FROM retention_runs
          WHERE subject = 'reviews.purge') AS evidence_count`,
      [MATCHED],
    )
    expect(proof.rows[0]).toMatchObject({ state: 'active', evidence_count: 0 })
  })

  it('does not expire an active Review when its canonical source-cache clock is missing', async () => {
    await seedReview(MATCHED, 1)
    await getPool().query('UPDATE reviews SET content_expires_at = $2 WHERE id = $1', [
      MATCHED,
      EXPIRED_AT,
    ])
    await getPool().query('DELETE FROM review_source_contents WHERE review_id = $1', [
      MATCHED,
    ])

    const store = createReviewSourceContentLifecycleStore(getDb())
    const before = await store.readInspectionBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })
    expect(before.find((row) => row.reviewId === MATCHED)).toMatchObject({
      lifecycleClock: null,
      shadowFindings: expect.arrayContaining(['active_source_cache_missing']),
    })

    const result = await store.applyLifecycleBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })

    expect(result.rowsRedacted).toBe(0)
    const proof = await getPool().query(
      `SELECT source_content_state, text
       FROM reviews WHERE id = $1`,
      [MATCHED],
    )
    expect(proof.rows[0]).toMatchObject({
      source_content_state: 'active',
      text: 'Original review 1',
    })
  })

  it('rolls back the whole page, including evidence, when any Review transition fails', async () => {
    await seedReview(MATCHED, 1)
    await seedReview(DRIFTED, 2)
    await markExpired(MATCHED)
    await markExpired(DRIFTED)
    await getPool().query(`
      CREATE OR REPLACE FUNCTION fail_review_lifecycle_test_transition()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id = '${DRIFTED}'::uuid AND NEW.source_content_state <> 'active' THEN
          RAISE EXCEPTION 'forced lifecycle page failure';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER fail_review_lifecycle_test_transition_trigger
      BEFORE UPDATE ON reviews
      FOR EACH ROW EXECUTE FUNCTION fail_review_lifecycle_test_transition();
    `)
    try {
      await expect(
        createReviewSourceContentLifecycleStore(getDb()).applyLifecycleBatch({
          evaluatedAt: EVALUATED_AT,
          after: null,
          limit: 10,
          scope: { kind: 'expired', organizationId: ORG },
        }),
      ).rejects.toMatchObject({
        cause: { message: 'forced lifecycle page failure' },
      })
    } finally {
      await getPool().query(
        `DROP TRIGGER IF EXISTS fail_review_lifecycle_test_transition_trigger ON reviews;
         DROP FUNCTION IF EXISTS fail_review_lifecycle_test_transition();`,
      )
    }

    const reviews = await getPool().query(
      `SELECT id, source_content_state, text FROM reviews
       WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[MATCHED, DRIFTED]],
    )
    expect(reviews.rows).toMatchObject([
      { id: MATCHED, source_content_state: 'active', text: 'Original review 1' },
      { id: DRIFTED, source_content_state: 'active', text: 'Original review 2' },
    ])
    const evidence = await getPool().query(
      `SELECT count(*)::int AS count FROM retention_runs
       WHERE subject = 'reviews.purge'`,
    )
    expect(evidence.rows[0]?.count).toBe(0)
  })

  it('reconciles only a legacy Google mirror backed by governed current observation truth', async () => {
    const matched = await seedReview(MATCHED, 1)
    await seedReview(DRIFTED, 2)
    const staleHead = await seedReview(STALE_REPLY_HEAD, 3)
    await createGoogleReplyObservationStore(getDb()).record({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: MATCHED,
      sourceEpoch: matched.sourceEpoch,
      materialReviewRevision: matched.sourceRevision,
      readGeneration: 1,
      observationKey: sha256Hex('lifecycle-google-reply-observation'),
      source: 'provider_snapshot',
      observedText: 'Governed current provider reply',
      providerUpdatedAt: OBSERVED_AT,
      observedAt: OBSERVED_AT,
      contentExpiresAt: EXPIRES_AT,
    })
    await createGoogleReplyObservationStore(getDb()).record({
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: STALE_REPLY_HEAD,
      sourceEpoch: staleHead.sourceEpoch,
      materialReviewRevision: staleHead.sourceRevision,
      readGeneration: 2,
      observationKey: sha256Hex('lifecycle-stale-google-reply-observation'),
      source: 'provider_snapshot',
      observedText: 'Governed but stale provider reply',
      providerUpdatedAt: OBSERVED_AT,
      observedAt: OBSERVED_AT,
      contentExpiresAt: EXPIRES_AT,
    })
    await getPool().query(
      `UPDATE reviews SET source_revision = source_revision + 1 WHERE id = $1`,
      [STALE_REPLY_HEAD],
    )
    await getPool().query(
      `INSERT INTO replies (id, review_id, organization_id, text, status, source)
       VALUES
         ('b9000000-0000-4000-8000-000000000094', $1, $3,
          'Stale duplicate mirror', 'published', 'google_sync'),
         ('b9000000-0000-4000-8000-000000000095', $2, $3,
          'Only legacy provider truth', 'published', 'google_sync'),
         ('b9000000-0000-4000-8000-000000000097', $4, $3,
          'Mirror with stale governed head', 'published', 'google_sync')`,
      [MATCHED, DRIFTED, ORG, STALE_REPLY_HEAD],
    )
    const before = await createReviewSourceContentLifecycleStore(
      getDb(),
    ).readInspectionBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })
    expect(before.find((row) => row.reviewId === MATCHED)?.shadowFindings).toContain(
      'active_google_sync_reply_redundant',
    )
    expect(before.find((row) => row.reviewId === DRIFTED)?.shadowFindings).toContain(
      'active_google_sync_reply_unreconciled',
    )
    expect(
      before.find((row) => row.reviewId === STALE_REPLY_HEAD)?.shadowFindings,
    ).toContain('active_google_sync_reply_unreconciled')

    const result = await createReviewSourceContentLifecycleStore(
      getDb(),
    ).applyLifecycleBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })

    expect(result).toMatchObject({
      rowsRedacted: 1,
      legacyGoogleRepliesReconciled: 1,
    })
    const mirrors = await getPool().query(
      `SELECT review_id, text FROM replies
       WHERE organization_id = $1 AND source = 'google_sync'`,
      [ORG],
    )
    expect(mirrors.rows).toEqual(
      expect.arrayContaining([
        { review_id: DRIFTED, text: 'Only legacy provider truth' },
        {
          review_id: STALE_REPLY_HEAD,
          text: 'Mirror with stale governed head',
        },
      ]),
    )
    expect(mirrors.rows).toHaveLength(2)
    const evidence = await getPool().query(
      `SELECT rows_redacted FROM retention_runs
       WHERE subject = 'reviews.purge'
       ORDER BY id DESC LIMIT 1`,
    )
    expect(evidence.rows).toEqual([expect.objectContaining({ rows_redacted: 1 })])
  })

  it('serializes lifecycle apply with re-observation and restores onto the same stable Review', async () => {
    const original = await seedReview(MATCHED, 1)
    await markExpired(MATCHED)
    await getPool().query(
      `INSERT INTO replies (id, review_id, organization_id, text, status, source)
       VALUES ('b9000000-0000-4000-8000-000000000096', $1, $2,
               'Retained manager draft', 'draft', 'internal')`,
      [MATCHED, ORG],
    )

    const freshInput = {
      ...review(MATCHED, 1),
      text: 'Fresh provider re-observation',
      lastFetchedAt: REOBSERVED_AT,
      contentHash: 'fresh-content-hash',
      aiSourceByteLength: 29,
      aiSourceDigest: 'e'.repeat(64),
    }
    const restore = createAtomicReviewCommandStore(
      getDb(),
      () => new Date(),
    ).reobserveExpiredAndRecord(freshInput, REOBSERVED_AT, 'e'.repeat(64))
    const lifecycle = createReviewSourceContentLifecycleStore(
      getDb(),
    ).applyLifecycleBatch({
      evaluatedAt: EVALUATED_AT,
      after: null,
      limit: 10,
      scope: { kind: 'expired', organizationId: ORG },
    })
    const [restored, lifecycleResult] = await Promise.all([restore, lifecycle])

    expect(lifecycleResult.rowsRedacted).toBeGreaterThanOrEqual(0)
    expect(lifecycleResult.rowsRedacted).toBeLessThanOrEqual(1)
    expect(restored).toMatchObject({
      id: MATCHED,
      createdAt: original.createdAt,
      text: 'Fresh provider re-observation',
    })
    const proof = await getPool().query(
      `SELECT
         (SELECT count(*)::int FROM reviews WHERE id = $1) AS review_count,
         (SELECT count(*)::int FROM replies
          WHERE review_id = $1 AND source = 'internal') AS internal_reply_count,
         (SELECT count(*)::int FROM review_source_contents
          WHERE review_id = $1 AND text = 'Fresh provider re-observation') AS source_count,
         (SELECT count(*)::int FROM review_source_observations
          WHERE review_id = $1 AND content_state = 'source_expired') AS erased_observations,
         (SELECT count(*)::int FROM review_source_observations
          WHERE review_id = $1 AND content_state = 'active') AS active_observations,
         (SELECT count(*)::int FROM outbox_events
          WHERE source_aggregate_id = $1::text
            AND event_type = 'review.source_transitioned') AS transition_count`,
      [MATCHED],
    )
    expect(proof.rows[0]).toMatchObject({
      review_count: 1,
      internal_reply_count: 1,
      source_count: 1,
      erased_observations: 1,
      active_observations: 1,
      transition_count: 1,
    })
  })
})
