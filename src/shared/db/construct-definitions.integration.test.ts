// pg_dump observes committed catalogue changes through a separate read-only
// connection. Each planted fault is restored before the next test runs.

import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { checkStructure } from './structure.server'

const WATERMARK_MIGRATION = new URL(
  '../../../drizzle/0006_reset_analysis_watermark_on_epoch.sql',
  import.meta.url,
)

describe('construct definition drift against the migrated catalog', () => {
  let lease: TestLease
  let url: string

  beforeAll(async () => {
    url = getEnv().DATABASE_URL
    lease = await acquireTestLease(url)
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function detectsChange(
    change: () => Promise<void>,
    restore: () => Promise<void>,
  ) {
    expect(await checkStructure(url)).toEqual([])
    try {
      await change()
      expect(await checkStructure(url)).toEqual([
        expect.objectContaining({ object: 'structure.sql' }),
      ])
    } finally {
      await restore()
    }
    expect(await checkStructure(url)).toEqual([])
  }

  it('finds no function or trigger whose definition differs after migration', async () => {
    expect(await checkStructure(url)).toEqual([])
  })

  it('keeps only the promised ledger and transition guards enabled for replica sessions', async () => {
    const { rows } = await lease.pool.query<{ name: string; mode: string }>(`
      SELECT t.tgname AS name, t.tgenabled AS mode
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
      ORDER BY t.tgname
    `)
    expect(rows.filter(({ mode }) => mode === 'A')).toEqual([
      { name: 'backup_erasure_ledger_truncate_guard', mode: 'A' },
      { name: 'backup_erasure_ledger_update_delete_guard', mode: 'A' },
    ])
    expect(
      rows.filter(({ mode }) => mode !== 'A').every(({ mode }) => mode === 'O'),
    ).toBe(true)
  })

  it('reports an ALWAYS guard downgraded to ordinary enablement', async () => {
    await detectsChange(
      async () => {
        await lease.pool.query(
          'ALTER TABLE public.backup_erasure_ledger ENABLE TRIGGER backup_erasure_ledger_update_delete_guard',
        )
      },
      async () => {
        await lease.pool.query(
          'ALTER TABLE public.backup_erasure_ledger ENABLE ALWAYS TRIGGER backup_erasure_ledger_update_delete_guard',
        )
      },
    )
  })

  it('reports a function whose body differs under the same signature', async () => {
    const current = await lease.pool.query<{ definition: string }>(
      `SELECT pg_get_functiondef('public.ai_epoch_millis_v1(timestamptz)'::regprocedure) AS definition`,
    )
    const definition = current.rows[0]!.definition
    const changed = definition.replace('AS $function$', 'AS $function$\n-- changed body')
    expect(changed).not.toBe(definition)
    await detectsChange(
      async () => {
        await lease.pool.query(changed)
      },
      async () => {
        await lease.pool.query(definition)
      },
    )
  })

  it('reports the 26-argument overload beside the live function', async () => {
    await detectsChange(
      async () => {
        await lease.pool.query(readFileSync(WATERMARK_MIGRATION, 'utf8'))
      },
      async () => {
        const result = await lease.pool.query<{ signature: string }>(
          `SELECT p.oid::regprocedure::text AS signature FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'apply_merchant_ai_transition_v1'
             AND p.pronargs = 26`,
        )
        for (const { signature } of result.rows) {
          await lease.pool.query(`DROP FUNCTION ${signature}`)
        }
      },
    )
  })

  it('reports a trigger recreated with other events under the same name', async () => {
    const original = await lease.pool.query<{ definition: string }>(
      `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
       WHERE tgrelid = 'public.backup_erasure_ledger'::regclass
         AND tgname = 'backup_erasure_ledger_update_delete_guard'`,
    )
    const drop =
      'DROP TRIGGER IF EXISTS backup_erasure_ledger_update_delete_guard ON public.backup_erasure_ledger'
    await detectsChange(
      async () => {
        await lease.pool.query(drop)
        await lease.pool.query(
          'CREATE TRIGGER backup_erasure_ledger_update_delete_guard BEFORE DELETE ON public.backup_erasure_ledger FOR EACH ROW EXECUTE FUNCTION reject_backup_erasure_ledger_mutation_v1()',
        )
      },
      async () => {
        await lease.pool.query(drop)
        await lease.pool.query(original.rows[0]!.definition)
        await lease.pool.query(
          'ALTER TABLE public.backup_erasure_ledger ENABLE ALWAYS TRIGGER backup_erasure_ledger_update_delete_guard',
        )
      },
    )
  })
})
