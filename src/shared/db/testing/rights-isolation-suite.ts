// The isolation scenarios every rights executor repeats against real
// PostgreSQL: one Organization holding Property A and B beside a second
// Organization. Rows are compared as canonical JSON.

import type { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import {
  applyRestoreResurrectionFence,
  type BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { RightsExecutor } from '#/shared/ops/rights/rights-executor'
import {
  holdRightsOrganization,
  recordingJournalStore,
  rightsPlan,
  runRightsExecutor,
  seedRightsOrganization,
  type RightsQuery,
  type RightsSeeded,
} from './rights-isolation-fixture'

export type RightsIsolationTable = Readonly<{
  table: string
  /** Whether the rows carry a property_id, so a Property erasure can be compared. */
  hasProperty: boolean
}>

type SuitePool = Pool

/** The test environment, handed in because shared/db may not import shared/testing. */
export type RightsIsolationEnvironment = Readonly<{
  acquireTestLease: (
    url: string,
    size: number,
  ) => Promise<Readonly<{ pool: SuitePool; release: () => Promise<void> }>>
  deleteTestOrganizations: (
    pool: SuitePool,
    organizationIds: readonly string[],
  ) => Promise<void>
}>

export type RightsIsolationConfig = Readonly<{
  environment: RightsIsolationEnvironment
  name: string
  context: string
  /** Child tables first; the order rows are put back is the reverse. */
  tables: ReadonlyArray<RightsIsolationTable>
  executor: (db: Database) => RightsExecutor
  replayers: ReadonlyArray<BackupErasureReplayer>
  /** Adds the rows one Property holds; Organization-level rows go in seedOrganization. */
  seedProperty: (
    query: RightsQuery,
    organizationId: string,
    propertyId: string,
  ) => Promise<void>
  seedOrganization?: (query: RightsQuery, organizationId: string) => Promise<void>
  /** Removes fixture rows the executor does not own, before the Properties go. */
  cleanupOrganization?: (query: RightsQuery, organizationId: string) => Promise<void>
}>

type Seed = Readonly<{ first: RightsSeeded; other: RightsSeeded }>

function snapshotOf(
  query: RightsQuery,
  config: RightsIsolationConfig,
  organizationId: string,
  propertyId?: string,
): Promise<string> {
  return (async () => {
    const tables: Record<string, unknown> = {}
    for (const { table, hasProperty } of config.tables) {
      if (propertyId && !hasProperty) continue
      const result = await query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
         FROM ${table} t WHERE t.organization_id = $1
         ${propertyId ? 'AND t.property_id::text = $2' : ''}`,
        propertyId ? [organizationId, propertyId] : [organizationId],
      )
      tables[table] = result.rows[0]?.rows
    }
    return JSON.stringify(tables)
  })()
}

function rowTotal(snapshot: string): number {
  return Object.values(JSON.parse(snapshot) as Record<string, unknown[]>).reduce(
    (sum, rows) => sum + rows.length,
    0,
  )
}

async function putBack(
  query: RightsQuery,
  config: RightsIsolationConfig,
  snapshot: string,
): Promise<void> {
  const tables = JSON.parse(snapshot) as Record<string, unknown[]>
  for (const { table } of [...config.tables].reverse()) {
    const rows = tables[table] ?? []
    if (rows.length === 0) continue
    await query(
      `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)`,
      [JSON.stringify(rows)],
    )
  }
}

export function describeRightsIsolation(config: RightsIsolationConfig): void {
  const organizations = new Set<string>()
  let lease: Awaited<ReturnType<RightsIsolationEnvironment['acquireTestLease']>>
  let db: Database
  let query: RightsQuery

  async function seed(properties: number): Promise<RightsSeeded> {
    const seeded = await seedRightsOrganization(query, properties, (org, property) =>
      config.seedProperty(query, org, property),
    )
    await config.seedOrganization?.(query, seeded.organizationId)
    organizations.add(seeded.organizationId)
    return seeded
  }

  async function seedBoth(): Promise<Seed> {
    return { first: await seed(2), other: await seed(1) }
  }

  const executor = () => config.executor(db)
  const replay = (
    entries: Parameters<typeof applyRestoreResurrectionFence>[1]['entries'],
  ) =>
    db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries,
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: config.replayers,
      }),
    )

  describe(`${config.name} rights isolation`, () => {
    beforeAll(async () => {
      lease = await config.environment.acquireTestLease(getEnv().DATABASE_URL, 3)
      db = drizzle(lease.pool) as Database
      query = (text, params) => lease.pool.query(text, params)
    })
    afterAll(async () => lease.release())
    afterEach(async () => {
      for (const organizationId of organizations) {
        for (const { table } of config.tables) {
          await lease.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
            organizationId,
          ])
        }
        await config.cleanupOrganization?.(query, organizationId)
        await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
          organizationId,
        ])
      }
      await config.environment.deleteTestOrganizations(lease.pool, [...organizations])
      organizations.clear()
    })

    it('reports each Property and each Organization separately', async () => {
      const { first, other } = await seedBoth()
      const lines = async (organizationId: string, propertyId?: string) =>
        (
          await runRightsExecutor(
            executor(),
            propertyId
              ? rightsPlan('property', organizationId, { propertyId, mode: 'report' })
              : rightsPlan('organization', organizationId, { mode: 'report' }),
            recordingJournalStore().store,
          )
        ).out

      const organizationLines = await lines(first.organizationId)
      const propertyLines = await lines(first.organizationId, first.propertyIds[0])
      const otherLines = await lines(other.organizationId)

      expect(organizationLines.length).toBeGreaterThan(0)
      expect(propertyLines.length).toBeGreaterThan(0)
      expect(organizationLines).not.toEqual(otherLines)
      expect(organizationLines).not.toEqual(propertyLines)
    })

    it('erases Property A and leaves Property B and the other Organization byte-identical', async () => {
      const { first, other } = await seedBoth()
      const [a, b] = first.propertyIds as [string, string]
      const aBefore = await snapshotOf(query, config, first.organizationId, a)
      const bBefore = await snapshotOf(query, config, first.organizationId, b)
      const otherBefore = await snapshotOf(query, config, other.organizationId)
      expect(rowTotal(aBefore)).toBeGreaterThan(0)
      const { store, entries } = recordingJournalStore()

      const result = await runRightsExecutor(
        executor(),
        rightsPlan('property', first.organizationId, { propertyId: a }),
        store,
      )

      expect(result.err).toEqual([])
      expect(result.code).toBe(0)
      expect(entries().map((entry) => entry.context)).toEqual([config.context])
      expect(rowTotal(await snapshotOf(query, config, first.organizationId, a))).toBe(0)
      expect(await snapshotOf(query, config, first.organizationId, b)).toBe(bBefore)
      expect(await snapshotOf(query, config, other.organizationId)).toBe(otherBefore)
    })

    it('erases Property A again when the journal is replayed after a restore', async () => {
      const { first, other } = await seedBoth()
      const [a, b] = first.propertyIds as [string, string]
      const aBefore = await snapshotOf(query, config, first.organizationId, a)
      const bBefore = await snapshotOf(query, config, first.organizationId, b)
      const otherBefore = await snapshotOf(query, config, other.organizationId)
      const { store, entries } = recordingJournalStore()
      expect(
        (
          await runRightsExecutor(
            executor(),
            rightsPlan('property', first.organizationId, { propertyId: a }),
            store,
          )
        ).code,
      ).toBe(0)

      await putBack(query, config, aBefore)
      expect(await snapshotOf(query, config, first.organizationId, a)).toBe(aBefore)

      const result = await replay(entries())

      expect(result.verified).toBe(true)
      expect(result.counts.ledgerEntriesReapplied).toBe(1)
      expect(result.counts.ledgerRowsReErased).toBeGreaterThan(0)
      expect(rowTotal(await snapshotOf(query, config, first.organizationId, a))).toBe(0)
      expect(await snapshotOf(query, config, first.organizationId, b)).toBe(bBefore)
      expect(await snapshotOf(query, config, other.organizationId)).toBe(otherBefore)
    })

    it('erases the Organization, replays it after a restore and leaves the other one alone', async () => {
      const { first, other } = await seedBoth()
      holdRightsOrganization(first.organizationId)
      const firstBefore = await snapshotOf(query, config, first.organizationId)
      const otherBefore = await snapshotOf(query, config, other.organizationId)
      const { store, entries } = recordingJournalStore()

      const result = await runRightsExecutor(
        executor(),
        rightsPlan('organization', first.organizationId),
        store,
      )

      expect(result.err).toEqual([])
      expect(result.code).toBe(0)
      expect(rowTotal(await snapshotOf(query, config, first.organizationId))).toBe(0)
      expect(await snapshotOf(query, config, other.organizationId)).toBe(otherBefore)

      await putBack(query, config, firstBefore)
      const replayed = await replay(entries())

      expect(replayed.verified).toBe(true)
      expect(rowTotal(await snapshotOf(query, config, first.organizationId))).toBe(0)
      expect(await snapshotOf(query, config, other.organizationId)).toBe(otherBefore)
    })

    it('refuses an active Organization and leaves its rows unchanged', async () => {
      const { first } = await seedBoth()
      const before = await snapshotOf(query, config, first.organizationId)
      const put = vi.fn(async () => {})

      const result = await runRightsExecutor(
        executor(),
        rightsPlan('organization', first.organizationId),
        { put, alert: () => {} },
      )

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toMatch(/nothing was changed/)
      expect(put).not.toHaveBeenCalled()
      expect(await snapshotOf(query, config, first.organizationId)).toBe(before)
    })

    it('erases nothing and raises the alert when the journal write rejects', async () => {
      const { first, other } = await seedBoth()
      const a = first.propertyIds[0]!
      const firstBefore = await snapshotOf(query, config, first.organizationId)
      const otherBefore = await snapshotOf(query, config, other.organizationId)
      const alert = vi.fn()

      const result = await runRightsExecutor(
        executor(),
        rightsPlan('property', first.organizationId, { propertyId: a }),
        {
          put: async () => {
            throw new Error('bucket unavailable')
          },
          alert,
        },
      )

      expect(result.code).not.toBe(0)
      expect(alert).toHaveBeenCalledWith(
        expect.objectContaining({ context: config.context }),
      )
      expect(await snapshotOf(query, config, first.organizationId)).toBe(firstBefore)
      expect(await snapshotOf(query, config, other.organizationId)).toBe(otherBefore)
    })
  })
}
