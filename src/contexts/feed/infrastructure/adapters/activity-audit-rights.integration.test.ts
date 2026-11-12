// Activity's rights executor and the audit records, against real PostgreSQL:
// Property A and B of one Organization beside a second Organization. The audit
// rows keep the event and lose the person, only in the erased scope, and a
// replay after a restore writes the same pseudonyms again. Audit log rows
// belong to a Property through the Property id in their details.

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
  type RightsSeeded,
} from '#/shared/db/testing/rights-isolation-fixture'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createActivityErasureReplayers,
  createActivityRightsExecutor,
} from './activity-rights.adapter'

const RESTORE_POINT = new Date('2026-07-01T00:00:00.000Z')
const IP = '203.0.113.9'
const SECRET = 'audit-pseudonym-test-secret'

let lease: TestLease
let db: Database
let query: RightsQuery
const organizations: string[] = []

const userOf = (organizationId: string) => `user-${organizationId.slice(-12)}`

async function seedAuditEvent(
  organizationId: string,
  propertyId: string | null,
  event: Readonly<{
    actorType: string
    actorId: string | null
    resourceType: string
    resourceId: string
  }>,
) {
  await query(
    `INSERT INTO audit_events (
       organization_id, property_id, actor_type, actor_id, action, outcome,
       resource_type, resource_id, source_kind, source_id, occurred_at)
     VALUES ($1, $2, $3, $4, 'member.role_changed', 'succeeded', $5, $6,
             'interactive_command', $7, $8)`,
    [
      organizationId,
      propertyId,
      event.actorType,
      event.actorId,
      event.resourceType,
      event.resourceId,
      `source-${randomUUID()}`,
      RIGHTS_FIXTURE_AT,
    ],
  )
}

async function seed(properties: number): Promise<RightsSeeded> {
  const seeded = await seedRightsOrganization(
    query,
    properties,
    async (org, property) => {
      const user = userOf(org)
      await seedAuditEvent(org, property, {
        actorType: 'user',
        actorId: user,
        resourceType: 'member',
        resourceId: user,
      })
      await seedAuditEvent(org, property, {
        actorType: 'operator',
        actorId: 'ops:auditor',
        resourceType: 'property',
        resourceId: property,
      })
    },
  )
  const user = userOf(seeded.organizationId)
  const [a, b] = seeded.propertyIds
  const logs: Array<[string, Record<string, unknown>, string | null]> = [
    [
      user,
      {
        propertyId: a,
        status: 'paused',
        reason: 'Dana Rivera asked to pause',
        contact: 'dana@example.test',
        summary: 'Call dana@example.test before Friday',
        actors: [user],
        votes: { [user]: 1 },
      },
      IP,
    ],
    ['system', { resultCount: 2 }, null],
    ['ops:auditor', { propertyId: a, status: 'active' }, null],
    ...(b === undefined
      ? []
      : [
          [user, { propertyId: b, reason: 'Sam asked' }, IP] as [
            string,
            Record<string, unknown>,
            string,
          ],
        ]),
  ]
  for (const [userId, details, ip] of logs) {
    await query(
      `INSERT INTO audit_logs
         (id, organization_id, user_id, action, resource_type, resource_id, details, ip_address)
       VALUES (gen_random_uuid()::text, $1, $2, 'goal.program.status_changed', 'goal_program',
               'program-1', $3::jsonb, $4)`,
      [seeded.organizationId, userId, JSON.stringify(details), ip],
    )
  }
  organizations.push(seeded.organizationId)
  return seeded
}

type AuditSnapshot = Readonly<{ events: unknown[]; logs: unknown[] }>

async function snapshot(
  organizationId: string,
  propertyId?: string,
): Promise<AuditSnapshot> {
  const events = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) AS rows
     FROM audit_events t WHERE organization_id = $1
     ${propertyId ? 'AND property_id = $2' : ''}`,
    propertyId ? [organizationId, propertyId] : [organizationId],
  )
  const logs = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) AS rows
     FROM audit_logs t WHERE organization_id = $1
     ${propertyId ? "AND details->>'propertyId' = $2" : ''}`,
    propertyId ? [organizationId, propertyId] : [organizationId],
  )
  return {
    events: events.rows[0]?.rows as unknown[],
    logs: logs.rows[0]?.rows as unknown[],
  }
}

