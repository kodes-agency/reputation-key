// Review provider snapshot repository against real PostgreSQL.
//
// `finishMainScan` was the one repository path with no coverage against a live
// database, and it shipped two statements whose bound timestamps took part in
// interval arithmetic without a cast. PostgreSQL resolves `$n - interval` as
// `interval - interval`, so the parameter became an interval and the surrounding
// comparison had no operator:
//
//   operator does not exist: timestamp with time zone <= interval
//
// Mocked unit tests cannot see that — the type resolution happens in the server.
// The first google-closed-beta run that ever reached this path failed on it, so
// every completed scan died before writing its confirmation transition. These
// tests execute the real statements.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { properties, reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createReviewProviderSnapshotRepository } from './review-provider-snapshot.repository'
import { createReviewSourceContentLifecycleStore } from './source-content-lifecycle-store.repository'

const ORGANIZATION_ID = 'review-snapshot-repo-test-org'
const PROPERTY_ID = '72000000-0000-4000-8000-000000000001'
const RUN_ID = '72000000-0000-4000-8000-000000000002'
const OTHER_RUN_ID = '72000000-0000-4000-8000-000000000003'
const REVIEW_ID = '72000000-0000-4000-8000-000000000004'
const REPLY_ID = '72000000-0000-4000-8000-000000000005'
const LIFECYCLE_RUN_ID = '72000000-0000-4000-8000-000000000006'
const EXPIRING_REVIEW_ID = '72000000-0000-4000-8000-000000000007'
const EXPIRING_REPLY_ID = '72000000-0000-4000-8000-000000000008'
const TEST_KEY_VERSION = 'safe03-test-v1'
const STARTED_AT = new Date('2026-08-19T10:00:00.000Z')
const EXPIRES_AT = new Date('2026-08-19T22:00:00.000Z')
const PROVIDER_DELETE_GATE_CLASS = 27_127
const PROVIDER_DELETE_GATE_OBJECT = 55

