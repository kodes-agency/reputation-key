// Google's Property erasure and its execution permits, against real
// PostgreSQL: Property A and B of one Organization beside a second
// Organization. Erasing A deletes A's finished permits only, journaled first,
// refuses while a Google call for A is admitted or started before its
// deadline, and a replay deletes them again. A permit left admitted or started
// past its deadline is dead and goes with the Property; the deadline is read
// against the executor's clock, and one equal to it has passed.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { applyRestoreResurrectionFence } from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
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
  createGoogleRightsExecutor,
  createGoogleRightsReplayers,
} from './google-rights-executor'

const LATER = new Date(RIGHTS_FIXTURE_AT.getTime() + 60_000)
const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000)

let lease: TestLease
let db: Database
let query: RightsQuery
const organizations: string[] = []

async function seedPermit(
  organizationId: string,
  propertyId: string,
  state: 'admitted' | 'started' | 'completed',
  deadline: Date = LATER,
): Promise<void> {
  const started = state !== 'admitted'
  await query(
    `INSERT INTO authorization_execution_permits (
       capability, organization_id, property_id, initiator_user_id, operation_key,
       route_key, route_catalog_version, quota_policy_id, authorization_vector, state,
       admitted_at, start_deadline_at, started_at, operation_deadline_at, completed_at)
     VALUES ('property.publish_reply', $1, $2, 'user-dana', $3, 'route', 'v1', 'quota',
             '{}'::jsonb, $4, $5, $6, $7, $8, $9)`,
    [
      organizationId,
      propertyId,
      `operation-${randomUUID()}`,
      state,
      RIGHTS_FIXTURE_AT,
      state === 'admitted' ? deadline : LATER,
      started ? RIGHTS_FIXTURE_AT : null,
      started ? deadline : null,
      state === 'completed' ? deadline : null,
    ],
  )
}

async function seed(properties: number): Promise<RightsSeeded> {
  const seeded = await seedRightsOrganization(query, properties, (org, property) =>
    seedPermit(org, property, 'completed'),
  )
  organizations.push(seeded.organizationId)
  return seeded
}

async function permits(organizationId: string, propertyId?: string): Promise<unknown[]> {
  const result = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) AS rows
     FROM authorization_execution_permits t WHERE organization_id = $1
     ${propertyId ? 'AND property_id = $2::uuid' : ''}`,
    propertyId ? [organizationId, propertyId] : [organizationId],
  )
  return result.rows[0]?.rows as unknown[]
}

const erase = (
  seeded: RightsSeeded,
  store = recordingJournalStore().store,
  now?: () => Date,
) =>
  runRightsExecutor(
    createGoogleRightsExecutor({ db, ...(now ? { now } : {}) }),
    rightsPlan('property', seeded.organizationId, { propertyId: seeded.propertyIds[0] }),
    store,
  )

describe('Google Property erasure and execution permits', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
  })

  afterAll(async () => lease.release())

  afterEach(async () => {
    for (const organizationId of organizations) {
      await query(
        'DELETE FROM authorization_execution_permits WHERE organization_id = $1',
        [organizationId],
      )
      await query('DELETE FROM properties WHERE organization_id = $1', [organizationId])
    }
    await deleteTestOrganizations(lease.pool, organizations)
    organizations.length = 0
  })

  it('deletes Property A permits only, journaled first, and replays after a restore', async () => {
    const first = await seed(2)
    const other = await seed(1)
    const [a, b] = first.propertyIds as [string, string]
    const aBefore = await permits(first.organizationId, a)
    const bBefore = await permits(first.organizationId, b)
    const otherBefore = await permits(other.organizationId)
    expect(aBefore).toHaveLength(1)
    const { store, entries } = recordingJournalStore()

    const result = await erase(first, store)

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(entries().map((entry) => entry.context)).toEqual(['integration'])
    expect(await permits(first.organizationId, a)).toEqual([])
    expect(await permits(first.organizationId, b)).toEqual(bBefore)
    expect(await permits(other.organizationId)).toEqual(otherBefore)

    await query(
      `INSERT INTO authorization_execution_permits
       SELECT * FROM jsonb_populate_recordset(null::authorization_execution_permits, $1::jsonb)`,
      [JSON.stringify(aBefore)],
    )
    const replayed = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries(),
        restorePointAt: new Date('2026-07-01T00:00:00.000Z'),
        replayers: createGoogleRightsReplayers(),
      }),
    )

    expect(replayed.verified).toBe(true)
    expect(await permits(first.organizationId, a)).toEqual([])
    expect(await permits(first.organizationId, b)).toEqual(bBefore)
    expect(await permits(other.organizationId)).toEqual(otherBefore)
  })

  it.each(['admitted', 'started'] as const)(
    'refuses while a Google call is %s for the Property before its deadline and changes nothing',
    async (state) => {
      const first = await seed(2)
      await seedPermit(first.organizationId, first.propertyIds[0]!, state, IN_AN_HOUR())
      const before = await permits(first.organizationId)
      const put = vi.fn(async () => {})

      const result = await erase(first, { put, alert: () => {} })

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toContain('live_execution_permits=1')
      expect(put).not.toHaveBeenCalled()
      expect(await permits(first.organizationId)).toEqual(before)
    },
  )

  it.each(['admitted', 'started'] as const)(
    'deletes a permit left %s past its deadline with the Property',
    async (state) => {
      const first = await seed(2)
      const [a, b] = first.propertyIds as [string, string]
      await seedPermit(first.organizationId, a, state)
      const bBefore = await permits(first.organizationId, b)

      const result = await erase(first)

      expect(result.err).toEqual([])
      expect(result.code).toBe(0)
      expect(await permits(first.organizationId, a)).toEqual([])
      expect(await permits(first.organizationId, b)).toEqual(bBefore)
    },
  )

  it.each(['admitted', 'started'] as const)(
    'reads a %s permit deadline against the executor clock, where a deadline equal to now has elapsed',
    async (state) => {
      const first = await seed(2)
      const [a, b] = first.propertyIds as [string, string]
      const deadline = IN_AN_HOUR()
      await seedPermit(first.organizationId, a, state, deadline)
      const bBefore = await permits(first.organizationId, b)

      const early = await erase(first, undefined, () => new Date(deadline.getTime() - 1))

      expect(early.code).toBe(1)
      expect(early.err.join('\n')).toContain('live_execution_permits=1')

      const result = await erase(first, undefined, () => deadline)

      expect(result.err).toEqual([])
      expect(result.code).toBe(0)
      expect(await permits(first.organizationId, a)).toEqual([])
      expect(await permits(first.organizationId, b)).toEqual(bBefore)
    },
  )

  it('deletes nothing and raises the alert when the journal write rejects', async () => {
    const first = await seed(2)
    const before = await permits(first.organizationId)
    const alert = vi.fn()

    const result = await erase(first, {
      put: async () => {
        throw new Error('bucket unavailable')
      },
      alert,
    })

    expect(result.code).not.toBe(0)
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'integration' }),
    )
    expect(await permits(first.organizationId)).toEqual(before)
  })
})
