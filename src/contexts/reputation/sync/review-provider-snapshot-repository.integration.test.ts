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

import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getPool } from '#/shared/db/pool'
import { reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { organizationId } from '#/shared/domain/ids'
import { createReviewSourceContentLifecycleStore } from '../content/source-content-lifecycle-store.server'
import {
  EXPIRES_AT,
  LIFECYCLE_RUN_ID,
  ORGANIZATION_ID,
  OTHER_RUN_ID,
  PROPERTY_ID,
  PROVIDER_DELETE_GATE_CLASS,
  PROVIDER_DELETE_GATE_OBJECT,
  REPLY_ID,
  REVIEW_ID,
  RUN_ID,
  STARTED_AT,
  TEST_KEY_VERSION,
  useSnapshotRepositoryDb,
  waitForDatabaseCondition,
} from './review-provider-snapshot-repository.test-fixtures'

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const { db, repository } = useSnapshotRepositoryDb()

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
  // (snapshot-listing-change.server.ts).
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

  it('leaves snapshot runs past their record expiry to the bounded clean-up when the tombstone sweep runs', async () => {
    const terminalAt = new Date(STARTED_AT.getTime() - 60 * 24 * 60 * 60 * 1000)
    await db.insert(reviewProviderSnapshotRuns).values({
      id: OTHER_RUN_ID,
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 0,
      state: 'failed',
      phase: 'terminal',
      failureCode: 'listing_changed',
      startedAt: new Date(terminalAt.getTime() - 60_000),
      expiresAt: EXPIRES_AT,
      terminalAt,
      recordExpiresAt: new Date(terminalAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    })

    await repository.sweepExpiredTombstones({
      beforeOrAt: new Date(STARTED_AT.getTime() + 24 * 60 * 60 * 1000),
      afterReviewId: null,
      limit: 100,
    })

    const rows = await db
      .select({ id: reviewProviderSnapshotRuns.id })
      .from(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.id, OTHER_RUN_ID))
    expect(rows).toHaveLength(1)
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
        external_location_id, expires_at, source_epoch, source_revision,
        analysis_sequence, reply_state_revision, created_at, updated_at
      ) VALUES (
        ${REVIEW_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 'google',
        'safe03-provider-review', 'safe03-provider-location', ${EXPIRES_AT},
        0, 1, 0, 0, ${STARTED_AT}, ${STARTED_AT}
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

      lifecycleApply = createReviewSourceContentLifecycleStore(
        db,
        replyScopeEffects,
      ).applyLifecycleBatch({
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
})