async function waitForDatabaseCondition(
  description: string,
  condition: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${description}`)
}

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const db = getDb()
  const repository = createReviewProviderSnapshotRepository(db, () => RUN_ID)

  const clear = async () => {
    await db.execute(sql`
      DROP TRIGGER IF EXISTS review_provider_delete_lock_order_gate ON reviews;
      DROP FUNCTION IF EXISTS review_provider_delete_lock_order_gate();
    `)
    await db.execute(
      sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
    )
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORGANIZATION_ID}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORGANIZATION_ID}`)
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await db.execute(
      sql`DELETE FROM review_provider_subject_hmac_key_versions WHERE key_version = ${TEST_KEY_VERSION}`,
    )
    await db.execute(sql`DELETE FROM retention_runs WHERE subject = 'reviews.purge'`)
    await deleteTestOrganizations(db, [ORGANIZATION_ID])
  }

  beforeAll(async () => {
    await clear()
    clearEventSchemas()
    registerAllEventSchemas()
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${ORGANIZATION_ID}, 'Snapshot repo test', ${ORGANIZATION_ID}, ${STARTED_AT})
    `)
    await db.insert(properties).values({
      id: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Snapshot repo property',
      slug: 'snapshot-repo-property',
      timezone: 'Europe/Sofia',
      countryCode: 'BG',
      profileVersion: 1,
      // The domain default: a property that has never been edited. The AI plane
      // used to reject this value outright (see drizzle/0060).
      sourceEpoch: 0,
    })
  })

  afterAll(async () => {
    await clear()
    clearEventSchemas()
  })

  const seedCompletedMainScan = async () => {
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))
    await db.insert(reviewProviderSnapshotRuns).values({
      id: RUN_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      state: 'scanning',
      phase: 'main',
      // A finished main scan: the provider's total matches what was observed and
      // the cursor is spent, which is exactly the shape `finishMainScan` requires.
      expectedTotal: 2,
      expectedAverageRating: 4.5,
      mainPageCount: 1,
      mainUniqueCount: 2,
      mainCursorRef: null,
      startedAt: STARTED_AT,
      expiresAt: EXPIRES_AT,
    })
  }

  it('transitions a completed main scan into confirmation', async () => {
    await seedCompletedMainScan()

    const finished = await repository.finishMainScan({ runId: RUN_ID })

    expect(finished.status).toBe('confirming')
    const [row] = await db
      .select()
      .from(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))
      .limit(1)
    expect(row?.state).toBe('confirming')
    expect(row?.phase).toBe('confirmation')
    expect(row?.mainCursorRef).toBeNull()
    // startedAt + 12h, proving the deadline expression resolved as a timestamp
    // rather than collapsing into interval arithmetic.
    expect(row?.confirmationDeadline?.toISOString()).toBe('2026-08-19T22:00:00.000Z')
  })

  it('fails a main scan whose observed set is further from the provider total than a small gap', async () => {
    await seedCompletedMainScan()
    // Two of four: beyond the one-review gap a small total is allowed.
    await db
      .update(reviewProviderSnapshotRuns)
      .set({ expectedTotal: 4, mainUniqueCount: 2 })
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))

    const finished = await repository.finishMainScan({ runId: RUN_ID })

    expect(finished).toMatchObject({ status: 'failed', code: 'set_mismatch' })
  })

  const AVERAGE_DRIFT_SCOPES = [
    { state: 'scanning' as const, phase: 'main' as const },
    { state: 'confirming' as const, phase: 'confirmation' as const },
  ]

  /** A page of the run in `scope` whose average (4.5) differs from the one its
   * first page recorded (4.4). */
  const commitDriftedPage = async (scope: (typeof AVERAGE_DRIFT_SCOPES)[number]) => {
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.insert(reviewProviderSnapshotRuns).values({
      id: RUN_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      state: scope.state,
      phase: scope.phase,
      expectedTotal: 2,
      expectedAverageRating: 4.4,
      startedAt: STARTED_AT,
      confirmationDeadline:
        scope.phase === 'confirmation' ? new Date('2030-08-19T22:00:00.000Z') : null,
      expiresAt: new Date('2030-08-19T22:00:00.000Z'),
    })
  }

  const commitAveragePage = (scope: (typeof AVERAGE_DRIFT_SCOPES)[number]) =>
    repository.commitPage({
      runId: RUN_ID,
      organizationId: organizationId(ORGANIZATION_ID),
      phase: scope.phase,
      expectedPageIndex: 0,
      expectedCursorRef: null,
      totalReviewCount: 2,
      averageRating: 4.5,
      nextCursorRef: null,
      observations: [],
    })

  // A guest who re-rates a review while a run is reading moves Google's average
  // from one page to the next. The run fails, removes nothing, and is recorded
  // as `listing_changed` so the sync starts again at once
  // (application/snapshot-listing-change.ts).
  it.each(AVERAGE_DRIFT_SCOPES)(
    'fails a $phase page when the provider average drifts, as listing_changed',
    async (scope) => {
      await commitDriftedPage(scope)

      await expect(commitAveragePage(scope)).resolves.toMatchObject({
        status: 'failed',
        code: 'listing_changed',
      })
      const [row] = await db
        .select({ failureCode: reviewProviderSnapshotRuns.failureCode })
        .from(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))
      expect(row?.failureCode).toBe('listing_changed')
    },
  )

  it.each(AVERAGE_DRIFT_SCOPES)(
    'fails a $phase page when the provider average drifts, as average_changed once the Property has seen two runs move',
    async (scope) => {
      await commitDriftedPage(scope)
      for (const [index, failureCode] of (
        ['listing_changed', 'total_changed'] as const
      ).entries()) {
        const terminalAt = new Date(STARTED_AT.getTime() - (index + 1) * 60_000)
        await db.insert(reviewProviderSnapshotRuns).values({
          id: `72000000-0000-4000-8000-00000000010${index}`,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          sourceEpoch: 0,
          state: 'failed',
          phase: 'terminal',
          failureCode,
          startedAt: new Date(terminalAt.getTime() - 60_000),
          expiresAt: EXPIRES_AT,
          terminalAt,
          recordExpiresAt: new Date(terminalAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        })
      }

      await expect(commitAveragePage(scope)).resolves.toMatchObject({
        status: 'failed',
        code: 'average_changed',
      })
    },
  )

  it('reports the terminal state when another worker already transitioned the run', async () => {
    await seedCompletedMainScan()
    await db
      .update(reviewProviderSnapshotRuns)
      .set({ state: 'confirming', phase: 'confirmation' })
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))

    // Idempotence matters: a continuation that races the transition must observe
    // `confirming` instead of failing the run a second time.
    await expect(repository.finishMainScan({ runId: RUN_ID })).resolves.toMatchObject({
      status: 'confirming',
    })
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, OTHER_RUN_ID))
  })

  it('co-commits completion, the minimal verified aggregate, and its outbox fact', async () => {
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.insert(reviewProviderSnapshotRuns).values({
      id: OTHER_RUN_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      state: 'deleting',
      phase: 'apply',
      expectedTotal: 0,
      expectedAverageRating: null,
      startedAt: STARTED_AT,
      expiresAt: EXPIRES_AT,
    })
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION reject_verified_google_snapshot_test()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        RAISE EXCEPTION 'forced verified snapshot rollback';
      END;
      $function$;
      CREATE TRIGGER reject_verified_google_snapshot_test
      BEFORE INSERT ON review_google_reputation_snapshot_facts
      FOR EACH ROW EXECUTE FUNCTION reject_verified_google_snapshot_test();
    `)

    try {
      await expect(
        repository.applyDeletionBatch({ runId: OTHER_RUN_ID, limit: 100 }),
      ).rejects.toThrow(/Failed query/u)
    } finally {
      await db.execute(sql`
        DROP TRIGGER IF EXISTS reject_verified_google_snapshot_test
          ON review_google_reputation_snapshot_facts;
        DROP FUNCTION IF EXISTS reject_verified_google_snapshot_test();
      `)
    }

    const afterRollback = await db.execute(sql`
      SELECT state FROM review_provider_snapshot_runs WHERE id = ${OTHER_RUN_ID}
    `)
    const rolledBackFacts = await db.execute(sql`
      SELECT run_id FROM review_google_reputation_snapshot_facts
      WHERE run_id = ${OTHER_RUN_ID}
    `)
    expect(afterRollback.rows).toEqual([expect.objectContaining({ state: 'deleting' })])
    expect(rolledBackFacts.rows).toHaveLength(0)

    await expect(
      repository.applyDeletionBatch({ runId: OTHER_RUN_ID, limit: 100 }),
    ).resolves.toMatchObject({ done: true })

    const committed = await db.execute(sql`
      SELECT
        fact.organization_id,
        fact.property_id,
        fact.source_epoch,
        fact.run_id,
        fact.review_count,
        fact.average_rating,
        fact.evaluated_at,
        event.event_type,
        event.source_aggregate_id,
        event.payload
      FROM review_google_reputation_snapshot_facts fact
      JOIN outbox_events event ON event.id = fact.event_id
      WHERE fact.run_id = ${OTHER_RUN_ID}
    `)
    expect(committed.rows).toEqual([
      expect.objectContaining({
        organization_id: ORGANIZATION_ID,
        property_id: PROPERTY_ID,
        source_epoch: 0,
        run_id: OTHER_RUN_ID,
        review_count: 0,
        average_rating: null,
        event_type: 'review.google_reputation_snapshot.verified',
        source_aggregate_id: OTHER_RUN_ID,
      }),
    ])
    expect(committed.rows[0]?.payload).toMatchObject({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      runId: OTHER_RUN_ID,
      reviewCount: 0,
      averageRating: null,
    })
  })

  it('serializes provider deletion with lifecycle apply while preserving stable Review and Reply', async () => {
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.execute(sql`
      INSERT INTO review_provider_subject_hmac_key_versions
        (key_version, key_digest, state, generation, created_at)
      VALUES
        (${TEST_KEY_VERSION}, ${'1'.repeat(64)}, 'trusted_next', 999999, transaction_timestamp())
      ON CONFLICT (key_version) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, external_id,
        external_location_id, rating, text, reviewed_at, expires_at,
        content_expires_at, source_epoch, source_revision, analysis_sequence,
        ai_source_byte_length, ai_source_digest, reply_state_revision,
        created_at, updated_at
      ) VALUES (
        ${REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
        'safe03-provider-review', 'safe03-provider-location', 2,
        'provider-controlled source', ${STARTED_AT}, ${EXPIRES_AT},
        ${EXPIRES_AT}, 0, 1, 0, 26, ${'2'.repeat(64)}, 0,
        ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO replies (
        id, review_id, organization_id, text, status, source, ai_generated,
        authorship, state_revision, created_at, updated_at
      ) VALUES (
        ${REPLY_ID}, ${REVIEW_ID}, ${ORGANIZATION_ID},
        'RepKey-owned manager reply', 'draft', 'internal', false,
        'human', 1, ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO review_source_contents (
        review_id, organization_id, property_id, platform, external_id,
        external_location_id, rating, text, reviewed_at, first_fetched_at,
        last_fetched_at, content_expires_at, source_epoch, source_revision,
        ai_source_byte_length, ai_source_digest, created_at, updated_at
      ) VALUES (
        ${REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
        'safe03-provider-review', 'safe03-provider-location', 2,
        'provider-controlled source', ${STARTED_AT}, ${STARTED_AT},
        ${STARTED_AT}, ${EXPIRES_AT}, 0, 1, 26, ${'2'.repeat(64)},
        ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO review_provider_snapshot_runs (
        id, organization_id, property_id, source_epoch, state, phase,
        expected_total, expected_average_rating,
        started_at, expires_at, created_at, updated_at
      ) VALUES (
        ${LIFECYCLE_RUN_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0,
        'deleting', 'apply', 0, NULL, ${STARTED_AT}, ${EXPIRES_AT},
        ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO review_provider_subjects (
        organization_id, property_id, source_epoch, key_version,
        locator_hmac, verifier_hmac, review_id, last_source_revision,
        state, last_observed_at, first_missing_at,
        first_missing_snapshot_run_id, created_at, updated_at
      ) VALUES (
        ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${TEST_KEY_VERSION},
        decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex'),
        ${REVIEW_ID}, 1, 'linked', ${STARTED_AT}, ${STARTED_AT},
        ${LIFECYCLE_RUN_ID}, ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO review_provider_deletion_candidates (
        run_id, review_id, expected_mapping_state,
        expected_source_revision, state, created_at, updated_at
      ) VALUES (
        ${LIFECYCLE_RUN_ID}, ${REVIEW_ID}, 'linked', 1,
        'confirmed_missing', ${STARTED_AT}, ${STARTED_AT}
      )
    `)

    const pool = getPool()
    const gate = await pool.connect()
    let gateOpen = false
    let providerApply: ReturnType<typeof repository.applyDeletionBatch> | undefined
    let lifecycleApply:
      | ReturnType<
          ReturnType<
            typeof createReviewSourceContentLifecycleStore
          >['applyLifecycleBatch']
        >
      | undefined
    let applied: Awaited<ReturnType<typeof repository.applyDeletionBatch>> | undefined
    try {
      await pool.query(`
        CREATE FUNCTION review_provider_delete_lock_order_gate()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $function$
        BEGIN
          IF NEW.id = '${REVIEW_ID}'::uuid
             AND NEW.source_content_state = 'provider_deleted'
          THEN
            PERFORM pg_advisory_xact_lock(
              ${PROVIDER_DELETE_GATE_CLASS},
              ${PROVIDER_DELETE_GATE_OBJECT}
            );
          END IF;
          RETURN NEW;
        END;
        $function$;
        CREATE TRIGGER review_provider_delete_lock_order_gate
          BEFORE UPDATE ON reviews
          FOR EACH ROW EXECUTE FUNCTION review_provider_delete_lock_order_gate();
      `)
      await gate.query('BEGIN')
      gateOpen = true
      await gate.query('SELECT pg_advisory_xact_lock($1, $2)', [
        PROVIDER_DELETE_GATE_CLASS,
        PROVIDER_DELETE_GATE_OBJECT,
      ])

      providerApply = repository.applyDeletionBatch({
        runId: LIFECYCLE_RUN_ID,
        limit: 100,
      })
      await waitForDatabaseCondition(
        'provider deletion to hold its Review locks',
        async () => {
          const waits = await pool.query<{ waiters: number }>(
            `SELECT count(*)::int AS waiters
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND granted = false
             AND classid::bigint = $1
             AND objid::bigint = $2`,
            [PROVIDER_DELETE_GATE_CLASS, PROVIDER_DELETE_GATE_OBJECT],
          )
          return waits.rows[0]?.waiters === 1
        },
      )

      lifecycleApply = createReviewSourceContentLifecycleStore(db).applyLifecycleBatch({
        evaluatedAt: STARTED_AT,
        after: null,
        limit: 10,
        scope: { kind: 'expired', organizationId: organizationId(ORGANIZATION_ID) },
      })
      await waitForDatabaseCondition(
        'both lifecycle writers to be lock-blocked',
        async () => {
          const waits = await pool.query<{ waiters: number }>(`
          SELECT count(*)::int AS waiters
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND cardinality(pg_blocking_pids(pid)) > 0
        `)
          return (waits.rows[0]?.waiters ?? 0) >= 2
        },
      )

      await gate.query('COMMIT')
      gateOpen = false
      const results = await Promise.all([providerApply, lifecycleApply])
      applied = results[0]
      expect(results[1].rowsRedacted).toBe(0)
    } finally {
      if (gateOpen) await gate.query('ROLLBACK')
      const pendingWriters: Promise<unknown>[] = []
      if (providerApply) pendingWriters.push(providerApply)
      if (lifecycleApply) pendingWriters.push(lifecycleApply)
      await Promise.allSettled(pendingWriters)
      gate.release()
      await pool.query(`
        DROP TRIGGER IF EXISTS review_provider_delete_lock_order_gate ON reviews;
        DROP FUNCTION IF EXISTS review_provider_delete_lock_order_gate();
      `)
    }

    expect(applied).toMatchObject({ applied: 1, observed: 0, done: true })
    const reviewRows = await db.execute(sql`
      SELECT
        id,
        source_content_state,
        source_content_erased_at,
        external_id,
        external_location_id,
        google_connection_id,
        reviewer_name,
        reviewer_profile_photo_url,
        rating,
        text,
        translated_text,
        language_code,
        reviewed_at,
        source_created_at,
        source_updated_at,
        content_hash,
        ai_source_byte_length,
        ai_source_digest,
        analysis_sequence::int AS analysis_sequence
      FROM reviews
      WHERE id = ${REVIEW_ID}
    `)
    const sourceContentRows = await db.execute(sql`
      SELECT review_id
      FROM review_source_contents
      WHERE review_id = ${REVIEW_ID}
    `)
    const replyRows = await db.execute(sql`
      SELECT id, review_id FROM replies WHERE id = ${REPLY_ID}
    `)
    const transitionRows = await db.execute(sql`
      SELECT
        (payload->>'analysisSequence')::int AS analysis_sequence,
        (payload->>'occurredAt')::timestamptz AS occurred_at
      FROM outbox_events
      WHERE source_aggregate_id = ${REVIEW_ID}
        AND event_type = 'review.source_transitioned'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    expect(reviewRows.rows).toHaveLength(1)
    expect(replyRows.rows).toEqual([
      expect.objectContaining({ id: REPLY_ID, review_id: REVIEW_ID }),
    ])
    expect(sourceContentRows.rows).toHaveLength(0)
    expect(transitionRows.rows).toHaveLength(1)
    expect(reviewRows.rows[0]).toMatchObject({
      id: REVIEW_ID,
      source_content_state: 'provider_deleted',
      external_id: null,
      external_location_id: null,
      google_connection_id: null,
      reviewer_name: null,
      reviewer_profile_photo_url: null,
      rating: null,
      text: null,
      translated_text: null,
      language_code: null,
      reviewed_at: null,
      source_created_at: null,
      source_updated_at: null,
      content_hash: null,
      ai_source_byte_length: null,
      ai_source_digest: null,
    })
    expect(reviewRows.rows[0]?.analysis_sequence).toBe(
      transitionRows.rows[0]?.analysis_sequence,
    )
    expect(new Date(String(reviewRows.rows[0]?.source_content_erased_at)).getTime()).toBe(
      new Date(String(transitionRows.rows[0]?.occurred_at)).getTime(),
    )
    expect(
      Number.isNaN(
        new Date(String(reviewRows.rows[0]!.source_content_erased_at)).getTime(),
      ),
    ).toBe(false)
  })

  it('keeps the legacy expiry repository seam report-only without mutating source content', async () => {
    await db.execute(sql`
      INSERT INTO review_provider_subject_hmac_key_versions
        (key_version, key_digest, state, generation, created_at)
      VALUES
        (${TEST_KEY_VERSION}, ${'1'.repeat(64)}, 'trusted_next', 999999, transaction_timestamp())
      ON CONFLICT (key_version) DO NOTHING
    `)
    await db.execute(sql`
      INSERT INTO reviews (
        id, organization_id, property_id, platform, external_id,
        external_location_id, rating, text, reviewed_at, expires_at,
        content_expires_at, source_epoch, source_revision, analysis_sequence,
        ai_source_byte_length, ai_source_digest, reply_state_revision,
        created_at, updated_at
      ) VALUES (
        ${EXPIRING_REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
        'safe03-expiring-review', 'safe03-provider-location', 4,
        'expiring provider source', ${STARTED_AT}, ${EXPIRES_AT},
        ${EXPIRES_AT}, 0, 1, 0, 24, ${'3'.repeat(64)}, 0,
        ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO replies (
        id, review_id, organization_id, text, status, source, ai_generated,
        authorship, state_revision, created_at, updated_at
      ) VALUES (
        ${EXPIRING_REPLY_ID}, ${EXPIRING_REVIEW_ID}, ${ORGANIZATION_ID},
        'RepKey-owned expiry reply', 'draft', 'internal', false,
        'human', 1, ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO review_source_contents (
        review_id, organization_id, property_id, platform, external_id,
        external_location_id, rating, text, reviewed_at, first_fetched_at,
        last_fetched_at, content_expires_at, source_epoch, source_revision,
        ai_source_byte_length, ai_source_digest, created_at, updated_at
      ) VALUES (
        ${EXPIRING_REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
        'safe03-expiring-review', 'safe03-provider-location', 4,
        'expiring provider source', ${STARTED_AT}, ${STARTED_AT},
        ${STARTED_AT}, ${EXPIRES_AT}, 0, 1, 24, ${'3'.repeat(64)},
        ${STARTED_AT}, ${STARTED_AT}
      )
    `)
    await db.execute(sql`
      INSERT INTO review_provider_subjects (
        organization_id, property_id, source_epoch, key_version,
        locator_hmac, verifier_hmac, review_id, last_source_revision,
        state, last_observed_at, created_at, updated_at
      ) VALUES (
        ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${TEST_KEY_VERSION},
        decode(repeat('03', 32), 'hex'), decode(repeat('04', 32), 'hex'),
        ${EXPIRING_REVIEW_ID}, 1, 'linked', ${STARTED_AT},
        ${STARTED_AT}, ${STARTED_AT}
      )
    `)

    const result = await repository.expireRawSourceBatch({
      beforeOrAt: EXPIRES_AT,
      afterReviewId: null,
      limit: 100,
    })

    expect(result.transitioned).toBe(0)
    const reviewRows = await db.execute(sql`
      SELECT id, source_content_state, rating, text, reviewer_name,
             external_id, external_location_id, ai_source_digest
      FROM reviews
      WHERE id = ${EXPIRING_REVIEW_ID}
    `)
    const sourceContentRows = await db.execute(sql`
      SELECT review_id FROM review_source_contents
      WHERE review_id = ${EXPIRING_REVIEW_ID}
    `)
    const replyRows = await db.execute(
      sql`SELECT id FROM replies WHERE id = ${EXPIRING_REPLY_ID}`,
    )
    const providerSubjectRows = await db.execute(sql`
      SELECT state FROM review_provider_subjects
      WHERE review_id = ${EXPIRING_REVIEW_ID}
    `)
    expect(reviewRows.rows).toEqual([
      expect.objectContaining({
        id: EXPIRING_REVIEW_ID,
        source_content_state: 'active',
        rating: 4,
        text: 'expiring provider source',
        external_id: 'safe03-expiring-review',
        external_location_id: 'safe03-provider-location',
        ai_source_digest: '3'.repeat(64),
      }),
    ])
    expect(sourceContentRows.rows).toHaveLength(1)
    expect(replyRows.rows).toEqual([expect.objectContaining({ id: EXPIRING_REPLY_ID })])
    expect(providerSubjectRows.rows).toEqual([
      expect.objectContaining({ state: 'linked' }),
    ])
  })

  describe("the end of a Property's first history import", () => {
    const IMPORT_RUN_ID = '72000000-0000-4000-8000-000000000009'
    const scope = {
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      sourceEpoch: 0,
    }
    const importRepository = createReviewProviderSnapshotRepository(
      db,
      () => IMPORT_RUN_ID,
    )
    const resetScope = async () => {
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_history_cutoffs WHERE property_id = ${PROPERTY_ID}
      `)
      await db.execute(sql`
        DELETE FROM review_google_reputation_snapshot_facts WHERE property_id = ${PROPERTY_ID}
      `)
      await db.execute(sql`
        DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}
      `)
    }
    const importFinishedPayloads = async () => {
      const rows = await db.execute(sql`
        SELECT payload, source_aggregate_id, property_id
        FROM outbox_events
        WHERE event_type = 'review.property_history_import.finished'
          AND organization_id = ${ORGANIZATION_ID}
        ORDER BY created_at
      `)
      return rows.rows
    }
    /** A run parked in `deleting` with nothing left to apply, so one batch completes it. */
    const seedApplyReadyRun = async (
      runId: string,
      overrides: Readonly<{ sourceEpoch?: number; observed?: number }> = {},
    ) => {
      await db.insert(reviewProviderSnapshotRuns).values({
        id: runId,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: overrides.sourceEpoch ?? 0,
        observationOrigin: 'historical_onboarding',
        state: 'deleting',
        phase: 'apply',
        expectedTotal: overrides.observed ?? 260,
        expectedAverageRating: 4.5,
        mainUniqueCount: overrides.observed ?? 260,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_AT,
      })
    }

    it('records what the import took in when its first listing completes', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await expect(
        importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({ done: true })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]).toMatchObject({
        source_aggregate_id: IMPORT_RUN_ID,
        property_id: PROPERTY_ID,
      })
      expect(finished[0]?.payload).toMatchObject({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        runId: IMPORT_RUN_ID,
        outcome: 'completed',
        reviewsObserved: 260,
        failureReason: null,
      })
      await resetScope()
    })

    it('still announces the import when a head fact was stored before its first listing completed', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      // A head check read Google's newest page after the import was admitted:
      // its fact carries Google's numbers but lists nothing.
      await db.execute(sql`
        INSERT INTO review_google_reputation_snapshot_facts
          (run_id, event_id, organization_id, property_id, source_epoch,
           review_count, average_rating, evaluated_at, listing_complete,
           numbers_observed_at)
        VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${ORGANIZATION_ID},
          ${PROPERTY_ID}, 0, 3, 4.5, clock_timestamp(), false, clock_timestamp())
      `)
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]?.payload).toMatchObject({ runId: IMPORT_RUN_ID })
      await resetScope()
    })

    it('stamps the completed run’s fact with when it froze Google’s numbers, apart from when it was written', async () => {
      await resetScope()
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      const facts = await db.execute(sql`
        SELECT listing_complete, numbers_observed_at, evaluated_at
        FROM review_google_reputation_snapshot_facts WHERE run_id = ${IMPORT_RUN_ID}
      `)
      const fact = facts.rows[0]
      expect(fact?.listing_complete).toBe(true)
      expect(new Date(String(fact?.numbers_observed_at))).toEqual(STARTED_AT)
      expect(new Date(String(fact?.evaluated_at)).getTime()).toBeGreaterThan(
        STARTED_AT.getTime(),
      )
      const events = await db.execute(sql`
        SELECT payload FROM outbox_events
        WHERE event_type = 'review.google_reputation_snapshot.verified'
          AND organization_id = ${ORGANIZATION_ID}
      `)
      expect(events.rows[0]?.payload).toMatchObject({
        numbersObservedAt: STARTED_AT.toISOString(),
      })
      await resetScope()
    })

    it('announces the import once, not on every later poll that completes', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      await seedApplyReadyRun(IMPORT_RUN_ID)
      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      await seedApplyReadyRun(OTHER_RUN_ID, { observed: 261 })
      await expect(
        importRepository.applyDeletionBatch({ runId: OTHER_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({ done: true })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]?.payload).toMatchObject({ runId: IMPORT_RUN_ID })
      await resetScope()
    })

    // `evaluated_at` is written through a JavaScript Date and loses the
    // cutoff's microseconds. A completion inside the cutoff's own millisecond
    // is stored BEFORE it, and the history then looked unlisted forever: this
    // test failed roughly one run in three before the comparison was taken to
    // the precision both values carry.
    it('treats a completion inside the cutoff\u2019s own millisecond as listed', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      await seedApplyReadyRun(IMPORT_RUN_ID)
      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })
      // Force the exact collision instead of waiting for it to happen.
      await db.execute(sql`
        UPDATE review_google_reputation_snapshot_facts
        SET evaluated_at = date_trunc(
          'milliseconds',
          (SELECT cutoff_at FROM review_provider_history_cutoffs
            WHERE property_id = ${PROPERTY_ID} AND source_epoch = 0)
        )
        WHERE run_id = ${IMPORT_RUN_ID}
      `)

      await expect(importRepository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: true,
      })
      await seedApplyReadyRun(OTHER_RUN_ID, { observed: 261 })
      await importRepository.applyDeletionBatch({ runId: OTHER_RUN_ID, limit: 100 })

      await expect(importFinishedPayloads()).resolves.toHaveLength(1)
      await resetScope()
    })

    it('says nothing about a poll of a Property no import ever covered', async () => {
      await resetScope()
      await seedApplyReadyRun(IMPORT_RUN_ID)

      await expect(
        importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({ done: true })

      await expect(importFinishedPayloads()).resolves.toEqual([])
      await resetScope()
    })

    it("stays silent for a relinked epoch, which is not the Property's first import", async () => {
      await resetScope()
      await db.execute(sql`
        INSERT INTO review_provider_history_cutoffs
          (organization_id, property_id, source_epoch, cutoff_at)
        VALUES (${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${STARTED_AT})
      `)
      await importRepository.fixImportHistoryCutoff({ ...scope, sourceEpoch: 2 })
      await db
        .update(properties)
        .set({ sourceEpoch: 2 })
        .where(eq(properties.id, PROPERTY_ID))
      await seedApplyReadyRun(IMPORT_RUN_ID, { sourceEpoch: 2 })

      await importRepository.applyDeletionBatch({ runId: IMPORT_RUN_ID, limit: 100 })

      await expect(importFinishedPayloads()).resolves.toEqual([])
      await db
        .update(properties)
        .set({ sourceEpoch: 0 })
        .where(eq(properties.id, PROPERTY_ID))
      await resetScope()
    })

    it('reports a failed import with the closed reason and what it had listed', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      const run = await importRepository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      await db
        .update(reviewProviderSnapshotRuns)
        .set({ mainUniqueCount: 12 })
        .where(eq(reviewProviderSnapshotRuns.id, run.id))

      await importRepository.failRun({
        runId: run.id,
        organizationId: scope.organizationId,
        code: 'authorization_denied',
      })

      const finished = await importFinishedPayloads()
      expect(finished).toHaveLength(1)
      expect(finished[0]?.payload).toMatchObject({
        runId: run.id,
        outcome: 'failed',
        reviewsObserved: 12,
        failureReason: 'google_authorization',
      })
      await resetScope()
    })

    it('records the failure once, however often the run is failed again', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      const run = await importRepository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      const fail = () =>
        importRepository.failRun({
          runId: run.id,
          organizationId: scope.organizationId,
          code: 'provider_failure',
        })

      await fail()
      await fail()

      await expect(importFinishedPayloads()).resolves.toHaveLength(1)
      await resetScope()
    })

    it('says nothing when an ordinary poll run fails on an imported Property', async () => {
      await resetScope()
      await importRepository.fixImportHistoryCutoff(scope)
      const run = await importRepository.startOrResume({
        ...scope,
        observationOrigin: 'ongoing',
      })

      await importRepository.failRun({
        runId: run.id,
        organizationId: scope.organizationId,
        code: 'provider_failure',
      })

      await expect(importFinishedPayloads()).resolves.toEqual([])
      await resetScope()
    })
  })

  describe('initial import history cutoff', () => {
    const scope = {
      organizationId: organizationId(ORGANIZATION_ID),
      propertyId: propertyId(PROPERTY_ID),
      sourceEpoch: 0,
    }
    const resetScope = async () => {
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_history_cutoffs WHERE property_id = ${PROPERTY_ID}
      `)
      await db.execute(sql`
        DELETE FROM review_google_reputation_snapshot_facts WHERE property_id = ${PROPERTY_ID}
      `)
    }
    const databaseNow = async () => {
      const result = await db.execute(sql`SELECT clock_timestamp() AS now`)
      return new Date(String(result.rows[0]?.now)).getTime()
    }
    const recordCutoff = (sourceEpoch: number, cutoffAt: Date) =>
      db.execute(sql`
        INSERT INTO review_provider_history_cutoffs
          (organization_id, property_id, source_epoch, cutoff_at)
        VALUES (${ORGANIZATION_ID}, ${PROPERTY_ID}, ${sourceEpoch}, ${cutoffAt})
      `)
    /** The verified fact a snapshot run of the epoch records when it completes. */
    const recordCompletedListing = (
      sourceEpoch: number,
      evaluatedAt: Date,
      listingComplete = true,
    ) =>
      db.execute(sql`
        INSERT INTO review_google_reputation_snapshot_facts
          (run_id, event_id, organization_id, property_id, source_epoch,
           review_count, average_rating, evaluated_at, listing_complete)
        VALUES (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${ORGANIZATION_ID},
          ${PROPERTY_ID}, ${sourceEpoch}, 1, 4, ${evaluatedAt}, ${listingComplete})
      `)

    it('fixes the cutoff when the import is admitted, before any run starts, and keeps it', async () => {
      await resetScope()

      const admissionRequestedAt = await databaseNow()
      await repository.fixImportHistoryCutoff(scope)
      const admissionReturnedAt = await databaseNow()
      const admitted = await repository.readHistoryCutoff(scope)
      expect(admitted?.cutoffAt.getTime()).toBeGreaterThanOrEqual(admissionRequestedAt)
      expect(admitted?.cutoffAt.getTime()).toBeLessThanOrEqual(admissionReturnedAt)

      // A retried admission, then the import's own run, keep the first cutoff.
      await repository.fixImportHistoryCutoff(scope)
      await repository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toEqual({
        cutoffAt: admitted?.cutoffAt,
        firstImportCutoffAt: admitted?.cutoffAt,
        historyListed: false,
      })
      await resetScope()
    })

    it("reads a relinked epoch's cutoff with the Property's first import cutoff", async () => {
      await resetScope()
      const firstImport = new Date('2026-03-02T09:00:00.000Z')
      const relink = new Date('2026-09-15T10:00:00.000Z')
      await recordCutoff(0, firstImport)
      await recordCutoff(2, relink)

      await expect(
        repository.readHistoryCutoff({ ...scope, sourceEpoch: 2 }),
      ).resolves.toEqual({
        cutoffAt: relink,
        firstImportCutoffAt: firstImport,
        historyListed: false,
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toEqual({
        cutoffAt: firstImport,
        firstImportCutoffAt: firstImport,
        historyListed: false,
      })
      // The disconnected epoch in between never had an import.
      await expect(
        repository.readHistoryCutoff({ ...scope, sourceEpoch: 1 }),
      ).resolves.toBeNull()
      await resetScope()
    })

    it('reports the history listed once a run of the epoch completes after its cutoff', async () => {
      await resetScope()
      const cutoffAt = new Date('2026-09-15T10:00:00.000Z')
      await recordCutoff(0, cutoffAt)
      // A listing that completed before the import was admitted proves nothing
      // about the history the import takes over; nor does another epoch's.
      await recordCompletedListing(0, new Date('2026-09-15T09:59:59.000Z'))
      await recordCompletedListing(1, new Date('2026-09-15T11:00:00.000Z'))
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: false,
      })

      await recordCompletedListing(0, new Date('2026-09-15T10:40:00.000Z'))

      await expect(repository.readHistoryCutoff(scope)).resolves.toEqual({
        cutoffAt,
        firstImportCutoffAt: cutoffAt,
        historyListed: true,
      })
      await resetScope()
    })

    it('does not take a head fact for a listing of the history, however late it is', async () => {
      await resetScope()
      const cutoffAt = new Date('2026-09-15T10:00:00.000Z')
      await recordCutoff(0, cutoffAt)
      // Google's numbers from one read of its newest page (listing_complete =
      // false) say nothing about the reviews the import is still listing.
      await recordCompletedListing(0, new Date('2026-09-15T10:30:00.000Z'), false)
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: false,
      })

      await recordCompletedListing(0, new Date('2026-09-15T10:40:00.000Z'))

      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        historyListed: true,
      })
      await resetScope()
    })

    it('fixes the cutoff at the start of an import run that no admission fixed, and keeps it', async () => {
      await resetScope()

      const first = await repository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        cutoffAt: first.startedAt,
      })

      await repository.failRun({
        runId: first.id,
        organizationId: scope.organizationId,
        code: 'observation_failed',
      })
      const later = await createReviewProviderSnapshotRepository(
        db,
        () => OTHER_RUN_ID,
      ).startOrResume({ ...scope, observationOrigin: 'historical_onboarding' })
      expect(later.id).toBe(OTHER_RUN_ID)
      await expect(repository.readHistoryCutoff(scope)).resolves.toMatchObject({
        cutoffAt: first.startedAt,
      })
      await expect(
        repository.readHistoryCutoff({ ...scope, sourceEpoch: 1 }),
      ).resolves.toBeNull()
      await resetScope()
    })

    it('fixes the cutoff when an import no admission fixed joins a run that is already active', async () => {
      await resetScope()

      const discovery = await repository.startOrResume({
        ...scope,
        observationOrigin: 'ongoing',
      })
      await expect(repository.readHistoryCutoff(scope)).resolves.toBeNull()
      // The discovery run has been scanning for an hour when the import starts.
      await db
        .update(reviewProviderSnapshotRuns)
        .set({
          startedAt: sql`${reviewProviderSnapshotRuns.startedAt} - interval '1 hour'`,
        })
        .where(eq(reviewProviderSnapshotRuns.id, discovery.id))

      const joinRequestedAt = await databaseNow()
      const joined = await repository.startOrResume({
        ...scope,
        observationOrigin: 'historical_onboarding',
      })
      const joinReturnedAt = await databaseNow()

      expect(joined).toMatchObject({ id: discovery.id, observationOrigin: 'ongoing' })
      const cutoff = (await repository.readHistoryCutoff(scope))?.cutoffAt.getTime()
      expect(cutoff).toBeGreaterThanOrEqual(joinRequestedAt)
      expect(cutoff).toBeLessThanOrEqual(joinReturnedAt)
      await resetScope()
    })
  })

  // Google's total and its list do not always agree. A location can report 82
  // and list 81 unique reviews on every read, report 19 and list 20, or report
  // 86 and list 84. Such a run used to fail as `set_mismatch` every time. A
  // small gap (up to 5, or 2% on a big location) now completes the run, but
  // nothing is removed on the strength of that listing.
  describe('a Google total that disagrees with its list by a small amount', () => {
    const GAP_RUN_ID = '72000000-0000-4000-8000-00000000000a'
    const PRIOR_RUN_ID = '72000000-0000-4000-8000-00000000000b'
    /** Stored, absent from this listing, and already missed by an earlier run:
     * exactly what a run whose count matched would make a removal candidate. */
    const ABSENT_REVIEW_ID = '72000000-0000-4000-8000-00000000000c'
    /** Stored and absent from this listing for the first time. */
    const UNMISSED_REVIEW_ID = '72000000-0000-4000-8000-00000000000d'
    const STORED_TEXT = 'count gap stored source'
    const tenant = organizationId(ORGANIZATION_ID)

    type Listing = Readonly<{ expected: number; unique: number; pages: number }>

    const resetGapScope = async () => {
      await db.execute(sql`
        DELETE FROM review_google_reputation_snapshot_facts WHERE run_id = ${GAP_RUN_ID}
      `)
      await db
        .delete(reviewProviderSnapshotRuns)
        .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
      await db.execute(sql`
        DELETE FROM review_provider_subjects
        WHERE review_id IN (${ABSENT_REVIEW_ID}, ${UNMISSED_REVIEW_ID})
      `)
      await db.execute(sql`
        DELETE FROM review_source_contents WHERE review_id = ${ABSENT_REVIEW_ID}
      `)
      await db.execute(sql`DELETE FROM reviews WHERE id = ${ABSENT_REVIEW_ID}`)
    }

    /** A run whose main listing is spent: `unique` members over `pages` pages,
     * against the total Google reported on every page. */
    const seedListing = async (
      listing: Listing,
      state: Readonly<{ state: 'scanning' | 'deleting'; phase: 'main' | 'apply' }> = {
        state: 'scanning',
        phase: 'main',
      },
    ): Promise<Date> => {
      // Recent, so the confirmation deadline (start + 12 hours) is still open.
      const startedAt = new Date(Date.now() - 60_000)
      await db.insert(reviewProviderSnapshotRuns).values({
        id: GAP_RUN_ID,
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        sourceEpoch: 0,
        state: state.state,
        phase: state.phase,
        expectedTotal: listing.expected,
        expectedAverageRating: 4.5,
        mainPageCount: listing.pages,
        mainUniqueCount: listing.unique,
        mainCursorRef: null,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 12 * 60 * 60 * 1000),
      })
      await db.execute(sql`
        INSERT INTO review_provider_snapshot_members (run_id, review_id, main_seen)
        SELECT ${GAP_RUN_ID}, md5('count-gap-listed-' || i)::uuid, true
        FROM generate_series(1, ${listing.unique}::int) AS i
      `)
      return startedAt
    }

    const seedStoredReviewsMissingFromListing = async (startedAt: Date) => {
      const lastObservedAt = new Date(startedAt.getTime() - 3 * 24 * 60 * 60 * 1000)
      const firstMissingAt = new Date(startedAt.getTime() - 2 * 24 * 60 * 60 * 1000)
      await db.execute(sql`
        INSERT INTO review_provider_subject_hmac_key_versions
          (key_version, key_digest, state, generation, created_at)
        VALUES
          (${TEST_KEY_VERSION}, ${'1'.repeat(64)}, 'trusted_next', 999999, transaction_timestamp())
        ON CONFLICT (key_version) DO NOTHING
      `)
      await db.execute(sql`
        INSERT INTO reviews (
          id, organization_id, property_id, platform, external_id,
          external_location_id, rating, text, reviewed_at, expires_at,
          content_expires_at, source_epoch, source_revision, analysis_sequence,
          ai_source_byte_length, ai_source_digest, reply_state_revision,
          created_at, updated_at
        ) VALUES (
          ${ABSENT_REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
          'count-gap-absent-review', 'count-gap-location', 3,
          ${STORED_TEXT}, ${lastObservedAt}, ${EXPIRES_AT},
          ${EXPIRES_AT}, 0, 1, 0, 23, ${'5'.repeat(64)}, 0,
          ${lastObservedAt}, ${lastObservedAt}
        )
      `)
      await db.execute(sql`
        INSERT INTO review_source_contents (
          review_id, organization_id, property_id, platform, external_id,
          external_location_id, rating, text, reviewed_at, first_fetched_at,
          last_fetched_at, content_expires_at, source_epoch, source_revision,
          ai_source_byte_length, ai_source_digest, created_at, updated_at
        ) VALUES (
          ${ABSENT_REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
          'count-gap-absent-review', 'count-gap-location', 3,
          ${STORED_TEXT}, ${lastObservedAt}, ${lastObservedAt},
          ${lastObservedAt}, ${EXPIRES_AT}, 0, 1, 23, ${'5'.repeat(64)},
          ${lastObservedAt}, ${lastObservedAt}
        )
      `)
      await db.execute(sql`
        INSERT INTO review_provider_subjects (
          organization_id, property_id, source_epoch, key_version,
          locator_hmac, verifier_hmac, review_id, last_source_revision,
          state, last_observed_at, first_missing_at,
          first_missing_snapshot_run_id, created_at, updated_at
        ) VALUES
          (
            ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${TEST_KEY_VERSION},
            decode(repeat('0a', 32), 'hex'), decode(repeat('0b', 32), 'hex'),
            ${ABSENT_REVIEW_ID}, 1, 'linked', ${lastObservedAt}, ${firstMissingAt},
            ${PRIOR_RUN_ID}, ${lastObservedAt}, ${lastObservedAt}
          ),
          (
            ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0, ${TEST_KEY_VERSION},
            decode(repeat('0c', 32), 'hex'), decode(repeat('0d', 32), 'hex'),
            ${UNMISSED_REVIEW_ID}, 1, 'linked', ${lastObservedAt}, NULL,
            NULL, ${lastObservedAt}, ${lastObservedAt}
          )
      `)
    }

    /** The confirmation scan lists the same reviews again, page for page. */
    const confirmListing = async (listing: Listing) => {
      await db.execute(sql`
        UPDATE review_provider_snapshot_members
        SET confirmation_seen = true
        WHERE run_id = ${GAP_RUN_ID}
      `)
      await db
        .update(reviewProviderSnapshotRuns)
        .set({
          confirmationPageCount: listing.pages,
          confirmationUniqueCount: listing.unique,
        })
        .where(eq(reviewProviderSnapshotRuns.id, GAP_RUN_ID))
    }

    const candidatesOf = async (runId: string) =>
      (
        await db.execute(sql`
          SELECT review_id, expected_mapping_state, state
          FROM review_provider_deletion_candidates
          WHERE run_id = ${runId}
          ORDER BY review_id
        `)
      ).rows

    const subjectOf = async (reviewId: string) =>
      (
        await db.execute(sql`
          SELECT state, first_missing_snapshot_run_id
          FROM review_provider_subjects
          WHERE review_id = ${reviewId}
        `)
      ).rows[0]

    const runState = async () =>
      (
        await db.execute(sql`
          SELECT state, phase, failure_code
          FROM review_provider_snapshot_runs
          WHERE id = ${GAP_RUN_ID}
        `)
      ).rows[0]

    it.each([
      { expected: 82, unique: 81, pages: 2, case: 'one review fewer than Google counts' },
      { expected: 19, unique: 20, pages: 1, case: 'one review more than Google counts' },
      // JAVASCRIPT-TANSTACKSTART-REACT-4: 86 counted, 84 unique over 2 pages,
      // a gap of 2 that the 2% rule failed.
      {
        expected: 86,
        unique: 84,
        pages: 2,
        case: 'two reviews fewer (86 counted, 84 listed)',
      },
      {
        expected: 86,
        unique: 81,
        pages: 2,
        case: 'the widest gap a small total allows (5)',
      },
    ])('completes a listing with $case and removes nothing', async (listing) => {
      await resetGapScope()
      const startedAt = await seedListing(listing)
      await seedStoredReviewsMissingFromListing(startedAt)

      await expect(
        repository.finishMainScan({ runId: GAP_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })
      // Nothing is based on this listing: no candidate, and no first miss either,
      // so a later run cannot finish a removal this one started.
      expect(await candidatesOf(GAP_RUN_ID)).toEqual([])
      expect(await subjectOf(UNMISSED_REVIEW_ID)).toMatchObject({
        first_missing_snapshot_run_id: null,
      })
      expect(await subjectOf(ABSENT_REVIEW_ID)).toMatchObject({
        first_missing_snapshot_run_id: PRIOR_RUN_ID,
      })

      await expect(
        repository.readNextLinkedCandidate({ runId: GAP_RUN_ID }),
      ).resolves.toBeNull()
      await repository.beginConfirmationScan({
        runId: GAP_RUN_ID,
        organizationId: tenant,
      })
      await confirmListing(listing)
      await expect(
        repository.finishConfirmationScan({ runId: GAP_RUN_ID, organizationId: tenant }),
      ).resolves.toMatchObject({ status: 'deleting' })
      await expect(
        repository.applyDeletionBatch({ runId: GAP_RUN_ID, limit: 100 }),
      ).resolves.toMatchObject({
        applied: 0,
        observed: 0,
        done: true,
        run: {
          state: 'completed',
          expectedProviderTotal: listing.expected,
          mainUniqueCount: listing.unique,
        },
      })

      const stored = await db.execute(sql`
        SELECT source_content_state, text FROM reviews WHERE id = ${ABSENT_REVIEW_ID}
      `)
      expect(stored.rows).toEqual([{ source_content_state: 'active', text: STORED_TEXT }])
      const content = await db.execute(sql`
        SELECT review_id FROM review_source_contents WHERE review_id = ${ABSENT_REVIEW_ID}
      `)
      expect(content.rows).toHaveLength(1)
      expect(await subjectOf(ABSENT_REVIEW_ID)).toMatchObject({ state: 'linked' })
      // The completed run verifies Google's own aggregate, not the list's count.
      const facts = await db.execute(sql`
        SELECT review_count FROM review_google_reputation_snapshot_facts
        WHERE run_id = ${GAP_RUN_ID}
      `)
      expect(facts.rows).toEqual([{ review_count: listing.expected }])
      await resetGapScope()
    })

    it("makes the same stored review a removal candidate when Google's total matches its list", async () => {
      await resetGapScope()
      const startedAt = await seedListing({ expected: 81, unique: 81, pages: 2 })
      await seedStoredReviewsMissingFromListing(startedAt)

      await expect(
        repository.finishMainScan({ runId: GAP_RUN_ID }),
      ).resolves.toMatchObject({ status: 'confirming' })

      expect(await candidatesOf(GAP_RUN_ID)).toEqual([
        {
          review_id: ABSENT_REVIEW_ID,
          expected_mapping_state: 'linked',
          state: 'pending',
        },
      ])
      expect(await subjectOf(UNMISSED_REVIEW_ID)).toMatchObject({
        first_missing_snapshot_run_id: GAP_RUN_ID,
      })
      await resetGapScope()
    })

    it.each([
      { expected: 82, unique: 70, pages: 2, case: 'a gap far beyond the tolerance' },
      { expected: 86, unique: 80, pages: 2, case: 'a gap one review past the tolerance' },
      { expected: 20, unique: 17, pages: 1, case: 'a gap over 10% of a small total' },
      { expected: 2_600, unique: 2_550, pages: 51, case: 'a missing full page' },
      { expected: 82, unique: 81, pages: 3, case: 'a short page before the last' },
    ])('still fails $case as set_mismatch', async (listing) => {
      await resetGapScope()
      const startedAt = await seedListing(listing)
      await seedStoredReviewsMissingFromListing(startedAt)

      await expect(
        repository.finishMainScan({ runId: GAP_RUN_ID }),
      ).resolves.toMatchObject({ status: 'failed', code: 'set_mismatch' })

      expect(await runState()).toEqual({
        state: 'failed',
        phase: 'terminal',
        failure_code: 'set_mismatch',
      })
      expect(await candidatesOf(GAP_RUN_ID)).toEqual([])
      await resetGapScope()
    })

    it('refuses to apply a removal on a run whose listing disagreed with the total', async () => {
      await resetGapScope()
      const startedAt = await seedListing(
        { expected: 82, unique: 81, pages: 2 },
        { state: 'deleting', phase: 'apply' },
      )
      await seedStoredReviewsMissingFromListing(startedAt)
      // Unreachable through `finishMainScan`, which records no candidate for such
      // a run. The apply step holds the rule on its own all the same.
      await db.execute(sql`
        INSERT INTO review_provider_deletion_candidates (
          run_id, review_id, expected_mapping_state, expected_source_revision, state
        ) VALUES (${GAP_RUN_ID}, ${ABSENT_REVIEW_ID}, 'linked', 1, 'confirmed_missing')
      `)

      await expect(
        repository.applyDeletionBatch({ runId: GAP_RUN_ID, limit: 100 }),
      ).rejects.toMatchObject({ code: 'snapshot_count_gap_removal_refused' })

      const stored = await db.execute(sql`
        SELECT source_content_state FROM reviews WHERE id = ${ABSENT_REVIEW_ID}
      `)
      expect(stored.rows).toEqual([{ source_content_state: 'active' }])
      expect(await runState()).toMatchObject({ state: 'deleting' })
      await resetGapScope()
    })
  })
})
