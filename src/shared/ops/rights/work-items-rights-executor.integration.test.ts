// The platform's work-items executor against real PostgreSQL: a closed
// Organization beside a second Organization. Closure deletes only settled work
// and the outbox events a restore fenced of the closed Organization, journaled
// first, and a replay deletes them again.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  holdRightsOrganization,
  recordingJournalStore,
  rightsPlan,
  RIGHTS_FIXTURE_AT,
  runRightsExecutor,
  seedRightsOrganization,
  type RightsQuery,
} from '#/shared/db/testing/rights-isolation-fixture'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createWorkItemsRightsExecutor,
  workItemsErasureReplayer,
} from './work-items-rights-executor'

let lease: TestLease
let db: Database
let query: RightsQuery
const organizations: string[] = []
const recoveryRuns: string[] = []

async function seedWork(organizationId: string, state: string): Promise<void> {
  const settled = ['succeeded', 'cancelled', 'discarded'].includes(state)
  await query(
    `INSERT INTO work_items (
       organization_id, subject_id, kind, idempotency_key, recovery, state,
       due_at, dispatch_after, completed_at, operator_id, operator_reason)
     VALUES ($1, $2, 'outbox.delivery', $2, 'retry', $3, $4, $4, $5,
             'ops:dana', 'Dana Rivera asked to stop')`,
    [
      organizationId,
      randomUUID(),
      state,
      RIGHTS_FIXTURE_AT,
      settled ? RIGHTS_FIXTURE_AT : null,
    ],
  )
}

/** An event a restore fenced: never delivered, and the outbox retention never removes it. */
async function seedFencedEvent(organizationId: string): Promise<void> {
  const runId = randomUUID()
  recoveryRuns.push(runId)
  await query(
    `INSERT INTO recovery_runs (
       id, generation, source_release_sha, source_manifest_sha256, restore_point_at,
       operator_id, correlation_id, counts, completed_at, created_at)
     SELECT $1, COALESCE(MAX(generation), 0) + 1, $2, $3, $4, 'ops:rights-tester',
            'work-items-rights', '{}'::jsonb, $4, $4
     FROM recovery_runs`,
    [
      runId,
      'a'.repeat(40),
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
      RIGHTS_FIXTURE_AT,
    ],
  )
  await query(
    `INSERT INTO outbox_events (event_type, payload, organization_id, source_context,
                                source_aggregate_id, recovery_fence_run_id, recovery_fenced_at)
     VALUES ('identity.member.role_changed', jsonb_build_object('userId', 'user-dana'), $1,
             'identity', 'member-1', $2, $3)`,
    [organizationId, runId, RIGHTS_FIXTURE_AT],
  )
}

async function seed(): Promise<string> {
  const { organizationId } = await seedRightsOrganization(query, 1, async () => {})
  organizations.push(organizationId)
  await seedWork(organizationId, 'succeeded')
  await seedWork(organizationId, 'discarded')
  await seedFencedEvent(organizationId)
  return organizationId
}

