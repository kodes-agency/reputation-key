// The retention dry run against real PostgreSQL: seeded rows on each side of a
// rule's age boundary give the expected counts, the counts equal what the sweep
// then deletes or redacts, and a predicate that tries to write is refused.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { RETENTION_RULES } from '#/shared/jobs/retention-sweep.job'
import { runRetentionDryRun } from './dry-run-retention'
import { executeRetentionRule, type RetentionRule } from './execute-retention-rule'
import { retentionRuleCutoff } from './retention-cutoff'

const SUFFIX = randomUUID().slice(0, 8).replaceAll('-', '')
const TABLE = `test_rk_kd_94_dry_run_${SUFFIX}`
const NOW = new Date('2026-09-22T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000
const at = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString()

const DELETE_RULE: RetentionRule = {
  subject: 'test.delete',
  table: TABLE,
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMs: 30 * DAY_MS,
  extraWhere: `kind = 'delete'`,
}
const REDACT_RULE: RetentionRule = {
  subject: 'test.redact',
  table: TABLE,
  keyColumns: ['id'],
  tsColumn: 'created_at',
  olderThanMonths: 24,
  operation: 'redact',
  redactColumns: ['secret'],
  extraWhere: `kind = 'redact' AND secret IS NOT NULL`,
}

let lease: TestLease
let db: Database

const insert = async (kind: string, createdAt: string): Promise<void> => {
  await db.execute(
    sql`INSERT INTO ${sql.identifier(TABLE)} (id, kind, created_at, secret) VALUES (${randomUUID()}, ${kind}, ${createdAt}::timestamptz, 'x')`,
  )
}

const rowCount = async (where: ReturnType<typeof sql>): Promise<number> =>
  Number(
    (
      await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(TABLE)} WHERE ${where}`,
      )
    ).rows[0]?.n,
  )

describe.sequential('retention dry run (real PostgreSQL)', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    db = drizzle(lease.pool) as Database
    await db.execute(
      sql`CREATE TABLE ${sql.identifier(TABLE)} (id uuid PRIMARY KEY, kind text NOT NULL, created_at timestamptz NOT NULL, secret text)`,
    )
  })

  afterAll(async () => {
    if (db) {
      await db.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(TABLE)}`)
      await db.execute(sql`DROP FUNCTION IF EXISTS ${sql.identifier(`poke_${SUFFIX}`)}()`)
    }
    await lease?.release()
  })

  it('counts rows either side of each age boundary and matches what the sweep then does', async () => {
    const deleteCutoff = retentionRuleCutoff(DELETE_RULE, NOW)
    const redactCutoff = retentionRuleCutoff(REDACT_RULE, NOW)
    // Two rows past the 30-day horizon (the older one is the oldest), two inside it.
    await insert('delete', at(-45 * DAY_MS))
    await insert('delete', new Date(deleteCutoff.getTime() - 1).toISOString())
    await insert('delete', deleteCutoff.toISOString())
    await insert('delete', at(-1 * DAY_MS))
    // One row a millisecond past 24 UTC months, two at or inside the boundary.
    await insert('redact', new Date(redactCutoff.getTime() - 1).toISOString())
    await insert('redact', redactCutoff.toISOString())
    await insert('redact', at(-DAY_MS))

    const run = await runRetentionDryRun({
      db,
      rules: [DELETE_RULE, REDACT_RULE],
      now: NOW,
    })

    expect(run.rules).toEqual([
      {
        subject: 'test.delete',
        action: 'delete',
        cutoff: deleteCutoff.toISOString(),
        rows: 2,
        oldest: at(-45 * DAY_MS),
      },
      {
        subject: 'test.redact',
        action: 'redact',
        cutoff: redactCutoff.toISOString(),
        rows: 1,
        oldest: new Date(redactCutoff.getTime() - 1).toISOString(),
      },
    ])
    expect(await rowCount(sql`true`)).toBe(7)

    const deleted = await executeRetentionRule(db, DELETE_RULE, { cutoff: deleteCutoff })
    const redacted = await executeRetentionRule(db, REDACT_RULE, { cutoff: redactCutoff })

    expect(deleted.rowsDeleted).toBe(run.rules[0]?.rows)
    expect(redacted.rowsRedacted).toBe(run.rules[1]?.rows)
    expect(await rowCount(sql`kind = 'redact' AND secret IS NULL`)).toBe(1)

    const after = await runRetentionDryRun({
      db,
      rules: [DELETE_RULE, REDACT_RULE],
      now: NOW,
    })
    expect(after.totalRows).toBe(0)
  })

  it('cannot write: a predicate that inserts is refused and leaves no row', async () => {
    const poke = sql.identifier(`poke_${SUFFIX}`)
    await db.execute(
      sql`CREATE FUNCTION ${poke}() RETURNS boolean LANGUAGE plpgsql AS $f$ BEGIN INSERT INTO ${sql.identifier(TABLE)} (id, kind, created_at) VALUES (gen_random_uuid(), 'poked', now()); RETURN true; END $f$`,
    )
    const before = await rowCount(sql`true`)
    const writing: RetentionRule = {
      ...DELETE_RULE,
      extraWhere: `public.poke_${SUFFIX}()`,
    }

    const refusal = await runRetentionDryRun({ db, rules: [writing], now: NOW }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(String((refusal as { cause?: unknown } | undefined)?.cause)).toMatch(
      /read-only transaction/,
    )

    expect(await rowCount(sql`true`)).toBe(before)
  })

  it('prints a count for every rule of the real registry without writing', async () => {
    const run = await runRetentionDryRun({ db, rules: RETENTION_RULES, now: NOW })

    expect(run.rules.map((rule) => rule.subject)).toEqual(
      RETENTION_RULES.map((rule) => rule.subject),
    )
    expect(run.rules.every((rule) => Number.isInteger(rule.rows))).toBe(true)
  })
})
