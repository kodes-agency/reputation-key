// Identity's Organization closure and the last-owner guard, against real
// PostgreSQL: every live Organization has an owner, and a trigger refuses to
// delete an Organization's last one. The closure deletes it all the same, with
// the guard off only inside its own transaction, and a replay after a restore
// does it again. Outside that transaction the guard still holds, for the
// closed Organization's neighbour above all.

import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv, resetEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
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
  createIdentityRightsExecutor,
  identityOrganizationErasureReplayer,
} from './identity-rights.adapter'

let lease: TestLease
let db: Database
let query: RightsQuery
const organizations: string[] = []
const users: string[] = []

/** An Organization whose only member is its owner, as every live one has. */
async function seedOwnedOrganization(): Promise<string> {
  const { organizationId } = await seedRightsOrganization(query, 0, async () => {})
  organizations.push(organizationId)
  const userId = `owner-${randomUUID()}`
  users.push(userId)
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Dana Rivera', $2, true, $3, $3)`,
    [userId, `${userId}@example.test`, RIGHTS_FIXTURE_AT],
  )
  await query(
    `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [randomUUID(), userId, organizationId, RIGHTS_FIXTURE_AT],
  )
  return organizationId
}

async function members(organizationId: string): Promise<unknown[]> {
  const result = await query(
    `SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) AS rows
     FROM member m WHERE "organizationId" = $1`,
    [organizationId],
  )
  return result.rows[0]?.rows as unknown[]
}

async function organizationRow(organizationId: string): Promise<unknown> {
  const result = await query(
    `SELECT to_jsonb(o) AS row FROM organization o WHERE id = $1`,
    [organizationId],
  )
  return result.rows[0]?.row
}

/** Gives an Organization personal fields, as a live one has; `name` may be any text. */
async function fillOrganization(organizationId: string, name: string): Promise<void> {
  await query(
    `UPDATE organization
     SET name = $2, slug = $3, "contactEmail" = 'owner@example.test',
         logo = 'https://example.test/logo.png', metadata = '{"note":"Dana"}'
     WHERE id = $1`,
    [organizationId, name, `live-${organizationId}`],
  )
}

async function restoreOrganizationRow(row: unknown): Promise<void> {
  await query(
    `UPDATE organization o SET name = r.name, slug = r.slug, "contactEmail" = r."contactEmail",
       logo = r.logo, metadata = r.metadata
     FROM jsonb_populate_record(null::organization, $1::jsonb) r WHERE o.id = r.id`,
    [JSON.stringify(row)],
  )
}

/** Polls until a backend whose statement matches the pattern waits on a lock. */
async function waitForLockWait(statementPattern: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await query(
      `SELECT 1 FROM pg_stat_activity
       WHERE wait_event_type = 'Lock' AND query ~ $1 AND pid <> pg_backend_pid()`,
      [statementPattern],
    )
    if (result.rows.length > 0) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no backend waiting on a lock in: ${statementPattern}`)
}

async function guardEnabled(): Promise<boolean> {
  const result = await query(
    `SELECT tgenabled FROM pg_trigger
     WHERE tgrelid = 'public.member'::regclass AND tgname = 'member_last_owner_del'`,
  )
  return result.rows[0]?.tgenabled === 'O'
}

