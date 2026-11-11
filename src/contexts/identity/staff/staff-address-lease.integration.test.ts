import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db/index'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  seedStaffAccountFixture,
  seedStaffAccountUser,
  cleanStaffAccountFixture,
  STAFF_FIXTURE_NOW as NOW,
  type StaffAccountFixture,
} from '#/shared/testing/staff-account-fixture'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { organizationId, userId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createAtomicIdentityCommandStore } from '../infrastructure/identity-command-store'
import { createInvitationReadModel } from '../members/invitation-read-model.server'
import { acceptInvitation } from '../members/accept-invitation.server'
import { addStaffMember, type StaffAccountDeps } from './add-staff-member.server'
import { removeStaffMember, type ManageStaffDeps } from './manage-staff-accounts.server'
import { createStaffAccountStore } from './staff-account-store.server'
import { createStaffManagementStore } from './staff-management.store.server'
import { assertStaffAddressLease, holdStaffAddresses } from './staff-address-lease.server'

let lease: TestLease
let db: Database
let fixtures: StaffAccountFixture[] = []
beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  clearEventSchemas()
  registerAllEventSchemas()
})
afterEach(async () => {
  for (const row of fixtures) await cleanStaffAccountFixture(lease.pool, row)
  fixtures = []
})
afterAll(async () => {
  clearEventSchemas()
  await lease.release()
})

const settledWithin = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])

function gate() {
  let open = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, opened }
}

async function organization(pool: Pool) {
  const row = await seedStaffAccountFixture(lease.pool)
  fixtures = [...fixtures, row]
  await lease.pool.query(
    'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, $5)',
    [randomUUID(), row.organizationId, row.inviterId, 'owner', NOW],
  )
  const ctx = buildTestAuthContext({
    role: 'AccountAdmin',
    organizationId: organizationId(row.organizationId),
    userId: userId(row.inviterId),
  })
  const database = drizzle(pool) as Database
  return { row, ctx, database }
}

function staffDeps(
  database: Database,
  row: StaffAccountFixture,
  portalStep: () => Promise<void> = async () => undefined,
): ManageStaffDeps {
  const deps: StaffAccountDeps = {
    store: createStaffAccountStore(database, () => NOW, randomUUID),
    spendAddressCheckBudget: async () => undefined,
    reportDeliveryFailure: () => undefined,
    idGen: randomUUID,
    authorizeProperty: async () => undefined,
    invitationBudget: async () => 20,
    spendInvitationBudget: async () => undefined,
    deliverAccess: async () => undefined,
    portals: {
      archiveForMemberDeparture: async () => undefined,
      check: async () => ({ omittedLinks: [] }),
      rename: async (input, _ctx, transaction) => {
        await (transaction as Tx).execute(
          sql`UPDATE portals SET name = ${input.displayName} WHERE organization_id = ${row.organizationId} AND id = ANY(${`{${input.portalIds.join(',')}}`}::uuid[])`,
        )
      },
      create: async (input) => {
        await portalStep()
        await database.execute(
          sql`INSERT INTO portals (id, organization_id, property_id, entity_id, name, public_name, slug, kind) VALUES (${input.portalId}::uuid, ${row.organizationId}, ${row.propertyId}::uuid, ${row.propertyId}, ${input.displayName}, 'Harbor', ${`portal-${input.portalId.slice(0, 8)}`}, 'personal') ON CONFLICT (id) DO NOTHING`,
        )
      },
      issueCode: async () => undefined,
      publish: async () => undefined,
      archive: async () => undefined,
    },
  }
  return {
    ...deps,
    management: createStaffManagementStore(database, () => NOW),
    removeLogin: async () => undefined,
  }
}

const addInput = (
  row: StaffAccountFixture,
  email = `new-${randomUUID()}@example.com`,
) => ({
  operationId: randomUUID(),
  propertyId: row.propertyId,
  email,
  displayName: 'New colleague',
})

