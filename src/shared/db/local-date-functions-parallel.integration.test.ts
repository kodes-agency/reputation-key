// The Property local-date SQL functions against a real parallel plan.
//
// `ai_property_local_date_v1` and `ai_property_local_midnight_v1` end in an
// `EXCEPTION WHEN ... THEN RETURN NULL` clause, and a PL/pgSQL EXCEPTION clause
// starts a subtransaction every time its block is entered. While they were
// labelled PARALLEL SAFE, a query that read `reviews` with a Parallel Seq Scan
// failed with "cannot start subtransactions during a parallel operation"
// (SQLSTATE 25000): on 2026-10-27 Review's trend population read did, for the
// Properties whose table had grown past the planner's threshold, and their
// daily trend dead-lettered.
//
// PARALLEL RESTRICTED would not have helped. The function would then run in the
// group leader, which is in parallel mode for the whole statement as soon as the
// plan holds a Gather node, and a restricted filter beside a Parallel Seq Scan
// of the other table is exactly such a plan. The control cases below show both
// labels failing on the shape of the real read. Only PARALLEL UNSAFE, which
// keeps the planner from building a parallel plan around the function, is safe.
//
// PostgreSQL 17 lets a parallel worker enter a subtransaction, so the control
// cases that show the refusal run only where it exists: production and CI are on
// PostgreSQL 16. The cases about the real functions hold on every version.
//
// Every case runs in a transaction that is rolled back: the probe tables and the
// labelled copies of the functions never outlive it. The parallel settings are
// SET LOCAL, so they never reach another connection.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const LOCAL_DATE = 'ai_property_local_date_v1'
const LOCAL_MIDNIGHT = 'ai_property_local_midnight_v1'
const PROBE_ROWS = 20_000
const SUBTRANSACTION_REFUSED = /cannot start subtransactions during a parallel operation/u
/** SQLSTATE class 25: invalid transaction state. */
const INVALID_TRANSACTION_STATE = '25000'
/** The first server version whose parallel workers may start a subtransaction. */
const FIRST_VERSION_WITHOUT_REFUSAL = 170_000

/** Settings that make the planner choose a parallel plan for a small table. */
const FORCE_PARALLEL_PLAN = [
  'SET LOCAL max_parallel_workers_per_gather = 2',
  'SET LOCAL parallel_setup_cost = 0',
  'SET LOCAL parallel_tuple_cost = 0',
  'SET LOCAL min_parallel_table_scan_size = 0',
  'SET LOCAL min_parallel_index_scan_size = 0',
]

type Label = 'SAFE' | 'RESTRICTED' | 'UNSAFE'

/**
 * The read's shape: a table scanned in parallel (the reviews), joined to one
 * that is filtered by the function (the source contents), ordered and limited,
 * with the function in the select list and in the filter.
 */
function readShape(localDate: string): string {
  return `
    SELECT review.id::text AS "reviewId",
           ${localDate}(source.reviewed_at, 'Europe/Sofia')::text AS "localDate"
    FROM probe_reviews AS review
    INNER JOIN probe_sources AS source ON source.review_id = review.id
    WHERE review.organization_id = 'probe-org'
      AND ${localDate}(source.reviewed_at, 'Europe/Sofia')
          BETWEEN DATE '2000-01-01' AND DATE '2100-01-01'
    ORDER BY source.reviewed_at, review.id
    LIMIT 10001`
}