describe('Identity closure of an Organization with an owner', () => {
  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 4)
    db = drizzle(lease.pool) as Database
    query = (text, params) => lease.pool.query(text, params)
  })

  afterAll(async () => lease.release())

  afterEach(async () => {
    vi.unstubAllEnvs()
    resetEnv()
    await withLastOwnerGuardDisabled(lease.pool, (client) =>
      client.query('DELETE FROM member WHERE "organizationId" = ANY($1::text[])', [
        organizations,
      ]),
    )
    await deleteTestOrganizations(lease.pool, organizations)
    await query('DELETE FROM "user" WHERE id = ANY($1::text[])', [users])
    organizations.length = 0
    users.length = 0
  })

  it('deletes the last owner, keeps the guard for everyone else, and replays after a restore', async () => {
    const closed = await seedOwnedOrganization()
    const neighbour = await seedOwnedOrganization()
    holdRightsOrganization(closed)
    const before = await members(closed)
    const neighbourBefore = await members(neighbour)
    const neighbourRow = await organizationRow(neighbour)
    await fillOrganization(closed, 'Seaside Hotels')
    const closedBefore = await organizationRow(closed)
    expect(before).toHaveLength(1)
    const { store, entries } = recordingJournalStore()

    const result = await runRightsExecutor(
      createIdentityRightsExecutor(db, () => new Date()),
      rightsPlan('organization', closed),
      store,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    expect(await members(closed)).toEqual([])
    expect(await members(neighbour)).toEqual(neighbourBefore)
    expect(await organizationRow(neighbour)).toEqual(neighbourRow)
    const applied = await organizationRow(closed)
    expect(applied).toMatchObject({
      id: closed,
      name: 'closed-organization',
      slug: `closed_${closed}`,
      contactEmail: null,
      logo: null,
      metadata: JSON.stringify({
        closedAt: RIGHTS_FIXTURE_AT.toISOString(),
        reason: 'closed on request',
      }),
    })
    expect(await guardEnabled()).toBe(true)
    await expect(
      query('DELETE FROM member WHERE "organizationId" = $1', [neighbour]),
    ).rejects.toThrow('cannot_remove_last_owner')

    await query(
      `INSERT INTO member SELECT * FROM jsonb_populate_recordset(null::member, $1::jsonb)`,
      [JSON.stringify(before)],
    )
    await restoreOrganizationRow(closedBefore)
    expect(await organizationRow(closed)).toEqual(closedBefore)
    const replayed = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries(),
        restorePointAt: new Date(RIGHTS_FIXTURE_AT.getTime() - 86_400_000),
        replayers: [identityOrganizationErasureReplayer],
      }),
    )

    expect(replayed.verified).toBe(true)
    expect(await members(closed)).toEqual([])
    expect(await organizationRow(closed)).toEqual(applied)
    expect(await members(neighbour)).toEqual(neighbourBefore)
    expect(await organizationRow(neighbour)).toEqual(neighbourRow)
    expect(await guardEnabled()).toBe(true)
  })

  it('tombstones an Organization a user named closed-organization, and again on replay', async () => {
    const closed = await seedOwnedOrganization()
    const neighbour = await seedOwnedOrganization()
    holdRightsOrganization(closed)
    await fillOrganization(closed, 'closed-organization')
    const before = await members(closed)
    const closedBefore = await organizationRow(closed)
    const neighbourRow = await organizationRow(neighbour)
    const { store, entries } = recordingJournalStore()

    const result = await runRightsExecutor(
      createIdentityRightsExecutor(db, () => new Date()),
      rightsPlan('organization', closed),
      store,
    )

    expect(result.err).toEqual([])
    expect(result.code).toBe(0)
    const applied = await organizationRow(closed)
    expect(applied).toMatchObject({
      slug: `closed_${closed}`,
      contactEmail: null,
      logo: null,
      metadata: JSON.stringify({
        closedAt: RIGHTS_FIXTURE_AT.toISOString(),
        reason: 'closed on request',
      }),
    })

    await query(
      `INSERT INTO member SELECT * FROM jsonb_populate_recordset(null::member, $1::jsonb)`,
      [JSON.stringify(before)],
    )
    await restoreOrganizationRow(closedBefore)
    const replayed = await db.transaction((tx) =>
      applyRestoreResurrectionFence(tx, {
        entries: entries(),
        restorePointAt: new Date(RIGHTS_FIXTURE_AT.getTime() - 86_400_000),
        replayers: [identityOrganizationErasureReplayer],
      }),
    )

    expect(replayed.verified).toBe(true)
    expect(await organizationRow(closed)).toEqual(applied)
    expect(await members(closed)).toEqual([])
    expect(await organizationRow(neighbour)).toEqual(neighbourRow)
  })

  it('keeps the membership table writable for others until the closure reaches the member delete', async () => {
    const closed = await seedOwnedOrganization()
    const neighbour = await seedOwnedOrganization()
    holdRightsOrganization(closed)
    const inviter = users[users.length - 2]
    await query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId")
       VALUES ($1, $2, 'guest@example.test', 'member', 'pending', $3, $4)`,
      [randomUUID(), closed, new Date(RIGHTS_FIXTURE_AT.getTime() + 86_400_000), inviter],
    )
    // The closure waits on the invitation row, before its member delete.
    const blocker = await lease.pool.connect()
    let closing: ReturnType<typeof runRightsExecutor> | undefined
    try {
      await blocker.query('BEGIN')
      await blocker.query(
        'SELECT 1 FROM invitation WHERE "organizationId" = $1 FOR UPDATE',
        [closed],
      )
      closing = runRightsExecutor(
        createIdentityRightsExecutor(db, () => new Date()),
        rightsPlan('organization', closed),
        recordingJournalStore().store,
      )
      await waitForLockWait('DELETE FROM "?invitation"?')

      const writer = await lease.pool.connect()
      try {
        await writer.query('BEGIN')
        await writer.query(`SET LOCAL lock_timeout = '1s'`)
        await writer.query(
          `UPDATE member SET "createdAt" = "createdAt" WHERE "organizationId" = $1`,
          [neighbour],
        )
        await writer.query('COMMIT')
      } catch (error) {
        await writer.query('ROLLBACK')
        throw error
      } finally {
        writer.release()
      }
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
    const result = await closing
    expect(result?.err).toEqual([])
    expect(result?.code).toBe(0)
    expect(await members(closed)).toEqual([])
    expect(await members(neighbour)).toHaveLength(1)
  })

  it('rolls the guard and the deletes back when the closure stops with the guard off', async () => {
    const closed = await seedOwnedOrganization()
    holdRightsOrganization(closed)
    const before = await members(closed)
    // A lock on the owner's row stops the closure at its member delete, after
    // the guard went off, once the five-second lock timeout runs out.
    const blocker = await lease.pool.connect()
    try {
      await blocker.query('BEGIN')
      await blocker.query('SELECT 1 FROM member WHERE "organizationId" = $1 FOR UPDATE', [
        closed,
      ])

      const result = await runRightsExecutor(
        createIdentityRightsExecutor(db, () => new Date()),
        rightsPlan('organization', closed),
        recordingJournalStore().store,
      )

      expect(result.code).toBe(1)
      expect(result.err.join('\n')).toContain('identity')
    } finally {
      await blocker.query('ROLLBACK')
      blocker.release()
    }
    expect(await members(closed)).toEqual(before)
    expect(await guardEnabled()).toBe(true)
  })
})
