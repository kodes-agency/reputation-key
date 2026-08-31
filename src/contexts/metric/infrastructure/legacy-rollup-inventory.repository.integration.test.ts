import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { LEGACY_ROLLUP_TABLES } from '../application/legacy-rollup-inventory'
import { readLegacyRollupInventory } from './legacy-rollup-inventory.repository'

let lease: TestLease
let db: Database

const SEED_ORGANIZATION = `rollup-inventory-${randomUUID()}`
const SEED_WATERMARK = `rollup-inventory-${randomUUID()}`
const AS_OF = new Date('2026-08-28T00:00:00.000Z')

type TransactionConfig = Readonly<{ isolationLevel?: string; accessMode?: string }>

/**
 * Wraps the real database so the transaction options the repository asks for
 * are observable, while the statements still execute against PostgreSQL. A
 * mock would prove the argument shape; this proves the driver accepted it.
 */
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
      sql`DELETE FROM public.rollup_daily_metrics WHERE organization_id = ${SEED_ORGANIZATION}`,
    )
    await db.execute(
      sql`DELETE FROM public.rollup_weekly_metrics WHERE organization_id = ${SEED_ORGANIZATION}`,
    )
    await db.execute(
      sql`DELETE FROM public.rollup_daily_inbox_metrics WHERE organization_id = ${SEED_ORGANIZATION}`,
    )
    await db.execute(
      sql`DELETE FROM public._rollup_watermarks WHERE name = ${SEED_WATERMARK}`,
    )
  }
  await lease.release()
})

describe('legacy Metric rollup inventory (real PostgreSQL)', () => {
  it('reports exact counts for every rollup table in one repeatable-read, read-only snapshot', async () => {
    const configs: TransactionConfig[] = []
    const observed = observedDatabase(db, configs)

    const before = await readLegacyRollupInventory(observed, AS_OF)
    expect(before.tableCount).toBe(4)
    expect(before.tables.map(({ tableName }) => tableName).sort()).toEqual([
      '_rollup_watermarks',
      'rollup_daily_inbox_metrics',
      'rollup_daily_metrics',
      'rollup_weekly_metrics',
    ])
    for (const table of before.tables) {
      expect(table.rowCount, table.tableName).toBe(await directCount(table.tableName))
    }

    const propertyId = randomUUID()
    const portalId = randomUUID()
    await db.execute(sql`
      INSERT INTO public.rollup_daily_metrics
        (organization_id, property_id, portal_id, metric_key, date, count, sum_value, avg_value)
      VALUES
        (${SEED_ORGANIZATION}, ${propertyId}, ${portalId}, 'scans', '2026-08-01T00:00:00Z', 3, 3, 1),
        (${SEED_ORGANIZATION}, ${propertyId}, ${portalId}, 'ratings', '2026-08-02T00:00:00Z', 2, 8, 4)
    `)
    await db.execute(sql`
      INSERT INTO public.rollup_weekly_metrics
        (organization_id, property_id, portal_id, metric_key, week, count, sum_value, avg_value)
      VALUES
        (${SEED_ORGANIZATION}, ${propertyId}, ${portalId}, 'scans', '2026-07-27T00:00:00Z', 5, 5, 1)
    `)
    await db.execute(sql`
      INSERT INTO public.rollup_daily_inbox_metrics
        (organization_id, property_id, date, open_count, closed_count, escalated_count)
      VALUES (${SEED_ORGANIZATION}, ${propertyId}, '2026-08-01T00:00:00Z', 1, 0, 0)
    `)
    await db.execute(sql`
      INSERT INTO public._rollup_watermarks (name, watermark)
      VALUES (${SEED_WATERMARK}, '2026-08-01T00:00:00Z')
    `)

    const after = await readLegacyRollupInventory(observed, AS_OF)
    const delta = (tableName: string) =>
      (after.tables.find((table) => table.tableName === tableName)?.rowCount ?? 0) -
      (before.tables.find((table) => table.tableName === tableName)?.rowCount ?? 0)

    expect(delta('rollup_daily_metrics')).toBe(2)
    expect(delta('rollup_weekly_metrics')).toBe(1)
    expect(delta('rollup_daily_inbox_metrics')).toBe(1)
    expect(delta('_rollup_watermarks')).toBe(1)
    expect(after.totalRows).toBe(before.totalRows + 5)
    expect(after.blockers).toContain('retained_rows_require_export_restore')
    expect(after.schemaContractionCandidate).toBe(false)
    expect(after.fingerprint).not.toBe(before.fingerprint)

    expect(configs).toHaveLength(2)
    for (const config of configs) {
      expect(config).toEqual({
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      })
    }
  })

  it('reads ordered foreign-key metadata with action, match, deferrability, and validation', async () => {
    const report = await readLegacyRollupInventory(db, AS_OF)

    // The rollup projections are denormalised copies with no declared
    // constraints today. That absence is itself the evidence an external run
    // needs, so the assertion pins the shape rather than requiring a row.
    for (const foreignKey of report.foreignKeys) {
      expect(foreignKey.sourceColumns.length).toBeGreaterThan(0)
      expect(foreignKey.sourceColumns).toHaveLength(foreignKey.targetColumns.length)
      expect(['no_action', 'restrict', 'cascade', 'set_null', 'set_default']).toContain(
        foreignKey.onDelete,
      )
      expect(['no_action', 'restrict', 'cascade', 'set_null', 'set_default']).toContain(
        foreignKey.onUpdate,
      )
      expect(['simple', 'full', 'partial']).toContain(foreignKey.matchType)
      expect(typeof foreignKey.deferrable).toBe('boolean')
      expect(typeof foreignKey.initiallyDeferred).toBe('boolean')
      expect(typeof foreignKey.validated).toBe('boolean')
    }
    const governed = (table: string) =>
      LEGACY_ROLLUP_TABLES.some(({ tableName }) => tableName === table)
    const internal = report.foreignKeys.filter(
      ({ sourceTable, targetTable }) => governed(sourceTable) && governed(targetTable),
    )
    expect(
      report.externalInboundDependencies.length +
        report.externalOutboundDependencies.length +
        internal.length,
    ).toBe(report.foreignKeys.length)
  })
})