describe('the Property local-date functions under a parallel plan', () => {
  let lease: TestLease
  let serverRefusesSubtransactions: boolean

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    const { rows } = await lease.pool.query<{ version: string }>(
      `SELECT current_setting('server_version_num') AS version`,
    )
    serverRefusesSubtransactions =
      Number(rows[0]?.version) < FIRST_VERSION_WITHOUT_REFUSAL
  })

  afterAll(async () => {
    await lease?.release()
  })

  /**
   * Runs `work` in a transaction that is rolled back, with the two probe tables
   * built and a plan that goes parallel wherever the functions allow it.
   */
  async function inProbeTransaction<T>(
    work: (run: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<T>,
  ): Promise<T> {
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`
        CREATE TABLE probe_reviews AS
          SELECT gen_random_uuid() AS id, 'probe-org'::text AS organization_id
          FROM generate_series(1, ${PROBE_ROWS})`)
      await client.query(`
        CREATE TABLE probe_sources AS
          SELECT id AS review_id,
                 TIMESTAMPTZ '2026-08-01 00:00:00+00' + (row_number() OVER ()) * INTERVAL '1 minute' AS reviewed_at
          FROM probe_reviews`)
      await client.query('ANALYZE probe_reviews')
      await client.query('ANALYZE probe_sources')
      for (const setting of FORCE_PARALLEL_PLAN) await client.query(setting)
      return await work(async (sql) => (await client.query(sql)).rows)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  /** A copy of a real function under another name and another parallel label. */
  async function labelledCopy(
    run: (sql: string) => Promise<Record<string, unknown>[]>,
    name: string,
    signature: string,
    label: Label,
  ): Promise<string> {
    const copy = `probe_${name}_${label.toLowerCase()}`
    const [current] = await run(
      `SELECT pg_get_functiondef('public.${name}(${signature})'::regprocedure) AS definition`,
    )
    await run(
      String(current?.definition).replaceAll(`public.${name}(`, `public.${copy}(`),
    )
    await run(`ALTER FUNCTION public.${copy}(${signature}) PARALLEL ${label}`)
    return copy
  }

  async function planOf(
    run: (sql: string) => Promise<Record<string, unknown>[]>,
    sql: string,
  ): Promise<string> {
    const rows = await run(`EXPLAIN (COSTS OFF) ${sql}`)
    return rows.map((row) => String(row['QUERY PLAN'])).join('\n')
  }

  it('labels both functions PARALLEL UNSAFE', async () => {
    const { rows } = await lease.pool.query<{ name: string; parallel: string }>(
      `SELECT proname AS name, proparallel AS parallel
       FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)
       ORDER BY proname`,
      [[LOCAL_DATE, LOCAL_MIDNIGHT]],
    )

    expect(rows).toEqual([
      { name: LOCAL_DATE, parallel: 'u' },
      { name: LOCAL_MIDNIGHT, parallel: 'u' },
    ])
  })

  it('keeps volatility and strictness as they were', async () => {
    const { rows } = await lease.pool.query<{
      name: string
      volatility: string
      strict: boolean
    }>(
      `SELECT proname AS name, provolatile AS volatility, proisstrict AS strict
       FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1)
       ORDER BY proname`,
      [[LOCAL_DATE, LOCAL_MIDNIGHT]],
    )

    expect(rows).toEqual([
      { name: LOCAL_DATE, volatility: 'i', strict: true },
      { name: LOCAL_MIDNIGHT, volatility: 's', strict: true },
    ])
  })

  it('runs the real read shape without a parallel plan, and without the subtransaction error', async () => {
    const { plan, rows } = await inProbeTransaction(async (run) => ({
      plan: await planOf(run, readShape(LOCAL_DATE)),
      rows: await run(readShape(LOCAL_DATE)),
    }))

    expect(plan).not.toMatch(/Gather|Parallel/u)
    expect(rows).toHaveLength(10_001)
    expect(rows[0]).toMatchObject({ localDate: '2026-08-01' })
  })

  it('answers a read through the midnight function, which calls the date function', async () => {
    const midnights = await inProbeTransaction((run) =>
      run(`
        SELECT count(*)::int AS "count"
        FROM probe_sources AS source
        WHERE ${LOCAL_MIDNIGHT}(
                ${LOCAL_DATE}(source.reviewed_at, 'Europe/Sofia'), 'Europe/Sofia'
              ) IS NOT NULL`),
    )

    expect(midnights).toEqual([{ count: PROBE_ROWS }])
  })

  it('shows the harness forces a parallel plan: a PARALLEL SAFE copy of the date function fails the same read', async ({
    skip,
  }) => {
    if (!serverRefusesSubtransactions) skip('this server runs subtransactions in workers')
    const outcome = await inProbeTransaction(async (run) => {
      const safe = await labelledCopy(
        run,
        LOCAL_DATE,
        'timestamp with time zone, text',
        'SAFE',
      )
      const plan = await planOf(run, readShape(safe))
      const error = await run(readShape(safe)).then(
        () => undefined,
        (caught: unknown) => caught as { code?: string; message?: string },
      )
      return { plan, error }
    })

    expect(outcome.plan).toContain('Gather')
    expect(outcome.error?.code).toBe(INVALID_TRANSACTION_STATE)
    expect(outcome.error?.message).toMatch(SUBTRANSACTION_REFUSED)
  })

  it('shows PARALLEL RESTRICTED is not the fix: the leader runs the function in parallel mode and fails the same read', async ({
    skip,
  }) => {
    if (!serverRefusesSubtransactions) skip('this server runs subtransactions in workers')
    const outcome = await inProbeTransaction(async (run) => {
      const restricted = await labelledCopy(
        run,
        LOCAL_DATE,
        'timestamp with time zone, text',
        'RESTRICTED',
      )
      const plan = await planOf(run, readShape(restricted))
      const error = await run(readShape(restricted)).then(
        () => undefined,
        (caught: unknown) => caught as { code?: string; message?: string },
      )
      return { plan, error }
    })

    // The restricted filter stays out of the workers, but the other table is
    // still read through a Gather node, so the statement runs in parallel mode.
    expect(outcome.plan).toContain('Gather')
    expect(outcome.error?.code).toBe(INVALID_TRANSACTION_STATE)
    expect(outcome.error?.message).toMatch(SUBTRANSACTION_REFUSED)
  })

  it('shows PARALLEL UNSAFE copies of the date function plan serially and answer', async () => {
    const outcome = await inProbeTransaction(async (run) => {
      const unsafe = await labelledCopy(
        run,
        LOCAL_DATE,
        'timestamp with time zone, text',
        'UNSAFE',
      )
      return {
        plan: await planOf(run, readShape(unsafe)),
        rows: await run(readShape(unsafe)),
      }
    })

    expect(outcome.plan).not.toMatch(/Gather|Parallel/u)
    expect(outcome.rows).toHaveLength(10_001)
  })
})