async function putBack(
  organizationId: string,
  rows: AuditSnapshot,
  propertyId?: string,
): Promise<void> {
  await query(
    `DELETE FROM audit_events WHERE organization_id = $1
     ${propertyId ? 'AND property_id = $2' : ''}`,
    propertyId ? [organizationId, propertyId] : [organizationId],
  )
  await query(
    `INSERT INTO audit_events SELECT * FROM jsonb_populate_recordset(null::audit_events, $1::jsonb)`,
    [JSON.stringify(rows.events)],
  )
  await query(
    `DELETE FROM audit_logs WHERE organization_id = $1
     ${propertyId ? "AND details->>'propertyId' = $2" : ''}`,
    propertyId ? [organizationId, propertyId] : [organizationId],
  )
  await query(
    `INSERT INTO audit_logs SELECT * FROM jsonb_populate_recordset(null::audit_logs, $1::jsonb)`,
    [JSON.stringify(rows.logs)],
  )
}

const replay = (
  entries: Parameters<typeof applyRestoreResurrectionFence>[1]['entries'],
) =>
  db.transaction((tx) =>
    applyRestoreResurrectionFence(tx, {
      entries,
      restorePointAt: RESTORE_POINT,
      replayers: createActivityErasureReplayers(SECRET),
    }),
  )

type LogRow = Readonly<{ user_id: string; details: Record<string, unknown> }>

type EventRow = Readonly<{
  actor_type: string
  actor_id: string | null
  action: string
  occurred_at: string
  resource_id: string | null
}>

