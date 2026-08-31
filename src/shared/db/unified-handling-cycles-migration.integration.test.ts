import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const FIXTURE_SCHEMA = 'unified_handling_cycle_fixture'
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0132_unified_source_handling_cycles.sql'),
  'utf8',
)
const guestBackfill = migration
  .slice(
    migration.indexOf('DO $$\nDECLARE\n  ambiguous_count bigint;'),
    migration.indexOf('-- The opening table is protected'),
  )
  .replaceAll('--> statement-breakpoint', '')

async function resetFixture(lease: TestLease): Promise<void> {
  await lease.pool.query(`DROP SCHEMA IF EXISTS "${FIXTURE_SCHEMA}" CASCADE`)
  await lease.pool.query(`CREATE SCHEMA "${FIXTURE_SCHEMA}"`)
  await lease.pool.query(`
    CREATE TABLE "${FIXTURE_SCHEMA}".guest_responses (
      id text PRIMARY KEY,
      feedback_submitted_at timestamptz,
      feedback_submission_revision integer,
      correction_count integer NOT NULL,
      corrected_at timestamptz
    )
  `)
}

describe.sequential('0132 Guest feedback revision backfill (PostgreSQL)', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
  })

  beforeEach(async () => {
    await resetFixture(lease)
  })

  afterAll(async () => {
    await lease.pool.query(`DROP SCHEMA IF EXISTS "${FIXTURE_SCHEMA}" CASCADE`)
    await lease.release()
  })

  it('derives only historically provable submission revisions', async () => {
    await lease.pool.query(
      `INSERT INTO "${FIXTURE_SCHEMA}".guest_responses
         (id, feedback_submitted_at, correction_count, corrected_at)
       VALUES
         ('initial', '2026-01-01T00:00:00Z', 0, NULL),
         ('before-only-correction', '2026-01-01T00:00:00Z', 1,
          '2026-01-02T00:00:00Z'),
         ('added-by-only-correction', '2026-01-02T00:00:00Z', 1,
          '2026-01-02T00:00:00Z'),
         ('added-by-latest-correction', '2026-01-04T00:00:00Z', 3,
          '2026-01-04T00:00:00Z')`,
    )

    const client = await lease.pool.connect()
    try {
      await client.query(`SET search_path TO "${FIXTURE_SCHEMA}", public`)
      await client.query(guestBackfill)
    } finally {
      client.release()
    }

    const result = await lease.pool.query<{
      id: string
      feedback_submission_revision: number
    }>(
      `SELECT id, feedback_submission_revision
       FROM "${FIXTURE_SCHEMA}".guest_responses
       ORDER BY id`,
    )
    expect(result.rows).toEqual([
      { id: 'added-by-latest-correction', feedback_submission_revision: 4 },
      { id: 'added-by-only-correction', feedback_submission_revision: 2 },
      { id: 'before-only-correction', feedback_submission_revision: 1 },
      { id: 'initial', feedback_submission_revision: 1 },
    ])
  })

  it.each([
    {
      name: 'missing latest correction time',
      correctionCount: 1,
      correctedAt: null,
    },
    {
      name: 'feedback before the latest of multiple corrections',
      correctionCount: 2,
      correctedAt: '2026-01-03T00:00:00Z',
    },
  ])('aborts rather than inventing a revision for $name', async (fixture) => {
    await lease.pool.query(
      `INSERT INTO "${FIXTURE_SCHEMA}".guest_responses
         (id, feedback_submitted_at, correction_count, corrected_at)
       VALUES ('ambiguous', '2026-01-01T00:00:00Z', $1, $2)`,
      [fixture.correctionCount, fixture.correctedAt],
    )

    const client = await lease.pool.connect()
    try {
      await client.query(`SET search_path TO "${FIXTURE_SCHEMA}", public`)
      await expect(client.query(guestBackfill)).rejects.toThrow(
        'guest feedback submission revision backfill is ambiguous',
      )
    } finally {
      client.release()
    }

    const result = await lease.pool.query<{
      feedback_submission_revision: number | null
    }>(
      `SELECT feedback_submission_revision
       FROM "${FIXTURE_SCHEMA}".guest_responses
       WHERE id = 'ambiguous'`,
    )
    expect(result.rows).toEqual([{ feedback_submission_revision: null }])
  })
})
