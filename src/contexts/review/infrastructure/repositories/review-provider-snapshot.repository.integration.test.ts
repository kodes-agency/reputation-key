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
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { properties, reviewProviderSnapshotRuns } from '#/shared/db/schema'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { createReviewProviderSnapshotRepository } from './review-provider-snapshot.repository'

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

describe('review provider snapshot repository (real PostgreSQL)', () => {
  const db = getDb()
  // `finishMainScan` publishes nothing, so a recording bus is enough and keeps
  // the test to the statements under examination.
  const published: unknown[] = []
  const repository = createReviewProviderSnapshotRepository(db, {
    on: () => {},
    emit: async (event: unknown) => {
      published.push(event)
    },
    clear: () => {},
  } as unknown as Parameters<typeof createReviewProviderSnapshotRepository>[1])

  const clear = async () => {
    await db.execute(
      sql`DELETE FROM outbox_events WHERE organization_id = ${ORGANIZATION_ID}`,
    )
    await db
      .delete(reviewProviderSnapshotRuns)
      .where(eq(reviewProviderSnapshotRuns.propertyId, PROPERTY_ID))
    await db.delete(properties).where(eq(properties.id, PROPERTY_ID))
    await db.execute(
      sql`DELETE FROM review_provider_subject_hmac_key_versions WHERE key_version = ${TEST_KEY_VERSION}`,
    )
    await db.execute(sql`DELETE FROM organization WHERE id = ${ORGANIZATION_ID}`)
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
      processingRegion: 'europe',
      routingPolicyVersion: 1,
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

  it('fails a main scan whose observed set does not match the provider total', async () => {
    await seedCompletedMainScan()
    await db
      .update(reviewProviderSnapshotRuns)
      .set({ mainUniqueCount: 1 })
      .where(eq(reviewProviderSnapshotRuns.id, RUN_ID))

    const finished = await repository.finishMainScan({ runId: RUN_ID })

    expect(finished).toMatchObject({ status: 'failed', code: 'set_mismatch' })
  })

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

  it('preserves the stable Review and RepKey Reply when Google confirms the source is gone', async () => {
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
      INSERT INTO review_provider_snapshot_runs (
        id, organization_id, property_id, source_epoch, state, phase,
        started_at, expires_at, created_at, updated_at
      ) VALUES (
        ${LIFECYCLE_RUN_ID}, ${ORGANIZATION_ID}, ${PROPERTY_ID}, 0,
        'deleting', 'apply', ${STARTED_AT}, ${EXPIRES_AT},
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

    const applied = await repository.applyDeletionBatch({
      runId: LIFECYCLE_RUN_ID,
      limit: 100,
    })

    expect(applied).toMatchObject({ applied: 1, observed: 0, done: true })
    const reviewRows = await db.execute(sql`
      SELECT id, content_expires_at FROM reviews WHERE id = ${REVIEW_ID}
    `)
    const replyRows = await db.execute(sql`
      SELECT id, review_id FROM replies WHERE id = ${REPLY_ID}
    `)
    expect(reviewRows.rows).toHaveLength(1)
    expect(replyRows.rows).toEqual([
      expect.objectContaining({ id: REPLY_ID, review_id: REVIEW_ID }),
    ])
    const contentExpiresAt = new Date(String(reviewRows.rows[0]!.content_expires_at))
    expect(Number.isNaN(contentExpiresAt.getTime())).toBe(false)
    expect(contentExpiresAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('expires provider source without deleting stable Review and Reply rows', async () => {
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

    expect(result.transitioned).toBe(1)
    const reviewRows = await db.execute(
      sql`SELECT id FROM reviews WHERE id = ${EXPIRING_REVIEW_ID}`,
    )
    const replyRows = await db.execute(
      sql`SELECT id FROM replies WHERE id = ${EXPIRING_REPLY_ID}`,
    )
    expect(reviewRows.rows).toEqual([expect.objectContaining({ id: EXPIRING_REVIEW_ID })])
    expect(replyRows.rows).toEqual([expect.objectContaining({ id: EXPIRING_REPLY_ID })])
  })
})
