import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { readLegacyImportControlInventory } from './legacy-import-control-inventory.repository'

let lease: TestLease
let db: Database

const SEED_ENVIRONMENT = `inv-${randomUUID().slice(0, 24)}`
const AS_OF = new Date('2026-08-28T00:00:00.000Z')

type TransactionConfig = Readonly<{ isolationLevel?: string; accessMode?: string }>

/** Observes the transaction options while the statements still hit PostgreSQL. */
function observedDatabase(target: Database, configs: TransactionConfig[]): Database {
  return new Proxy(target, {
    get(source, property, receiver) {
      if (property !== 'transaction') return Reflect.get(source, property, receiver)
      return (operation: unknown, config?: TransactionConfig) => {
        configs.push(config ?? {})
        return (
          source.transaction as unknown as (
            operation: unknown,
            config?: TransactionConfig,
          ) => unknown
        )(operation, config)
      }
    },
  }) as Database
}

async function directCount(tableName: string): Promise<number> {
  const result = await db.execute(
    sql.raw(`SELECT count(*)::text AS row_count FROM public."${tableName}"`),
  )
  return Number((result.rows[0] as { row_count: string }).row_count)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  if (db) {
    await db.execute(
      sql`DELETE FROM public.legacy_import_effect_leases WHERE environment = ${SEED_ENVIRONMENT}`,
    )
    await db.execute(
      sql`DELETE FROM public.legacy_import_control WHERE environment = ${SEED_ENVIRONMENT}`,
    )
  }
  await lease.release()
})

describe('legacy Google import control inventory (real PostgreSQL)', () => {
  it('reports exact counts in one repeatable-read, read-only snapshot', async () => {
    const configs: TransactionConfig[] = []
    const observed = observedDatabase(db, configs)

    const before = await readLegacyImportControlInventory(observed, AS_OF)
    expect(before.tables.map(({ tableName }) => tableName)).toEqual([
      'legacy_import_control',
      'legacy_import_effect_leases',
    ])
    for (const table of before.tables) {
      expect(table.rowCount, table.tableName).toBe(await directCount(table.tableName))
    }

    await db.execute(sql`
      INSERT INTO public.legacy_import_control (environment, state, generation)
      VALUES (${SEED_ENVIRONMENT}, 'open', 1)
    `)
    await db.execute(sql`
      INSERT INTO public.legacy_import_effect_leases
        (environment, job_id, generation, worker_id, state, acquired_at)
      VALUES (${SEED_ENVIRONMENT}, ${randomUUID()}, 1, 'inventory-fixture', 'active', now())
    `)

    const after = await readLegacyImportControlInventory(observed, AS_OF)
    const delta = (tableName: string) =>
      (after.tables.find((table) => table.tableName === tableName)?.rowCount ?? 0) -
      (before.tables.find((table) => table.tableName === tableName)?.rowCount ?? 0)

    expect(delta('legacy_import_control')).toBe(1)
    expect(delta('legacy_import_effect_leases')).toBe(1)
    expect(after.totalRows).toBe(before.totalRows + 2)
    expect(after.blockers).toContain('retained_rows_require_export_restore')
    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(JSON.stringify(after)).not.toContain('inventory-fixture')

    expect(configs).toHaveLength(2)
    for (const config of configs) {
      expect(config).toEqual({
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      })
    }
  })

  it('reads ordered foreign-key metadata with action, match, deferrability, and validation', async () => {
    const report = await readLegacyImportControlInventory(db, AS_OF)

    const lease = report.foreignKeys.find(
      ({ constraintName }) => constraintName === 'legacy_import_effect_leases_control_fk',
    )
    expect(lease).toMatchObject({
      sourceSchema: 'public',
      sourceTable: 'legacy_import_effect_leases',
      sourceColumns: ['environment'],
      targetSchema: 'public',
      targetTable: 'legacy_import_control',
      targetColumns: ['environment'],
      onDelete: 'restrict',
      onUpdate: 'no_action',
      onDeleteSetColumns: null,
      matchType: 'simple',
      deferrable: false,
      initiallyDeferred: false,
      validated: true,
    })
    expect(
      report.foreignKeys.every(
        ({ sourceColumns, targetColumns }) =>
          sourceColumns.length > 0 && sourceColumns.length === targetColumns.length,
      ),
    ).toBe(true)
    expect(report.externalInboundDependencies).toEqual(
      report.foreignKeys.filter(
        ({ sourceTable }) =>
          sourceTable !== 'legacy_import_control' &&
          sourceTable !== 'legacy_import_effect_leases',
      ),
    )
  })
})
