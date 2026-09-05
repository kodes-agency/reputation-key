import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { COMPATIBILITY_READ_TABLES } from '../application/compatibility-read-inventory'
import { readCompatibilityReadInventory } from './compatibility-read-inventory.repository'

let lease: TestLease
let db: Database

const AS_OF = new Date('2026-08-28T00:00:00.000Z')

type TransactionConfig = Readonly<{ isolationLevel?: string; accessMode?: string }>

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

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
})

afterAll(async () => {
  await lease.release()
})

describe('compatibility-read inventory (real PostgreSQL)', () => {
  it('counts all seven mirrors in one repeatable-read, read-only snapshot', async () => {
    const configs: TransactionConfig[] = []
    const report = await readCompatibilityReadInventory(
      observedDatabase(db, configs),
      AS_OF,
    )

    expect(report.tableCount).toBe(4)
    expect(report.tables.map(({ tableName }) => tableName).sort()).toEqual([
      'feedback',
      'portal_group_members',
      'ratings',
      'scan_events',
    ])
    for (const table of report.tables) {
      const direct = await db.execute(
        sql.raw(`SELECT count(*)::text AS row_count FROM public."${table.tableName}"`),
      )
      expect(table.rowCount, table.tableName).toBe(
        Number((direct.rows[0] as { row_count: string }).row_count),
      )
    }
    expect(report.totalRows).toBe(
      report.tables.reduce((total, { rowCount }) => total + rowCount, 0),
    )
    expect(configs).toEqual([
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ])
  })

  it('selects zero guest content — only counts and schema metadata', async () => {
    const report = await readCompatibilityReadInventory(db, AS_OF)
    const serialized = JSON.stringify(report)

    // No rating value, no feedback text, no scan identifier. The only
    // identifiers present are table, constraint and foreign-key column names
    // that PostgreSQL itself reports, so the content columns of every mirror
    // must be absent.
    for (const forbidden of [
      'comment',
      'session_id',
      'visitor',
      'ip_address',
      'user_agent',
      'payload',
      'gbp_place_id',
      'data_type',
      'initiated_by',
      'stars',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden)
    }

    const source = readFileSync(
      join(
        process.cwd(),
        'src/contexts/guest/infrastructure/compatibility-read-inventory.repository.ts',
      ),
      'utf8',
    )
    expect(source).toContain('count(*)')
    expect(source).not.toMatch(/\b(?:DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/u)
  })

  it('reports foreign-key metadata for every mirror endpoint', async () => {
    const report = await readCompatibilityReadInventory(db, AS_OF)
    const mirrorNames = new Set<string>(
      COMPATIBILITY_READ_TABLES.map(({ tableName }) => tableName),
    )

    expect(report.foreignKeys.length).toBeGreaterThan(0)
    for (const foreignKey of report.foreignKeys) {
      expect(
        mirrorNames.has(foreignKey.sourceTable) ||
          mirrorNames.has(foreignKey.targetTable),
        foreignKey.constraintName,
      ).toBe(true)
      expect(foreignKey.sourceColumns.length).toBeGreaterThan(0)
      expect(foreignKey.sourceColumns).toHaveLength(foreignKey.targetColumns.length)
      expect(['simple', 'full', 'partial']).toContain(foreignKey.matchType)
      expect(typeof foreignKey.validated).toBe('boolean')
    }
    expect(
      report.externalOutboundDependencies.map(({ targetTable }) => targetTable),
    ).toEqual(expect.arrayContaining(['portals', 'portal_groups']))
    expect(report.schemaContractionCandidate).toBe(false)
    expect(report.blockers).toContain(
      'compatibility_read_removal_requires_verified_release_and_restore_proof',
    )
  })
})