describe('activity rights executor and audit records', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
  })

  afterAll(async () => lease.release())

  afterEach(async () => {
    for (const organizationId of organizations) {
      await query('DELETE FROM audit_events WHERE organization_id = $1', [organizationId])
      await query('DELETE FROM audit_logs WHERE organization_id = $1', [organizationId])
      await query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    }
    await deleteTestOrganizations(lease.pool, organizations)
    organizations.length = 0
    vi.unstubAllEnvs()
  })

  it('pseudonymises Property A only, keeps each event, and replays the same pseudonyms', async () => {
    const first = await seed(2)
    const other = await seed(1)
    const [a, b] = first.propertyIds as [string, string]
    const user = userOf(first.organizationId)
    const aBefore = await snapshot(first.organizationId, a)
    const bBefore = await snapshot(first.organizationId, b)
    const systemLog = async () =>
      (
        await query(
          `SELECT to_jsonb(t) AS row FROM audit_logs t
           WHERE organization_id = $1 AND user_id = 'system'`,
          [first.organizationId],
        )
      ).rows[0]?.row
    const systemBefore = await systemLog()
    const otherBefore = await snapshot(other.organizationId)
    const { store, entries } = recordingJournalStore()

    const result = await runRightsExecutor(
      createActivityRightsExecutor(db, SECRET),
      rightsPlan('property', first.organizationId, { propertyId: a }),
      store,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(entries().map((entry) => entry.context)).toEqual(['activity'])
    const aAfter = await snapshot(first.organizationId, a)
    const [operator, person] = [...(aAfter.events as EventRow[])].sort((x, y) =>
      x.actor_type.localeCompare(y.actor_type),
    ) as [EventRow, EventRow]
    expect(operator.actor_type).toBe('operator')
    expect(operator.actor_id).toBe('ops:auditor')
    expect(operator.resource_id).toBe(a)
    expect(person.actor_id).toMatch(/^pseudonym:[0-9a-f]{32}$/)
    expect(person.resource_id).toBe(person.actor_id)
    expect(person.action).toBe('member.role_changed')
    expect(JSON.stringify(aAfter)).not.toContain(user)
    expect(aAfter.events).toHaveLength(aBefore.events.length)
    const aLogs = aAfter.logs as LogRow[]
    expect(aLogs).toHaveLength(2)
    expect(aLogs.find((log) => log.details.status === 'paused')!.user_id).toBe(
      person.actor_id,
    )
    expect(aLogs.find((log) => log.details.status === 'active')!.user_id).toBe(
      'ops:auditor',
    )
    expect(JSON.stringify(aAfter.logs)).not.toContain('Dana')
    expect(bBefore.logs).toHaveLength(1)
    expect(await snapshot(first.organizationId, b)).toEqual(bBefore)
    expect(await systemLog()).toEqual(systemBefore)
    expect(await snapshot(other.organizationId)).toEqual(otherBefore)

    await putBack(first.organizationId, aBefore, a)
    expect(await snapshot(first.organizationId, a)).toEqual(aBefore)
    const replayed = await replay(entries())

    expect(replayed.verified).toBe(true)
    expect(replayed.counts.ledgerRowsReErased).toBeGreaterThan(0)
    expect(await snapshot(first.organizationId, a)).toEqual(aAfter)
    expect(await snapshot(first.organizationId, b)).toEqual(bBefore)
    expect(await snapshot(other.organizationId)).toEqual(otherBefore)
  })

  it('writes different pseudonyms under a different server secret', async () => {
    const first = await seed(1)
    const [a] = first.propertyIds as [string]
    const before = await snapshot(first.organizationId, a)
    const personActor = async () =>
      ((await snapshot(first.organizationId, a)).events as EventRow[]).find(
        (event) => event.actor_type === 'user',
      )?.actor_id

    const pseudonyms: Array<string | null | undefined> = []
    for (const secret of [SECRET, 'another-audit-pseudonym-secret']) {
      await putBack(first.organizationId, before, a)
      const { store } = recordingJournalStore()
      const result = await runRightsExecutor(
        createActivityRightsExecutor(db, secret),
        rightsPlan('property', first.organizationId, { propertyId: a }),
        store,
      )
      expect(result.code).toBe(0)
      pseudonyms.push(await personActor())
    }

    expect(pseudonyms[0]).toMatch(/^pseudonym:/)
    expect(pseudonyms[1]).toMatch(/^pseudonym:/)
    expect(pseudonyms[0]).not.toBe(pseudonyms[1])
  })

  it('pseudonymises the closed Organization audit log and events, and replays them after a restore', async () => {
    const first = await seed(2)
    const other = await seed(1)
    holdRightsOrganization(first.organizationId)
    const user = userOf(first.organizationId)
    const before = await snapshot(first.organizationId)
    const otherBefore = await snapshot(other.organizationId)
    const { store, entries } = recordingJournalStore()

    const result = await runRightsExecutor(
      createActivityRightsExecutor(db, SECRET),
      rightsPlan('organization', first.organizationId),
      store,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    const after = await snapshot(first.organizationId)
    const text = JSON.stringify(after)
    for (const personal of [user, 'Dana Rivera', 'dana@example.test', IP]) {
      expect(text).not.toContain(personal)
    }
    expect(after.events).toHaveLength(before.events.length)
    expect(after.logs).toHaveLength(4)
    const logs = after.logs as LogRow[]
    const personLog = logs.find((log) => log.details.status === 'paused')!
    expect(personLog.user_id).toMatch(/^pseudonym:/)
    expect(personLog.details).toMatchObject({
      propertyId: first.propertyIds[0],
      status: 'paused',
      actors: [personLog.user_id],
      votes: { [personLog.user_id]: 1 },
    })
    expect(personLog.details.summary).toMatch(
      /^Call pseudonym:[0-9a-f]{32} before Friday$/,
    )
    expect(logs.find((log) => log.user_id === 'system')!.details).toEqual({
      resultCount: 2,
    })
    expect(logs.find((log) => log.details.status === 'active')!.user_id).toBe(
      'ops:auditor',
    )
    expect(await snapshot(other.organizationId)).toEqual(otherBefore)

    await putBack(first.organizationId, before)
    const replayed = await replay(entries())

    expect(replayed.verified).toBe(true)
    expect(await snapshot(first.organizationId)).toEqual(after)
    expect(await snapshot(other.organizationId)).toEqual(otherBefore)
  })

  it('changes no audit row and raises the alert when the journal write rejects', async () => {
    const first = await seed(2)
    const a = first.propertyIds[0]!
    const before = await snapshot(first.organizationId)
    const alert = vi.fn()

    const result = await runRightsExecutor(
      createActivityRightsExecutor(db, SECRET),
      rightsPlan('property', first.organizationId, { propertyId: a }),
      {
        put: async () => {
          throw new Error('bucket unavailable')
        },
        alert,
      },
    )

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ context: 'activity' }))
    expect(await snapshot(first.organizationId)).toEqual(before)
  })
})
