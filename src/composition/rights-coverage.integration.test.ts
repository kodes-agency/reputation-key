// Every composed executor at once against real PostgreSQL: one Organization
// holding Property A and B beside a second Organization, for a Property
// request and for an Organization request. Rows are compared as canonical JSON
// over the union of the executors' declared tables.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runNotificationRightsRequest } from '#/contexts/feed/application/public-api'
import { createNotificationRightsReplayers } from '#/contexts/feed/rights/replayer.server'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  holdRightsOrganization,
  RIGHTS_FIXTURE_AT,
  recordingJournalStore,
  rightsPlan,
  seedRightsOrganization,
  type RightsQuery,
  type RightsSeeded,
} from '#/shared/db/testing/rights-isolation-fixture'
import {
  runRightsExecutors,
  type RightsExecutor,
} from '#/shared/ops/rights/rights-executor'
import {
  createRightsJournal,
  type RightsJournalStore,
} from '#/shared/ops/rights/rights-journal'
import type { RightsRequestPlan } from '#/shared/ops/rights/rights-request-command'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease } from '#/shared/testing/test-environment-lease'
import { composeRightsExecutors, composeRightsReplayers } from './rights-executors'

const EXPIRES_AT = new Date('2027-08-01T00:00:00.000Z')

/** Parents first: the order rows are put back after a simulated restore. */
const SEEDED_TABLES = [
  'notifications',
  'notification_preferences',
  'recent_activity_entries',
  'recent_activity_replay_facts',
  'recent_activity_actor_label_redactions',
  'ai_property_review_population_daily',
  'ai_property_issue_groups',
  'ai_property_processing_profiles',
  'ai_organization_cost_windows',
] as const

async function seedProperty(
  query: RightsQuery,
  organizationId: string,
  propertyId: string,
): Promise<void> {
  const user = `user-${organizationId}`
  await query(
    `INSERT INTO notifications (
       id, user_id, organization_id, property_id, type, category, priority, status,
       resource_type, resource_id, event_id, title, created_at, updated_at
     ) VALUES ($1, $2, $3, $4::uuid, 'review.created', 'workflow_collaboration', 'normal',
               'unread', 'inbox_item', $5, $6, 'New review', $7, $7)`,
    [
      randomUUID(),
      user,
      organizationId,
      propertyId,
      `item-${propertyId}`,
      `event-${propertyId}`,
      RIGHTS_FIXTURE_AT,
    ],
  )
  await query(
    `INSERT INTO notification_preferences (
       id, user_id, organization_id, property_id, category, channel, enabled,
       cadence, created_at, updated_at
     ) VALUES ($1, $2, $3, $4::uuid, 'workflow_collaboration', 'email', false, 'daily', $5, $5)`,
    [randomUUID(), user, organizationId, propertyId, RIGHTS_FIXTURE_AT],
  )
  await query(
    `INSERT INTO recent_activity_entries
       (actor_id, actor_name, actor_role, action, resource_type, resource_id,
        property_id, organization_id, event_id)
     VALUES ('user:a', 'Actor', 'admin', 'created', 'review', $3, $2, $1, $3)`,
    [organizationId, propertyId, `event-${propertyId}`],
  )
  await query(
    `INSERT INTO recent_activity_replay_facts
       (replay_key, source_kind, disposition, organization_id, property_id,
        source_event_id, source_event_type, source_event_version, source_context,
        source_aggregate_id, source_occurred_at)
     VALUES ($3::text, 'durable_fact', 'obsolete', $1, $2, $3::text, 'review.created', 1,
             'review', $3::text, $4)`,
    [organizationId, propertyId, `replay-${propertyId}`, RIGHTS_FIXTURE_AT],
  )
  await query(
    `INSERT INTO ai_property_review_population_daily
       (organization_id, property_id, local_date, source_epoch, property_profile_version,
        calendar_profile_version, review_count, text_review_count, rating_1_count,
        rating_2_count, rating_3_count, rating_4_count, rating_5_count,
        population_revision, updated_at)
     VALUES ($1, $2::uuid, '2026-07-31', 0, 1, 'v1', 1, 0, 0, 0, 0, 0, 1, 1, $3)`,
    [organizationId, propertyId, RIGHTS_FIXTURE_AT],
  )
  await query(
    `INSERT INTO ai_property_issue_groups
       (organization_id, property_id, topic, canonical_key, created_at, updated_at,
        last_seen_at, expires_at, normalization_version)
     VALUES ($1, $2::uuid, 'cleanliness', '__topic__', $3, $3, $3, $4, 'v1')`,
    [organizationId, propertyId, RIGHTS_FIXTURE_AT, EXPIRES_AT],
  )
  await query(
    `INSERT INTO ai_property_processing_profiles
       (property_id, organization_id, country_code, timezone, processing_region,
        routing_policy_version, provider_deployment_profile_version, source_epoch,
        profile_version, lifecycle_state, updated_at)
     VALUES ($2::uuid, $1, 'US', 'UTC', 'global', 1, 'v1', 0, 1, 'active', $3)`,
    [organizationId, propertyId, RIGHTS_FIXTURE_AT],
  )
}

