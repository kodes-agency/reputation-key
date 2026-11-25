// Property-level erasure through the Google rights executor, against real
// PostgreSQL: one Property's import items go, its sibling, the other
// Organization and the control rows stay byte-identical.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { getImportProgress } from '#/contexts/integration/imports/import-progress-store.server'
import { createImportRetention } from '#/contexts/integration/imports/import-retention.server'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import {
  propertyApplyArgv,
  propertyReportArgv,
  recordingRightsJournal,
} from '#/shared/db/testing/rights-request-script'
import { watchTenants } from '#/shared/db/testing/rights-tenant-snapshot'
import { createGoogleRightsReplayers } from './google-rights-executor'
import {
  CREATED_AT,
  MARKERS,
  NOW,
  ORGANIZATION_REPORT_LINE,
  RECEIPT_SCOPES,
  apply,
  harness,
  importRow,
  itemRow,
  pendingItemRow,
  rowCount,
  runScript,
  seed,
  seedSoloImports,
  snapshot,
  useGoogleRightsHarness,
  type Fixture,
} from '#/shared/testing/google-rights-executor.test-fixtures'

describe.sequential('Google rights executor through the rights-request command', () => {
  useGoogleRightsHarness((pool) => drizzle(pool) as Database)

  it("erases one Property's import items and prunes emptied parents", async () => {
    const asked = await seed({ live: false })
    await seedSoloImports(asked, asked.propertyId)
    const items = (table: string, column: string, propertyId: string) =>
      harness.lease.pool
        .query(
          `SELECT count(*)::int AS count FROM ${table}
           WHERE organization_id = $1 AND ${column} = $2`,
          [asked.organizationId, propertyId],
        )
        .then((result) => Number(result.rows[0]?.count))
    const report = await runScript(
      propertyReportArgv(asked.organizationId, asked.propertyId),
    )
    expect(report.exit).toBe(0)
    expect(report.out.join('\n')).toContain('import_items=2')

    const result = await runScript(
      propertyApplyArgv(asked.organizationId, asked.propertyId, 'T-2'),
    )

    expect(result.exit).toBe(0)
    expect(
      await items('google_import_items', 'destination_property_id', asked.propertyId),
    ).toBe(0)
    expect(
      await items(
        'google_import_items',
        'destination_property_id',
        asked.siblingPropertyId,
      ),
    ).toBe(1)
    // The shared import keeps its parent for the sibling; the solo import is gone.
    expect(await rowCount('google_imports', asked.organizationId)).toBe(1)
  })

  it('keeps the shared import readable and purgeable after one Property is erased', async () => {
    const asked = await seed({ live: false })
    const thirdPropertyId = randomUUID()
    await harness.lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Third Property', $3, 'UTC', $4, $4)`,
      [thirdPropertyId, asked.organizationId, `third-${thirdPropertyId}`, CREATED_AT],
    )
    const threeItemImportId = randomUUID()
    await importRow(asked, threeItemImportId, 3)
    for (const propertyId of [
      asked.propertyId,
      asked.siblingPropertyId,
      thirdPropertyId,
    ]) {
      await itemRow(asked, threeItemImportId, propertyId)
    }

    const result = await runScript(
      propertyApplyArgv(asked.organizationId, asked.propertyId, 'T-5'),
    )
    expect(result.exit).toBe(0)

    const counts = await harness.lease.pool.query(
      `SELECT parent.total_count::int AS total_count,
              (SELECT count(*)::int FROM google_import_items AS item
                WHERE item.organization_id = parent.organization_id
                  AND item.import_id = parent.id) AS item_count
       FROM google_imports AS parent
       WHERE parent.organization_id = $1 ORDER BY parent.id`,
      [asked.organizationId],
    )
    expect(counts.rows).toHaveLength(2)
    for (const row of counts.rows) expect(row.total_count).toBe(row.item_count)

    const progress = await getImportProgress(
      harness.db,
      asked.organizationId,
      threeItemImportId,
      () => NOW,
    )
    expect(progress?.totalCount).toBe(2)
    expect(progress?.items).toHaveLength(2)

    const purged = await createImportRetention(harness.db).purgeParent({
      organizationId: asked.organizationId,
      importJobId: threeItemImportId,
      expectedDeletionFence: 0,
      now: NOW,
      outboxEventId: randomUUID(),
    })
    expect(purged).toBe('purged')
    const left = await harness.lease.pool.query(
      `SELECT count(*)::int AS count FROM google_import_items
       WHERE organization_id = $1 AND import_id = $2`,
      [asked.organizationId, threeItemImportId],
    )
    expect(left.rows[0]?.count).toBe(0)
  })

  it('refuses to erase a Property with an import item in flight', async () => {
    const asked = await seed({ live: false })
    await pendingItemRow(asked, asked.importId, asked.propertyId)
    const before = await snapshot(asked.organizationId)

    const result = await runScript(
      propertyApplyArgv(asked.organizationId, asked.propertyId, 'T-3'),
    )

    expect(result.exit).not.toBe(0)
    expect(result.err.join('\n')).toContain('in_flight_import_items=1')
    expect(await snapshot(asked.organizationId)).toBe(before)
  })

  describe('Property A, Property B and a second Organization', () => {
    type Tenant = Readonly<{ fixture: Fixture }>

    async function seedTenant(live: boolean): Promise<Tenant> {
      const fixture = await seed({ live })
      await seedSoloImports(fixture, fixture.propertyId)
      await seedSoloImports(fixture, fixture.siblingPropertyId)
      return { fixture }
    }

    /** B's import items with the imports they hang on; a shared import's count follows its items. */
    async function propertySnapshot(fixture: Fixture, propertyId: string) {
      const parts: string[] = []
      const queries: ReadonlyArray<readonly [string, string]> = [
        [
          'google_import_items',
          `SELECT to_jsonb(t.*)::text AS row FROM google_import_items AS t
           WHERE t.organization_id = $1 AND t.destination_property_id = $2`,
        ],
        [
          'google_imports',
          `SELECT (to_jsonb(p.*) - 'total_count')::text AS row FROM google_imports AS p
           WHERE p.organization_id = $1 AND p.id IN (
             SELECT import_id FROM google_import_items
             WHERE organization_id = $1 AND destination_property_id = $2)`,
        ],
      ]
      for (const [label, query] of queries) {
        const result = await harness.lease.pool.query(query, [
          fixture.organizationId,
          propertyId,
        ])
        const rows = result.rows.map((row) => String(row.row)).sort()
        parts.push(`${label}:${rows.join('|')}`)
      }
      return parts.join('\n')
    }

    /** The connection, permits and receipts a Property erase never touches. */
    async function controlSnapshot(fixture: Fixture): Promise<string> {
      const parts: string[] = []
      for (const table of ['google_connections', 'authorization_execution_permits']) {
        const result = await harness.lease.pool.query(
          `SELECT to_jsonb(t.*)::text AS row FROM ${table} AS t
           WHERE organization_id = $1 ORDER BY 1`,
          [fixture.organizationId],
        )
        parts.push(`${table}:${result.rows.map((row) => String(row.row)).join('|')}`)
      }
      return parts.join('\n')
    }

    async function everything(tenant: Tenant) {
      const { fixture } = tenant
      return {
        whole: await snapshot(fixture.organizationId),
        b: await propertySnapshot(fixture, fixture.siblingPropertyId),
        control: await controlSnapshot(fixture),
      }
    }

    const propertyApplyArgs = (fixture: Fixture) =>
      propertyApplyArgv(fixture.organizationId, fixture.propertyId, 'T-4')

    /** Puts a restore back: every captured row, parents first, existing rows kept. */
    async function restoreRows(
      captured: ReadonlyArray<readonly [string, ReadonlyArray<unknown>]>,
    ): Promise<void> {
      for (const [table, rows] of captured) {
        if (rows.length === 0) continue
        // A restore brings back the parent's count as it was, not only its rows.
        const onConflict =
          table === 'google_imports'
            ? 'DO UPDATE SET total_count = EXCLUDED.total_count'
            : 'DO NOTHING'
        await harness.lease.pool.query(
          `INSERT INTO ${table}
           SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)
           ON CONFLICT (id) ${onConflict}`,
          [JSON.stringify(rows)],
        )
      }
    }

    async function captureRows(fixture: Fixture) {
      const captured: Array<readonly [string, ReadonlyArray<unknown>]> = []
      for (const table of ['google_imports', 'google_import_items']) {
        const result = await harness.lease.pool.query(
          `SELECT to_jsonb(t.*) AS row FROM ${table} AS t WHERE organization_id = $1`,
          [fixture.organizationId],
        )
        captured.push([table, result.rows.map((row) => row.row as unknown)])
      }
      return captured
    }

    const propertyItems = async (fixture: Fixture, propertyId: string) =>
      (await propertySnapshot(fixture, propertyId)).split('\n').filter((line) => {
        const [, rows = ''] = line.split(/:(.*)/su)
        return rows.length > 0
      }).length

    const googleReplayers = createGoogleRightsReplayers(() => NOW)

    it('reports the counts of each Property and each Organization', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)

      for (const { fixture } of [asked, other]) {
        for (const propertyId of [fixture.propertyId, fixture.siblingPropertyId]) {
          const report = await runScript(
            propertyReportArgv(fixture.organizationId, propertyId),
          )
          expect(report.exit).toBe(0)
          expect(report.out).toContain(
            'google-integration: import_items=2 imports=1 authorization_execution_permits=0',
          )
          expect(report.out).toContain('google-integration: erasure blockers: none')
        }
        const org = await runScript(['organization', '--org', fixture.organizationId])
        expect(org.out).toContain(ORGANIZATION_REPORT_LINE)
        expect(org.out).toContain('google-integration: closure blockers: none')
      }
    })

    /** Every row of a query as text, so a before/after diff needs no report code. */
    async function rowTexts(from: string, where: string, args: unknown[]) {
      const result = await harness.lease.pool.query(
        `SELECT to_jsonb(t.*)::text AS row FROM ${from} AS t WHERE ${where}`,
        args,
      )
      return result.rows.map((row) => String(row.row))
    }

    const reportSources: ReadonlyArray<
      readonly [
        label: string,
        table: string,
        where: string,
        args: (id: string) => unknown[],
      ]
    > = [
      ['connections', 'google_connections', 't.organization_id = $1', (id) => [id]],
      ['imports', 'google_imports', 't.organization_id = $1', (id) => [id]],
      ['import_items', 'google_import_items', 't.organization_id = $1', (id) => [id]],
      [
        'import_discovery_records',
        'google_import_discovery_records',
        't.organization_id = $1',
        (id) => [id],
      ],
      [
        'idempotency_receipts',
        'idempotency_receipts',
        `t.scope = ANY($2::text[]) AND t.payload->>'organizationId' = $1`,
        (id) => [id, RECEIPT_SCOPES],
      ],
      [
        'authorization_execution_permits',
        'authorization_execution_permits',
        't.organization_id = $1',
        (id) => [id],
      ],
    ]

    async function reportedRows(organizationId: string) {
      const rows = new Map<string, string[]>()
      for (const [label, table, where, args] of reportSources) {
        rows.set(label, await rowTexts(table, where, args(organizationId)))
      }
      return rows
    }

    /** Per table, the rows that were deleted or changed in place. */
    function touchedLine(before: Map<string, string[]>, after: Map<string, string[]>) {
      return reportSources
        .map(([label]) => {
          const kept = new Set(after.get(label))
          const touched = (before.get(label) ?? []).filter((row) => !kept.has(row))
          return `${label}=${touched.length}`
        })
        .join(' ')
    }

    async function organizationReport(organizationId: string): Promise<string> {
      const { out } = await runScript(['organization', '--org', organizationId])
      const prefix = 'google-integration: '
      const line = out.find((entry) => entry.startsWith(`${prefix}connections=`))
      return (line ?? '').slice(prefix.length)
    }

    async function propertyReport(fixture: Fixture, propertyId: string) {
      const { out } = await runScript(
        propertyReportArgv(fixture.organizationId, propertyId),
      )
      return out.filter((entry) => entry.startsWith('google-integration: import_items='))
    }

    it('reports for an Organization exactly the rows its closure deletes or scrubs', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { organizationId } = asked.fixture
      const otherId = other.fixture.organizationId
      const otherBefore = await reportedRows(otherId)
      const otherReport = await organizationReport(otherId)
      const report = await organizationReport(organizationId)
      const before = await reportedRows(organizationId)

      const result = await runScript(apply(organizationId))

      expect(result.exit).toBe(0)
      const after = await reportedRows(organizationId)
      expect(report).toBe(touchedLine(before, after))
      expect(`google-integration: ${report}`).toBe(ORGANIZATION_REPORT_LINE)
      expect(after.get('import_items')).toEqual([])
      expect(after.get('imports')).toEqual([])
      expect(after.get('import_discovery_records')).toEqual([])
      expect(after.get('idempotency_receipts')).toHaveLength(1)
      expect(await reportedRows(otherId)).toEqual(otherBefore)
      expect(await organizationReport(otherId)).toBe(otherReport)
    })

    it('reports for a Property exactly the items and imports its erase deletes', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { fixture } = asked
      const count = async (table: string) =>
        (await rowTexts(table, 't.organization_id = $1', [fixture.organizationId])).length
      const itemsBefore = await count('google_import_items')
      const importsBefore = await count('google_imports')
      const report = await propertyReport(fixture, fixture.propertyId)
      const otherReport = await propertyReport(other.fixture, other.fixture.propertyId)

      const result = await runScript(propertyApplyArgs(fixture))

      expect(result.exit).toBe(0)
      const items = itemsBefore - (await count('google_import_items'))
      const imports = importsBefore - (await count('google_imports'))
      expect(report).toEqual([
        `google-integration: import_items=${items} imports=${imports} authorization_execution_permits=0`,
      ])
      expect([items, imports]).toEqual([2, 1])
      expect(await propertyReport(other.fixture, other.fixture.propertyId)).toEqual(
        otherReport,
      )
    })

    it('erases A, leaves B and the other Organization byte-identical, and replays a restore', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { fixture } = asked
      const before = await everything(asked)
      const otherBefore = await snapshot(other.fixture.organizationId)
      const restoreSet = await captureRows(fixture)
      const journal = recordingRightsJournal()

      const result = await runScript(propertyApplyArgs(fixture), {
        journalStore: journal.store,
      })

      expect(result.exit).toBe(0)
      expect(await propertyItems(fixture, fixture.propertyId)).toBe(0)
      const after = await everything(asked)
      expect(after.b).toBe(before.b)
      expect(after.control).toBe(before.control)
      expect(after.whole).not.toBe(before.whole)
      expect(await snapshot(other.fixture.organizationId)).toBe(otherBefore)

      const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        context: 'integration',
        subjectClass: 'property',
        propertyId: fixture.propertyId,
      })

      await restoreRows(restoreSet)
      expect(await snapshot(fixture.organizationId)).toBe(before.whole)
      expect(await propertyItems(fixture, fixture.propertyId)).toBeGreaterThan(0)

      const fence = await harness.db.transaction((tx) =>
        applyRestoreResurrectionFence(tx, {
          entries,
          restorePointAt: new Date(NOW.getTime() - 86_400_000),
          replayers: googleReplayers,
        }),
      )

      expect(fence.verified).toBe(true)
      expect(fence.counts.ledgerEntriesReapplied).toBe(1)
      expect(fence.counts.ledgerRowsReErased).toBeGreaterThan(0)
      expect(await propertyItems(fixture, fixture.propertyId)).toBe(0)
      const replayed = await everything(asked)
      expect(replayed.whole).toBe(after.whole)
      expect(replayed.b).toBe(before.b)
      expect(replayed.control).toBe(before.control)
      expect(await snapshot(other.fixture.organizationId)).toBe(otherBefore)
    })

    it('scrubs credentials a restore brings back when an Organization closure is replayed', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const { fixture } = asked
      const otherBefore = await snapshot(other.fixture.organizationId)
      const restoreSet = await captureRows(fixture)
      const journal = recordingRightsJournal()

      const result = await runScript(apply(fixture.organizationId), {
        journalStore: journal.store,
      })

      expect(result.exit).toBe(0)
      const erased = await snapshot(fixture.organizationId)
      const entries = [...journal.puts.values()].map(decodeErasureJournalEntry)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        context: 'integration',
        subjectClass: 'organization',
      })

      await restoreRows(restoreSet)
      await harness.lease.pool.query(
        `UPDATE google_connections
         SET google_subject = $2, encrypted_access_token = $3,
             encrypted_refresh_token = $4, credential_use_state = 'active',
             status = 'active', connected_by = $5
         WHERE organization_id = $1`,
        [
          fixture.organizationId,
          MARKERS.googleSubject,
          MARKERS.accessToken,
          MARKERS.refreshToken,
          fixture.userId,
        ],
      )
      expect(await snapshot(fixture.organizationId)).not.toBe(erased)

      const fence = await harness.db.transaction((tx) =>
        applyRestoreResurrectionFence(tx, {
          entries,
          restorePointAt: new Date(NOW.getTime() - 86_400_000),
          replayers: googleReplayers,
        }),
      )

      expect(fence.verified).toBe(true)
      expect(fence.counts.ledgerEntriesReapplied).toBe(1)
      expect(await snapshot(fixture.organizationId)).toBe(erased)
      expect(await snapshot(other.fixture.organizationId)).toBe(otherBefore)
    })

    it('changes nothing and raises the alert when the journal write is rejected', async () => {
      const asked = await seedTenant(false)
      const other = await seedTenant(false)
      const tenants = await watchTenants(snapshot, [
        asked.fixture.organizationId,
        other.fixture.organizationId,
      ])
      const alerts: unknown[] = []

      const result = await runScript(propertyApplyArgs(asked.fixture), {
        journalStore: {
          put: async () => {
            throw new Error('bucket unavailable')
          },
          alert: (input) => {
            alerts.push(input)
          },
        },
      })

      expect(result.exit).not.toBe(0)
      expect(alerts).toHaveLength(1)
      expect(result.err.join('\n')).toContain('Erasure journal write failed')
      await tenants.expectUnchanged()
    })

    it('refuses an Organization closure with a live connection and leaves both Organizations unchanged', async () => {
      const asked = await seedTenant(true)
      const other = await seedTenant(false)
      const journal = recordingRightsJournal()
      const tenants = await watchTenants(snapshot, [
        asked.fixture.organizationId,
        other.fixture.organizationId,
      ])

      const result = await runScript(apply(asked.fixture.organizationId), {
        journalStore: journal.store,
      })

      expect(result.exit).toBe(1)
      expect(result.err.join('\n')).toContain('live_connections=1')
      expect(result.err.join('\n')).toContain('nothing was changed')
      expect(journal.puts.size).toBe(0)
      await tenants.expectUnchanged()
    })
  })
})