async function tableRows(table: string, organizationId: string): Promise<unknown[]> {
  const result = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) AS rows
     FROM ${table} t WHERE organization_id = $1`,
    [organizationId],
  )
  return result.rows[0]?.rows as unknown[]
}

const rows = (organizationId: string) => tableRows('work_items', organizationId)
const events = (organizationId: string) => tableRows('outbox_events', organizationId)

const closure = (organizationId: string, store = recordingJournalStore().store) =>
  runRightsExecutor(
    createWorkItemsRightsExecutor(db),
    rightsPlan('organization', organizationId),
    store,
  )

describe('work-items rights executor', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
  })

  afterAll(async () => lease.release())

  afterEach(async () => {
    for (const organizationId of organizations) {
      await query('DELETE FROM work_items WHERE organization_id = $1', [organizationId])
      await query('DELETE FROM outbox_events WHERE organization_id = $1', [
        organizationId,
      ])
      await query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    }
    await query('DELETE FROM recovery_runs WHERE id = ANY($1::uuid[])', [recoveryRuns])
    await deleteTestOrganizations(lease.pool, organizations)
    organizations.length = 0
    recoveryRuns.length = 0
  })

  it('deletes the closed Organization work items only, journaled first, and replays after a restore', async () => {
    const closed = await seed()
    const other = await seed()
    holdRightsOrganization(closed)
    const before = await rows(closed)
    const eventsBefore = await events(closed)
    const otherBefore = await rows(other)
    const otherEventsBefore = await events(other)
    expect(eventsBefore).toHaveLength(1)
    const { store, entries } = recordingJournalStore()

    const result = await closure(closed, store)

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(entries().map(({ context, subjectClass }) => [context, subjectClass])).toEqual(
      [['platform', 'organization']],
    )
    expect(await rows(closed)).toEqual([])
    expect(await events(closed)).toEqual([])
    expect(await rows(other)).toEqual(otherBefore)
    expect(await events(other)).toEqual(otherEventsBefore)

    await query(
      `INSERT INTO work_items SELECT * FROM jsonb_populate_recordset(null::work_items, $1::jsonb)`,
      [JSON.stringify(before)],
    )
    await query(
      `INSERT INTO outbox_events SELECT * FROM jsonb_populate_recordset(null::outbox_events, $1::jsonb)`,
      [JSON.stringify(eventsBefore)],
    )
    const replayed = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries(),
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: [workItemsErasureReplayer],
      }),
    )

    expect(replayed.verified).toBe(true)
    expect(replayed.counts.ledgerRowsReErased).toBe(3)
    expect(await rows(closed)).toEqual([])
    expect(await events(closed)).toEqual([])
    expect(await rows(other)).toEqual(otherBefore)
    expect(await events(other)).toEqual(otherEventsBefore)
  })

  it('refuses an active Organization and changes nothing', async () => {
    const organizationId = await seed()
    const before = await rows(organizationId)
    const put = vi.fn(async () => {})

    const result = await closure(organizationId, { put, alert: () => {} })

    expect(result.code).toBe(1)
    expect(result.err.join('\n')).toMatch(/nothing was changed/)
    expect(put).not.toHaveBeenCalled()
    expect(await rows(organizationId)).toEqual(before)
  })

  it.each(['pending', 'quarantined'])(
    'refuses while a work item is %s and changes nothing',
    async (state) => {
      const organizationId = await seed()
      await seedWork(organizationId, state)
      holdRightsOrganization(organizationId)
      const before = await rows(organizationId)

      const result = await closure(organizationId)

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toContain('unfinished_work_items=1')
      expect(await rows(organizationId)).toEqual(before)
    },
  )

  it('refuses while an outbox event is unsettled, so delivery cannot admit it again', async () => {
    const organizationId = await seed()
    await query(
      `INSERT INTO outbox_events (event_type, payload, organization_id, source_context, source_aggregate_id)
       VALUES ('identity.member.role_changed', '{}'::jsonb, $1, 'identity', 'member-1')`,
      [organizationId],
    )
    holdRightsOrganization(organizationId)
    const before = await rows(organizationId)

    const result = await closure(organizationId)

    expect(result.code).toBe(1)
    expect(result.err.join('\n')).toContain('unsettled_outbox_events=1')
    expect(await rows(organizationId)).toEqual(before)
  })

  it('replays only settled work, leaving work a restore brought back unfinished', async () => {
    const organizationId = await seed()
    holdRightsOrganization(organizationId)
    const { store, entries } = recordingJournalStore()
    expect((await closure(organizationId, store)).code).toBe(0)
    await seedWork(organizationId, 'succeeded')
    await seedWork(organizationId, 'pending')

    const replayed = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries(),
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: [workItemsErasureReplayer],
      }),
    )

    expect(replayed.verified).toBe(true)
    expect(replayed.counts.ledgerRowsReErased).toBe(1)
    expect(
      ((await rows(organizationId)) as Array<{ state: string }>).map((row) => row.state),
    ).toEqual(['pending'])
  })

  it('deletes nothing and raises the alert when the journal write rejects', async () => {
    const organizationId = await seed()
    holdRightsOrganization(organizationId)
    const before = await rows(organizationId)
    const alert = vi.fn()

    const result = await closure(organizationId, {
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert,
    })

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'platform' }))
    expect(await rows(organizationId)).toEqual(before)
  })
})