async function seedOrganization(query: RightsQuery, organizationId: string) {
  await query(
    `INSERT INTO recent_activity_actor_label_redactions
       (organization_id, actor_subject_id, redacted_at, expires_at)
     VALUES ($1, 'user:a', $2, $3)`,
    [organizationId, RIGHTS_FIXTURE_AT, EXPIRES_AT],
  )
  await query(
    `INSERT INTO ai_organization_cost_windows (organization_id, window_start)
     VALUES ($1, date_trunc('month', now()))`,
    [organizationId],
  )
}

/** Executors whose report names counts by label rather than by table. */
const REPORTS_BY_LABEL: ReadonlyArray<string> = ['google-integration']

describe('rights coverage across the composed executors', () => {
  const organizations = new Set<string>()
  let lease: Awaited<ReturnType<typeof acquireTestLease>>
  let db: Database
  let query: RightsQuery
  /** Declared tables that carry the Organization column, with their Property column. */
  let declared: ReadonlyArray<Readonly<{ table: string; hasProperty: boolean }>>

  const executors = (): ReadonlyArray<RightsExecutor> =>
    composeRightsExecutors(
      {
        db,
        portalObjectStore: { deleteObject: async () => {} },
        runNotification: (run) =>
          runNotificationRightsRequest(
            db,
            async () => {
              throw new Error('no job queue in this test')
            },
            run,
          ),
        now: () => RIGHTS_FIXTURE_AT,
      },
      false,
    )

  async function seed(properties: number): Promise<RightsSeeded> {
    const seeded = await seedRightsOrganization(query, properties, (org, property) =>
      seedProperty(query, org, property),
    )
    await seedOrganization(query, seeded.organizationId)
    organizations.add(seeded.organizationId)
    return seeded
  }

  async function snapshotOf(organizationId: string, propertyId?: string) {
    const tables: Record<string, unknown> = {}
    for (const { table, hasProperty } of declared) {
      if (propertyId && !hasProperty) continue
      const result = await query(
        `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows
         FROM "${table}" t WHERE t.organization_id = $1
         ${propertyId ? 'AND t.property_id::text = $2' : ''}`,
        propertyId ? [organizationId, propertyId] : [organizationId],
      )
      tables[table] = result.rows[0]?.rows
    }
    return JSON.stringify(tables)
  }

  const rowTotal = (snapshot: string) =>
    Object.values(JSON.parse(snapshot) as Record<string, unknown[]>).reduce(
      (sum, rows) => sum + rows.length,
      0,
    )

  async function run(plan: RightsRequestPlan, store: RightsJournalStore) {
    const out: string[] = []
    const err: string[] = []
    const code = await runRightsExecutors({
      plan,
      executors: executors(),
      journal: createRightsJournal(store),
      io: { out: (line) => out.push(line), err: (line) => err.push(line) },
      writeExportFile: async () => {},
    })
    return { code, out, err }
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
    const names = new Set(executors().flatMap((e) => e.tables.organization))
    const columns = await query(
      `SELECT table_name,
              bool_or(column_name = 'organization_id') AS has_org,
              bool_or(column_name = 'property_id') AS has_property
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       GROUP BY table_name ORDER BY table_name`,
      [[...names]],
    )
    declared = columns.rows
      .filter((row) => row.has_org === true)
      .map((row) => ({
        table: String(row.table_name),
        hasProperty: row.has_property === true,
      }))
  })
  afterAll(async () => lease.release())
  afterEach(async () => {
    for (const organizationId of organizations) {
      for (const { table } of declared) {
        await lease.pool.query(`DELETE FROM "${table}" WHERE organization_id = $1`, [
          organizationId,
        ])
      }
      await lease.pool.query('DELETE FROM work_items WHERE organization_id = $1', [
        organizationId,
      ])
      await lease.pool.query('DELETE FROM properties WHERE organization_id = $1', [
        organizationId,
      ])
    }
    await deleteTestOrganizations(lease.pool, [...organizations])
    organizations.clear()
  })

  it('reports from every executor that covers each scope', async () => {
    const first = await seed(2)
    for (const scope of ['property', 'organization'] as const) {
      const plan = rightsPlan(scope, first.organizationId, {
        mode: 'report',
        ...(scope === 'property' ? { propertyId: first.propertyIds[0] } : {}),
      })
      const result = await run(plan, recordingJournalStore().store)
      expect(result.code).toBe(0)
      for (const executor of executors().filter((e) => e.scopes.includes(scope))) {
        expect(
          result.out.some((line) => line.startsWith(`${executor.name}:`)),
          `${executor.name} reports for ${scope}`,
        ).toBe(true)
      }
    }
  })

  it('names every declared table in the report of each executor that reports by table', async () => {
    const first = await seed(2)
    for (const scope of ['property', 'organization'] as const) {
      const result = await run(
        rightsPlan(scope, first.organizationId, {
          mode: 'report',
          ...(scope === 'property' ? { propertyId: first.propertyIds[0] } : {}),
        }),
        recordingJournalStore().store,
      )
      for (const executor of executors().filter((e) => e.scopes.includes(scope))) {
        if (REPORTS_BY_LABEL.includes(executor.name)) continue
        const text = result.out
          .filter((line) => line.startsWith(`${executor.name}:`))
          .join('\n')
        const missing = executor.tables[scope].filter((table) => !text.includes(table))
        expect(missing, `${executor.name} report for ${scope}`).toEqual([])
      }
    }
  })

  it('erases Property A across every executor and leaves B and the other Organization byte-identical', async () => {
    const first = await seed(2)
    const other = await seed(1)
    const [a, b] = first.propertyIds as [string, string]
    const aBefore = await snapshotOf(first.organizationId, a)
    const bBefore = await snapshotOf(first.organizationId, b)
    const otherBefore = await snapshotOf(other.organizationId)
    expect(rowTotal(aBefore)).toBeGreaterThan(0)
    const { store, entries } = recordingJournalStore()

    const result = await run(
      rightsPlan('property', first.organizationId, { propertyId: a }),
      store,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(rowTotal(await snapshotOf(first.organizationId, a))).toBe(0)
    expect(await snapshotOf(first.organizationId, b)).toBe(bBefore)
    expect(await snapshotOf(other.organizationId)).toBe(otherBefore)
    const journaled = new Set(entries().map((entry) => entry.context))
    for (const executor of executors().filter((e) => e.scopes.includes('property'))) {
      for (const context of executor.journalContexts) expect(journaled).toContain(context)
    }
  })

  it('erases the Organization across every executor and leaves the other one byte-identical', async () => {
    const first = await seed(2)
    const other = await seed(1)
    await holdRightsOrganization(query, first.organizationId)
    const firstBefore = await snapshotOf(first.organizationId)
    const otherBefore = await snapshotOf(other.organizationId)
    expect(rowTotal(firstBefore)).toBeGreaterThan(0)

    const result = await run(
      rightsPlan('organization', first.organizationId),
      recordingJournalStore().store,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(rowTotal(await snapshotOf(first.organizationId))).toBe(0)
    expect(await snapshotOf(other.organizationId)).toBe(otherBefore)
  })

  it('changes nothing and raises the alert when the journal write rejects', async () => {
    const first = await seed(2)
    const other = await seed(1)
    const a = first.propertyIds[0]!
    const firstBefore = await snapshotOf(first.organizationId)
    const otherBefore = await snapshotOf(other.organizationId)
    const alert = vi.fn()

    const result = await run(
      rightsPlan('property', first.organizationId, { propertyId: a }),
      {
        put: async () => {
          throw new Error('bucket unavailable')
        },
        alert,
      },
    )

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalled()
    expect(await snapshotOf(first.organizationId)).toBe(firstBefore)
    expect(await snapshotOf(other.organizationId)).toBe(otherBefore)
  })

  it('erases Property A again when every executor replays after a restore', async () => {
    const first = await seed(2)
    const other = await seed(1)
    const [a, b] = first.propertyIds as [string, string]
    const aBefore = JSON.parse(await snapshotOf(first.organizationId, a)) as Record<
      string,
      unknown[]
    >
    const bBefore = await snapshotOf(first.organizationId, b)
    const otherBefore = await snapshotOf(other.organizationId)
    const { store, entries } = recordingJournalStore()
    expect(
      (await run(rightsPlan('property', first.organizationId, { propertyId: a }), store))
        .code,
    ).toBe(0)

    for (const table of SEEDED_TABLES) {
      const rows = aBefore[table] ?? []
      if (rows.length === 0) continue
      await query(
        `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(null::"${table}", $1::jsonb)`,
        [JSON.stringify(rows)],
      )
    }
    expect(rowTotal(await snapshotOf(first.organizationId, a))).toBeGreaterThan(0)

    const replayed = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries(),
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: composeRightsReplayers({
          db,
          now: () => RIGHTS_FIXTURE_AT,
          notificationReplayers: createNotificationRightsReplayers(),
        }),
      }),
    )

    expect(replayed.verified).toBe(true)
    expect(rowTotal(await snapshotOf(first.organizationId, a))).toBe(0)
    expect(await snapshotOf(first.organizationId, b)).toBe(bBefore)
    expect(await snapshotOf(other.organizationId)).toBe(otherBefore)
  })
})