describe.sequential('staff address leases (PostgreSQL)', () => {
  it('keeps sign-in responsive while Adds in several Organizations wait on a slow step', async () => {
    const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
    try {
      const slow = gate()
      let waiting = 0
      const step = async () => {
        waiting += 1
        await slow.opened
      }
      const orgs = await Promise.all([1, 2, 3].map(() => organization(pool)))
      const adds = orgs.flatMap(({ row, ctx, database }) =>
        [1, 2].map(() =>
          addStaffMember(staffDeps(database, row, step))(addInput(row), ctx),
        ),
      )
      await vi.waitFor(() => expect(waiting).toBe(4), { timeout: 10_000 })
      const signIn = pool.query('SELECT id FROM session WHERE token = $1', [randomUUID()])
      expect(await settledWithin(signIn, 2_000)).toBe(true)
      slow.open()
      const results = await Promise.all(adds)
      expect(results.map((result) => result.status)).toEqual(Array(6).fill('done'))
      expect(
        (await lease.pool.query('SELECT count(*)::int AS n FROM staff_address_leases'))
          .rows[0].n,
      ).toBe(0)
    } finally {
      await pool.end()
    }
  })

  it('allows one holder per address key and serializes holders across Organizations', async () => {
    const key = `beta-invitation-email:unique-${randomUUID()}@example.com`
    await lease.pool.query(
      'INSERT INTO staff_address_leases VALUES (hashtextextended($1, 0), $2, $3)',
      [key, randomUUID(), NOW],
    )
    await expect(
      lease.pool.query(
        'INSERT INTO staff_address_leases VALUES (hashtextextended($1, 0), $2, $3)',
        [key, randomUUID(), NOW],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await lease.pool.query(
      'DELETE FROM staff_address_leases WHERE address_key = hashtextextended($1, 0)',
      [key],
    )

    const email = `shared-${randomUUID()}@example.com`
    const order: string[] = []
    const first = gate()
    const one = holdStaffAddresses(
      db,
      () => NOW,
      randomUUID,
      [email],
      async () => {
        order.push('one:start')
        await first.opened
        order.push('one:end')
      },
    )
    await vi.waitFor(() => expect(order).toEqual(['one:start']))
    const two = holdStaffAddresses(
      db,
      () => NOW,
      randomUUID,
      [email],
      async () => {
        order.push('two')
      },
    )
    expect(await settledWithin(two, 300)).toBe(false)
    first.open()
    await Promise.all([one, two])
    expect(order).toEqual(['one:start', 'one:end', 'two'])
  })

  it('takes over a lease whose holder stopped, and fences the stopped holder out', async () => {
    const { row, ctx } = await organization(lease.pool)
    const email = `orphan-${randomUUID()}@example.com`
    const orphan = randomUUID()
    await lease.pool.query(
      'INSERT INTO staff_address_leases VALUES (hashtextextended($1, 0), $2, $3)',
      [`beta-invitation-email:${email}`, orphan, new Date(NOW.getTime() - 1)],
    )
    const added = await addStaffMember(staffDeps(db, row))(addInput(row, email), ctx)
    expect(added.status).toBe('done')
    await expect(
      db.transaction((tx) =>
        assertStaffAddressLease(tx, { holder: orphan, size: 1 }, NOW),
      ),
    ).rejects.toMatchObject({ code: 'operation_conflict' })
  })

  it('makes Remove wait for a running Add of the same address, then finish it', async () => {
    const { row, ctx } = await organization(lease.pool)
    const slow = gate()
    let reached = false
    const deps = staffDeps(db, row, async () => {
      reached = true
      await slow.opened
    })
    const input = addInput(row)
    const adding = addStaffMember(deps)(input, ctx)
    await vi.waitFor(() => expect(reached).toBe(true))
    const participation = (
      await lease.pool.query(
        'SELECT staff_participation_id AS id FROM staff_onboardings WHERE id = $1',
        [input.operationId],
      )
    ).rows[0].id as string
    const removing = removeStaffMember(deps)({ participationId: participation }, ctx)
    expect(await settledWithin(removing, 300)).toBe(false)
    slow.open()
    expect((await adding).status).toBe('done')
    expect(await removing).toEqual({ removed: true })
    const state = await lease.pool.query(
      `SELECT p.archive_reason, (SELECT count(*)::int FROM invitation i WHERE i."staffParticipationId" = p.id::text AND i.status = 'pending') AS pending
       FROM staff_participations p WHERE p.id = $1`,
      [participation],
    )
    expect(state.rows).toEqual([{ archive_reason: 'staff_removed_complete', pending: 0 }])
  })

  it('commits one valid outcome when acceptance races removal', async () => {
    for (let round = 0; round < 8; round += 1) {
      const { row, ctx } = await organization(lease.pool)
      await seedStaffAccountUser(lease.pool, row)
      const identity = createInMemoryIdentityPort()
      identity.setSessionUser({ id: row.userId, email: row.email })
      const accepting = acceptInvitation({
        invitations: createInvitationReadModel(db),
        authorizeOrganization: async () => true,
        identity,
        commandStore: createAtomicIdentityCommandStore(db, randomUUID, async () => true),
        clock: () => NOW,
        logger: { error: vi.fn() },
      })({
        invitationId: row.invitationId,
        userId: userId(row.userId),
        headers: new Headers(),
      })
      const removing = removeStaffMember(staffDeps(db, row))(
        { participationId: row.participationId },
        ctx,
      )
      const [accepted, removed] = await Promise.allSettled([accepting, removing])
      expect(removed).toEqual({ status: 'fulfilled', value: { removed: true } })
      if (accepted.status === 'rejected')
        expect(accepted.reason).toMatchObject({ code: expect.any(String) })
      const links = await lease.pool.query(
        'SELECT id FROM staff_user_links WHERE organization_id = $1 AND effective_to IS NULL',
        [row.organizationId],
      )
      expect(links.rows).toEqual([])
      const open = await lease.pool.query(
        `SELECT id FROM invitation WHERE "organizationId" = $1 AND status = 'pending'`,
        [row.organizationId],
      )
      expect(open.rows).toEqual([])
    }
  })
})
