// The schema drift check compares the DB-only functions and triggers by
// definition, against a real migrated catalog.
//
// It used to compare names. A function whose body or signature differed from
// db-constructs.sql, a second overload beside it, and a trigger recreated with
// other events all passed, because each kept its name. Every case here makes one
// such change inside a transaction that is rolled back, and reads the drift the
// operator command (`pnpm check:schema-drift`) would print for it.

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { collectSchemaDrift, type Drift } from './schema-drift'

const WATERMARK_MIGRATION = new URL(
  '../../../drizzle/0006_reset_analysis_watermark_on_epoch.sql',
  import.meta.url,
)

describe('construct definition drift against the migrated catalog', () => {
  let lease: TestLease

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  /** Drift for one object after `change` ran in a transaction that never commits. */
  async function driftAfter(
    object: string,
    change: (run: (sql: string) => Promise<Record<string, unknown>[]>) => Promise<void>,
  ): Promise<readonly Drift[]> {
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await change(async (sql) => (await client.query(sql)).rows)
      const drifts = await collectSchemaDrift(client)
      return drifts.filter((drift) => drift.object === object)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  it('finds no function or trigger whose definition differs after migration', async () => {
    const drifts = await collectSchemaDrift(lease.pool)

    expect(drifts.filter(({ object }) => /^(function|trigger) /u.test(object))).toEqual(
      [],
    )
  })

  it('reports a function whose body is not the one the file states', async () => {
    const drifts = await driftAfter('function ai_epoch_millis_v1', async (run) => {
      const [current] = await run(
        `SELECT pg_get_functiondef('public.ai_epoch_millis_v1(timestamptz)'::regprocedure) AS definition`,
      )
      await run(
        String(current?.definition).replace(
          'AS $function$',
          'AS $function$\n-- superseded body',
        ),
      )
    })

    expect(drifts).toHaveLength(1)
    expect(drifts[0]?.kind).toBe('mismatch')
    expect(drifts[0]?.detail).toMatch(
      /^definition differs from src\/shared\/db\/db-constructs\.sql at line 3: expected \[.+\] vs db \[-- superseded body\]$/u,
    )
  })

  it('reports the 26-argument overload a stale restatement leaves beside the live function', async () => {
    const drifts = await driftAfter(
      'function apply_merchant_ai_transition_v1',
      async (run) => {
        // Migration 0006 is the 26-argument text; 0016 dropped that signature for
        // a 27-argument one. Restating the old text does not replace the live
        // function: it adds a second one, and every 26-argument call turns
        // ambiguous.
        await run(readFileSync(WATERMARK_MIGRATION, 'utf8'))
      },
    )

    expect(drifts.map(({ kind, detail }) => [kind, detail])).toEqual([
      [
        'mismatch',
        '2 definition(s) in db vs 1 in drizzle/0016_merchant_ai_notice_v2_ceremony.sql',
      ],
    ])
  })

  it('reports a trigger recreated with other events under the same name', async () => {
    const drifts = await driftAfter(
      'trigger backup_erasure_ledger_update_delete_guard',
      async (run) => {
        await run(
          'DROP TRIGGER backup_erasure_ledger_update_delete_guard ON public.backup_erasure_ledger',
        )
        await run(
          'CREATE TRIGGER backup_erasure_ledger_update_delete_guard BEFORE DELETE ON public.backup_erasure_ledger FOR EACH ROW EXECUTE FUNCTION reject_backup_erasure_ledger_mutation_v1()',
        )
      },
    )

    expect(drifts).toHaveLength(1)
    expect(drifts[0]?.kind).toBe('mismatch')
    expect(drifts[0]?.detail).toMatch(
      /^definition differs from src\/shared\/db\/db-constructs\.sql at line 1: expected \[.*BEFORE DELETE OR UPDATE ON backup_erasure_ledger .*\] vs db \[.*BEFORE DELETE ON backup_erasure_ledger .*\]$/u,
    )
  })
})
