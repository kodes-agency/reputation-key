import { changeStaffInvitationEmail } from '../application/use-cases/change-staff-email'
import { replaceStaffInvitation } from './staff-invitation-correction'
import {
  removeStaffMember,
  removeStaffForMemberDeparture,
  renameStaffMember,
  resendStaffInvitation,
} from '../application/use-cases/manage-staff-accounts'
import { linkStaffInvitation } from './staff-invitation-link'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { identityMemberRemoved } from '../domain/events'
import { sql } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import { createStaffParticipationRepository } from './repositories/staff-participation.repository'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
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
import { organizationId, userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  addStaffMember,
  type StaffAccountDeps,
} from '../application/use-cases/add-staff-member'
import { STAFF_ONBOARDING_STEPS, type StaffOnboardingStep } from '../domain/staff-account'
import { createStaffAccountStore } from './staff-account-store'
import { createStaffManagementStore } from './adapters/staff-management.store'

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
async function setup(fault?: StaffOnboardingStep) {
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
  let pending = !!fault
  const fail = (step: StaffOnboardingStep) => {
    if (pending && step === fault) {
      pending = false
      throw Object.assign(new Error('Injected checkpoint failure'), {
        code: 'injected_failure',
      })
    }
  }
  const base = createStaffAccountStore(db, () => NOW, lease.pool)
  const decorate = (store: typeof base): typeof base => ({
    ...store,
    withAddressLock: (org, email, run) =>
      store.withAddressLock(org, email, (locked) => run(decorate(locked))),
    createPerson: async (operation) => {
      await store.createPerson(operation)
      fail('person')
    },
    assignPortal: async (operation, writePortalName) => {
      await store.assignPortal(operation, writePortalName)
      fail('responsibility')
    },
    grantAccess: async (operation, spend) => {
      const result = await store.grantAccess(operation, spend)
      fail('access')
      return result
    },
  })
  const deps: StaffAccountDeps = {
    store: decorate(base),
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
          sql`UPDATE portals SET name = ${input.displayName} WHERE organization_id = ${row.organizationId} AND id IN (${
            input.portalIds.length
              ? sql.join(
                  input.portalIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )
              : sql`NULL::uuid`
          })`,
        )
      },
      create: async (input) => {
        await lease.pool.query(
          "INSERT INTO portals (id, organization_id, property_id, entity_id, name, public_name, slug, kind) VALUES ($1::uuid, $2, $3::uuid, $3::text, $4, 'Harbor', $5, 'personal') ON CONFLICT (id) DO NOTHING",
          [
            input.portalId,
            row.organizationId,
            row.propertyId,
            input.displayName,
            `portal-${input.portalId.slice(0, 8)}`,
          ],
        )
        fail('portal')
      },
      issueCode: async () => {
        fail('code')
      },
      publish: async () => {
        fail('publication')
      },
      archive: async () => undefined,
    },
  }
  const input = {
    operationId: randomUUID(),
    propertyId: row.propertyId,
    email: `new-${randomUUID()}@example.com`,
    displayName: 'New colleague',
  }
  return { row, ctx, base, deps, input }
}

describe.sequential('staff onboarding checkpoints and constraints (PostgreSQL)', () => {
  it('cannot create a staff link across a concurrent membership deletion', async () => {
    const h = await setup()
    await seedStaffAccountUser(lease.pool, h.row)
    const memberId = randomUUID()
    await lease.pool.query(
      'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,\'admin\',$4)',
      [memberId, h.row.organizationId, h.row.userId, NOW],
    )
    const client = await lease.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM member WHERE id = $1', [memberId])
      const result = db
        .transaction((tx) =>
          linkStaffInvitation(tx, {
            organizationId: h.row.organizationId,
            participationId: h.row.participationId,
            userId: h.row.userId,
            actorId: h.row.inviterId,
            at: NOW,
          }),
        )
        .then(
          () => ({ linked: true, error: null }),
          (error: unknown) => ({ linked: false, error }),
        )
      await client.query('COMMIT')
      expect(await result).toMatchObject({
        linked: false,
        error: {
          message: 'This staff invitation has ended. Ask your manager to add you again',
        },
      })
      expect(
        (
          await lease.pool.query(
            'SELECT id FROM staff_user_links WHERE organization_id = $1',
            [h.row.organizationId],
          )
        ).rows,
      ).toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
  it('keeps a manager login until a failed staff departure is retried and its Portal archived', async () => {
    const h = await setup()
    await seedStaffAccountUser(lease.pool, h.row)
    await lease.pool.query('DELETE FROM invitation WHERE id = $1', [h.row.invitationId])
    const memberId = randomUUID()
    await lease.pool.query(
      'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,\'admin\',$4)',
      [memberId, h.row.organizationId, h.row.userId, NOW],
    )
    const added = await addStaffMember(h.deps)({ ...h.input, email: h.row.email }, h.ctx)
    expect(added.status).toBe('done')
    await lease.pool.query(
      'INSERT INTO session (id, "userId", token, "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
      [randomUUID(), h.row.userId, randomUUID(), new Date(NOW.getTime() + 86400000), NOW],
    )
    const commands = createAtomicIdentityCommandStore(db, randomUUID)
    const command = {
      organizationId: h.ctx.organizationId,
      memberId,
      event: identityMemberRemoved({
        organizationId: h.ctx.organizationId,
        userId: userId(h.row.userId),
        removedBy: h.ctx.userId,
        occurredAt: NOW,
      }),
    }
    await expect(commands.removeMember(command)).rejects.toThrow(
      'Staff removal is unfinished',
    )
    let fail = true
    const depart = removeStaffForMemberDeparture({
      ...h.deps,
      management: createStaffManagementStore(db, () => NOW),
      removeLogin: async () => {
        throw new Error('Manager cleanup must not remove the login itself')
      },
      portals: {
        ...h.deps.portals,
        archiveForMemberDeparture: async (id) => {
          if (fail) {
            fail = false
            throw new Error('Portal unavailable')
          }
          await lease.pool.query(
            "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
            [id],
          )
        },
      },
    })
    await expect(depart(h.row.userId, h.ctx)).rejects.toThrow(
      'Staff removal is unfinished',
    )
    expect(
      (await lease.pool.query('SELECT id FROM member WHERE id = $1', [memberId])).rows,
    ).toHaveLength(1)
    expect(
      (
        await lease.pool.query('SELECT id FROM session WHERE "userId" = $1', [
          h.row.userId,
        ])
      ).rows,
    ).toHaveLength(1)
    await depart(h.row.userId, h.ctx)
    expect(
      (
        await lease.pool.query('SELECT publication_state FROM portals WHERE id = $1', [
          added.portalId,
        ])
      ).rows,
    ).toEqual([{ publication_state: 'archived' }])
    await commands.removeMember(command)
    expect(
      (await lease.pool.query('SELECT id FROM member WHERE id = $1', [memberId])).rows,
    ).toEqual([])
    expect(
      (
        await lease.pool.query('SELECT id FROM session WHERE "userId" = $1', [
          h.row.userId,
        ])
      ).rows,
    ).toEqual([])
  })
  it('leaves legacy participations to the existing archive and out of the staff-account roster', async () => {
    const h = await setup()
    await lease.pool.query(
      'UPDATE staff_participations SET personal_portal_id = NULL WHERE id = $1',
      [h.row.participationId],
    )
    const management = createStaffManagementStore(db, () => NOW)
    expect(
      await management.target(h.row.organizationId, h.row.participationId),
    ).toBeNull()
    expect(await management.list(h.row.organizationId, h.row.propertyId)).toEqual([])
    await createStaffParticipationRepository(db).archive(
      h.row.organizationId,
      h.row.participationId,
      NOW,
      'removed',
      1,
    )
  })
  it.each(['member', 'admin'])(
    'refuses a pending %s invitation at another Property before creating a setup',
    async (role) => {
      const h = await setup()
      await lease.pool.query('UPDATE invitation SET role = $2 WHERE id = $1', [
        h.row.invitationId,
        role,
      ])
      const propertyId = randomUUID()
      await lease.pool.query(
        "INSERT INTO properties (id, organization_id, name, slug, timezone) VALUES ($1::uuid,$2,'Second Property',$1::text,'UTC')",
        [propertyId, h.row.organizationId],
      )
      await expect(
        addStaffMember(h.deps)({ ...h.input, propertyId, email: h.row.email }, h.ctx),
      ).rejects.toMatchObject({ code: 'already_invited' })
      expect(
        (
          await lease.pool.query(
            'SELECT id FROM staff_onboardings WHERE organization_id = $1',
            [h.row.organizationId],
          )
        ).rows,
      ).toEqual([])
    },
  )
  it.each([true, false])(
    'preserves the returning person on an old removal retry (completed: %s)',
    async (completed) => {
      const h = await setup()
      await seedStaffAccountUser(lease.pool, h.row)
      await lease.pool.query(
        'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,\'member\',$4)',
        [randomUUID(), h.row.organizationId, h.row.userId, NOW],
      )
      await lease.pool.query(
        'INSERT INTO staff_user_links (organization_id, staff_participant_id, user_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5)',
        [h.row.organizationId, h.row.participantId, h.row.userId, NOW, h.row.inviterId],
      )
      const management = createStaffManagementStore(db, () => NOW)
      const old = (await management.target(h.row.organizationId, h.row.participationId))!
      await management.denyAccess(h.row.organizationId, old)
      if (completed) {
        await lease.pool.query(
          "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
          [h.row.portalId],
        )
        await lease.pool.query(
          'DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2',
          [h.row.organizationId, h.row.userId],
        )
        await lease.pool.query(
          'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,\'member\',$4)',
          [randomUUID(), h.row.organizationId, h.row.userId, NOW],
        )
      }
      const returning = await addStaffMember(h.deps)(
        { ...h.input, email: h.row.email },
        h.ctx,
      )
      expect(returning.status).toBe('done')
      expect(returning.participationId).not.toBe(h.row.participationId)
      const newPerson = (await management.target(
        h.row.organizationId,
        returning.participationId,
      ))!
      expect(newPerson.participantId).not.toBe(h.row.participantId)
      await lease.pool.query(
        'INSERT INTO session (id, "userId", token, "expiresAt", "createdAt", "updatedAt") VALUES ($1,$2,$3,$4,$5,$5)',
        [
          randomUUID(),
          h.row.userId,
          randomUUID(),
          new Date(NOW.getTime() + 86400000),
          NOW,
        ],
      )
      const operation = (await h.base.findOperation(
        h.row.organizationId,
        h.input.operationId,
      ))!
      await h.base.reserve({
        ...operation,
        id: randomUUID(),
        email: h.row.email,
        displayName: 'Returning setup',
        staffParticipantId: randomUUID(),
        staffParticipationId: randomUUID(),
        portalId: randomUUID(),
        invitationId: randomUUID(),
        status: 'running',
        step: 'person',
      })
      const snapshot = async () => {
        const tables = [
          'member',
          'session',
          'staff_user_links',
          'staff_participations',
          'portals',
          'staff_onboardings',
          'staff_participants',
          'invitation',
          'portal_responsibilities',
          'outbox_events',
        ]
        return Promise.all(
          tables.map(async (table) => {
            const column =
              table === 'member' || table === 'invitation'
                ? '"organizationId"'
                : table === 'session'
                  ? '"userId"'
                  : 'organization_id'
            const value = table === 'session' ? h.row.userId : h.row.organizationId
            const rows = await lease.pool.query(
              `SELECT * FROM ${table} WHERE ${column} = $1 ORDER BY id`,
              [value],
            )
            return rows.rows
          }),
        )
      }
      const before = await snapshot()
      const commands = createAtomicIdentityCommandStore(db, randomUUID)
      const removalDeps = {
        ...h.deps,
        management,
        portals: {
          ...h.deps.portals,
          archive: async (id: string) => {
            await lease.pool.query(
              "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
              [id],
            )
          },
        },
        removeLogin: async (
          memberId: string,
          targetUserId: string,
          ctx: typeof h.ctx,
        ) => {
          await commands.removeMember({
            organizationId: ctx.organizationId,
            memberId,
            staffOnly: true,
            event: identityMemberRemoved({
              organizationId: ctx.organizationId,
              userId: userId(targetUserId),
              removedBy: ctx.userId,
              occurredAt: NOW,
            }),
          })
        },
      }
      const remove = removeStaffMember(removalDeps)
      await expect(
        renameStaffMember(removalDeps)(
          {
            participationId: h.row.participationId,
            displayName: 'Stale rename',
          },
          h.ctx,
        ),
      ).rejects.toThrow('This staff participation has ended')
      await expect(
        resendStaffInvitation(removalDeps)(
          {
            participationId: h.row.participationId,
          },
          h.ctx,
        ),
      ).rejects.toThrow('This staff participation has ended')
      await expect(
        management.rename(
          h.row.organizationId,
          old,
          'Stale rename',
          async () => {
            throw new Error('An ended participation must never rename its Portal')
          },
          [h.row.propertyId],
        ),
      ).rejects.toThrow('This staff participation has ended')
      await expect(
        db.transaction((tx) =>
          linkStaffInvitation(tx, {
            organizationId: h.row.organizationId,
            participationId: h.row.participationId,
            userId: h.row.userId,
            actorId: h.row.inviterId,
            at: NOW,
          }),
        ),
      ).rejects.toThrow('This staff invitation has ended')
      expect(await snapshot()).toEqual(before)
      expect(await remove({ participationId: h.row.participationId }, h.ctx)).toEqual({
        removed: true,
      })
      const after = await snapshot()
      if (completed) expect(after).toEqual(before)
      else {
        expect(after[0]).toEqual(before[0])
        expect(after[1]).toEqual(before[1])
        expect(after[2]).toEqual(before[2])
        expect(after[5]).toEqual(before[5])
        expect(after[6]).toEqual(before[6])
        expect(after[7]).toEqual(before[7])
        expect(after[8]).toEqual(before[8])
        expect(after[9]).toEqual(before[9])
        expect(after[3]?.filter((row) => row.id !== h.row.participationId)).toEqual(
          before[3]?.filter((row) => row.id !== h.row.participationId),
        )
        expect(after[4]?.filter((row) => row.id !== h.row.portalId)).toEqual(
          before[4]?.filter((row) => row.id !== h.row.portalId),
        )
        expect(
          (await management.target(h.row.organizationId, returning.participationId))!
            .portalId,
        ).toBe(returning.portalId)
      }
      expect(await remove({ participationId: h.row.participationId }, h.ctx)).toEqual({
        removed: true,
      })
      expect(await snapshot()).toEqual(after)
    },
  )
  it('locks an unfinished personal setup before its Portal FK can be filled', async () => {
    const h = await setup('person')
    const result = await addStaffMember(h.deps)(h.input, h.ctx)
    const repository = createStaffParticipationRepository(db)
    await expect(
      repository.archive(h.row.organizationId, result.participationId, NOW, 'removed', 1),
    ).rejects.toMatchObject({ code: 'staff_personal_portal_locked' })
    await expect(
      repository.replaceResponsibilities({
        organizationId: h.row.organizationId,
        propertyId: h.row.propertyId,
        staffParticipationId: result.participationId,
        selections: [],
        actorId: h.row.inviterId,
        at: NOW,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: 'staff_personal_portal_locked' })
    expect((await addStaffMember(h.deps)(h.input, h.ctx)).status).toBe('done')
  })
  it.each(STAFF_ONBOARDING_STEPS)(
    'resumes a committed %s failure without duplicate people, Portals or invitations',
    async (step) => {
      const h = await setup(step)
      const add = addStaffMember(h.deps)
      const first = await add(h.input, h.ctx)
      expect(first).toMatchObject({ status: 'failed', step, code: 'injected_failure' })
      const second = await add(h.input, h.ctx)
      expect(second).toMatchObject({
        status: 'done',
        portalId: first.portalId,
        participationId: first.participationId,
      })
      expect(await add(h.input, h.ctx)).toEqual(second)
      const saved = await h.base.findOperation(h.row.organizationId, h.input.operationId)
      expect(saved).toMatchObject({ email: null, displayName: null })
      expect(
        (
          await lease.pool.query(
            'SELECT id FROM staff_participations WHERE organization_id = $1 AND id = $2',
            [h.row.organizationId, first.participationId],
          )
        ).rows,
      ).toHaveLength(1)
      expect(
        (
          await lease.pool.query(
            'SELECT id FROM portals WHERE organization_id = $1 AND id = $2',
            [h.row.organizationId, first.portalId],
          )
        ).rows,
      ).toHaveLength(1)
      expect(
        (
          await lease.pool.query(
            'SELECT id FROM invitation WHERE "organizationId" = $1 AND "staffParticipationId" = $2',
            [h.row.organizationId, first.participationId],
          )
        ).rows,
      ).toHaveLength(1)
    },
  )

  it('reconciles a concurrent canonical rename when binding an already-created Portal', async () => {
    const h = await setup('portal')
    const first = await addStaffMember(h.deps)(h.input, h.ctx)
    const saved = (await h.base.findOperation(h.row.organizationId, h.input.operationId))!
    await lease.pool.query(
      'UPDATE staff_participants SET display_name = $1 WHERE id = $2',
      ['Canonical name', saved.staffParticipantId],
    )
    expect((await addStaffMember(h.deps)(h.input, h.ctx)).status).toBe('done')
    expect(
      (
        await lease.pool.query(
          'SELECT display_name FROM staff_participations WHERE id = $1',
          [first.participationId],
        )
      ).rows,
    ).toEqual([{ display_name: 'Canonical name' }])
    expect(
      (await lease.pool.query('SELECT name FROM portals WHERE id = $1', [first.portalId]))
        .rows,
    ).toEqual([{ name: 'Canonical name' }])
  })
  it('serializes concurrent adds of one email before creating any person', async () => {
    const h = await setup()
    const add = addStaffMember(h.deps)
    const results = await Promise.allSettled([
      add(h.input, h.ctx),
      add({ ...h.input, operationId: randomUUID() }, h.ctx),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'already_invited' },
    })
    expect(
      (
        await lease.pool.query(
          'SELECT id FROM staff_onboardings WHERE organization_id = $1',
          [h.row.organizationId],
        )
      ).rows,
    ).toHaveLength(1)
  })
  it('links an existing Organization member without an invitation and ends access before later removal work', async () => {
    const h = await setup()
    await seedStaffAccountUser(lease.pool, h.row)
    await lease.pool.query('DELETE FROM invitation WHERE id = $1', [h.row.invitationId])
    await lease.pool.query(
      'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), h.row.organizationId, h.row.userId, 'member', NOW],
    )
    const result = await addStaffMember(h.deps)({ ...h.input, email: h.row.email }, h.ctx)
    expect(result.status).toBe('done')
    expect(
      (
        await lease.pool.query(
          'SELECT id FROM invitation WHERE "staffParticipationId" = $1',
          [result.participationId],
        )
      ).rows,
    ).toEqual([])
    const management = createStaffManagementStore(db, () => NOW)
    const target = (await management.target(
      h.row.organizationId,
      result.participationId,
    ))!
    await management.denyAccess(h.row.organizationId, target)
    await management.denyAccess(h.row.organizationId, target)
    expect(
      (
        await lease.pool.query(
          'SELECT id FROM staff_user_links WHERE organization_id = $1 AND user_id = $2 AND effective_to IS NULL',
          [h.row.organizationId, h.row.userId],
        )
      ).rows,
    ).toEqual([])
  })

  describe('the roster for someone with a login', () => {
    const DAY = 86_400_000
    async function linkedPerson() {
      const h = await setup()
      await seedStaffAccountUser(lease.pool, h.row)
      await lease.pool.query('DELETE FROM invitation WHERE id = $1', [h.row.invitationId])
      await lease.pool.query(
        'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), h.row.organizationId, h.row.userId, 'member', NOW],
      )
      const result = await addStaffMember(h.deps)(
        { ...h.input, email: h.row.email },
        h.ctx,
      )
      const management = createStaffManagementStore(db, () => NOW)
      const row = async () =>
        (await management.list(h.row.organizationId, h.row.propertyId)).find(
          (member) => member.participationId === result.participationId,
        )!
      return { h, result, row }
    }
    it('dates joining from this Property, not an older login at another', async () => {
      const { h, result, row } = await linkedPerson()
      const linkedLongAgo = new Date(NOW.getTime() - 20 * DAY)
      await lease.pool.query(
        'UPDATE staff_user_links SET effective_from = $1 WHERE organization_id = $2 AND user_id = $3',
        [linkedLongAgo, h.row.organizationId, h.row.userId],
      )
      await lease.pool.query(
        'UPDATE staff_participations SET started_at = $1 WHERE id = $2',
        [NOW, result.participationId],
      )
      expect(new Date((await row()).joinedAt!).getTime()).toBe(NOW.getTime())
      await lease.pool.query(
        'UPDATE staff_participations SET started_at = $1 WHERE id = $2',
        [new Date(NOW.getTime() - 40 * DAY), result.participationId],
      )
      expect(new Date((await row()).joinedAt!).getTime()).toBe(linkedLongAgo.getTime())
    })
    it('has no joined date for someone who has not joined', async () => {
      const h = await setup()
      const added = await addStaffMember(h.deps)(h.input, h.ctx)
      const roster = await createStaffManagementStore(db, () => NOW).list(
        h.row.organizationId,
        h.row.propertyId,
      )
      expect(
        roster.find((member) => member.participationId === added.participationId),
      ).toMatchObject({ access: 'invited', joinedAt: null })
    })
    it('drops a failed-send marker once the person has joined anyway', async () => {
      const { h, result, row } = await linkedPerson()
      await h.base.markDeliveryProblem(h.row.organizationId, result.participationId, true)
      expect(await row()).toMatchObject({ access: 'active', code: null })
    })
  })

  it('keeps an unfinished removal visible for retry and resolves a login before its link step', async () => {
    const h = await setup('publication')
    await seedStaffAccountUser(lease.pool, h.row)
    await lease.pool.query('DELETE FROM invitation WHERE id = $1', [h.row.invitationId])
    await lease.pool.query(
      'INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), h.row.organizationId, h.row.userId, 'member', NOW],
    )
    const operation = await addStaffMember(h.deps)(
      { ...h.input, email: h.row.email },
      h.ctx,
    )
    const management = createStaffManagementStore(db, () => NOW)
    const target = (await management.target(
      h.row.organizationId,
      operation.participationId,
    ))!
    expect(target).toMatchObject({ userId: h.row.userId, memberRole: 'member' })
    await management.denyAccess(h.row.organizationId, target)
    await expect(
      addStaffMember(h.deps)({ ...h.input, email: h.row.email }, h.ctx),
    ).rejects.toMatchObject({ code: 'operation_conflict' })
    expect(
      (await management.list(h.row.organizationId, h.row.propertyId)).find(
        (person) => person.participationId === operation.participationId,
      ),
    ).toMatchObject({ access: 'failed', step: 'removal', code: 'removal_incomplete' })
    expect(
      await management.target(h.row.organizationId, operation.participationId),
    ).toMatchObject({ userId: h.row.userId, memberRole: 'member' })

    await lease.pool.query(
      'INSERT INTO session (id, "userId", token, "expiresAt", "createdAt", "updatedAt", "activeOrganizationId") VALUES ($1,$2,$3,$4,$5,$5,$6)',
      [
        randomUUID(),
        h.row.userId,
        randomUUID(),
        new Date(NOW.getTime() + 86400000),
        NOW,
        h.row.organizationId,
      ],
    )
    const commands = createAtomicIdentityCommandStore(db, randomUUID)
    let failAfterLogin = true
    const remove = removeStaffMember({
      ...h.deps,
      management,
      portals: {
        ...h.deps.portals,
        archive: async (id) => {
          await lease.pool.query(
            "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
            [id],
          )
        },
      },
      removeLogin: async (memberId, targetUserId, ctx) => {
        await commands.removeMember({
          organizationId: ctx.organizationId,
          memberId,
          staffOnly: true,
          event: identityMemberRemoved({
            organizationId: ctx.organizationId,
            userId: userId(targetUserId),
            removedBy: ctx.userId,
            occurredAt: NOW,
          }),
        })
        if (failAfterLogin) {
          failAfterLogin = false
          throw new Error('Injected failure after login removal')
        }
      },
    })
    await expect(
      remove({ participationId: operation.participationId }, h.ctx),
    ).rejects.toThrow('Injected failure after login removal')
    expect(
      (
        await lease.pool.query('SELECT id FROM session WHERE "userId" = $1', [
          h.row.userId,
        ])
      ).rows,
    ).toEqual([])
    expect(await remove({ participationId: operation.participationId }, h.ctx)).toEqual({
      removed: true,
    })
    expect(
      (
        await lease.pool.query(
          'SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2',
          [h.row.organizationId, h.row.inviterId],
        )
      ).rows,
    ).toEqual([{ role: 'owner' }])
    expect(
      (await management.list(h.row.organizationId, h.row.propertyId)).some(
        (person) => person.participationId === operation.participationId,
      ),
    ).toBe(false)
  })
  it('enforces tenant scope, unique active personal ownership and identifiers-only completion', async () => {
    const h = await setup()
    await expect(
      lease.pool.query(
        "INSERT INTO staff_participations (organization_id, property_id, staff_participant_id, personal_portal_id, display_name, created_by) VALUES ($1,$2,$3,$4,'Duplicate','test')",
        [h.row.organizationId, h.row.propertyId, h.row.participantId, h.row.portalId],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      lease.pool.query(
        'UPDATE staff_participations SET personal_portal_id = $1 WHERE id = $2',
        [randomUUID(), h.row.participationId],
      ),
    ).rejects.toMatchObject({ code: '23503' })
    const saved = await h.base.reserve({
      id: h.input.operationId,
      organizationId: h.row.organizationId,
      propertyId: h.row.propertyId,
      email: h.input.email,
      displayName: h.input.displayName,
      sourcePortalId: null,
      portalGroupId: null,
      requestedBy: h.row.inviterId,
      status: 'running',
      step: 'person',
      staffParticipantId: randomUUID(),
      staffParticipationId: randomUUID(),
      portalId: randomUUID(),
      invitationId: randomUUID(),
      failureCode: null,
    })
    await expect(
      lease.pool.query("UPDATE staff_onboardings SET status = 'done' WHERE id = $1", [
        saved.id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
    expect(await h.base.checkpoint(saved.id, 'access', 'cancelled', null)).toMatchObject({
      email: null,
      displayName: null,
    })
  })
})

describe.sequential('invitation correction and delivery problems (PostgreSQL)', () => {
  it('replaces an invitation in one transaction and preserves the Portal and participation', async () => {
    const h = await setup()
    const added = await addStaffMember(h.deps)(h.input, h.ctx)
    const management = createStaffManagementStore(db, () => NOW)
    const email = `corrected-${randomUUID()}@example.com`
    const corrected = await replaceStaffInvitation(db, () => NOW)(
      {
        organizationId: h.row.organizationId,
        participationId: added.participationId,
        oldEmail: h.input.email,
        email,
        invitationId: randomUUID(),
        actorId: h.row.inviterId,
      },
      async () => undefined,
    )
    expect(corrected.portalId).toBe(added.portalId)
    const invitations = await lease.pool.query(
      'SELECT email,status FROM invitation WHERE "staffParticipationId" = $1',
      [added.participationId],
    )
    expect(invitations.rows).toEqual(
      expect.arrayContaining([
        { email: h.input.email, status: 'canceled' },
        { email, status: 'pending' },
      ]),
    )
    await h.base.markDeliveryProblem(h.row.organizationId, added.participationId, true)
    expect(
      (await management.list(h.row.organizationId, h.row.propertyId))[0],
    ).toMatchObject({ email, access: 'invited', code: 'invitation_delivery_failed' })
    await h.base.markDeliveryProblem(h.row.organizationId, added.participationId, false)
    expect(
      (await management.list(h.row.organizationId, h.row.propertyId))[0]?.code,
    ).toBeNull()
  })
  it('a budget refusal leaves the original invitation alive', async () => {
    const h = await setup()
    const added = await addStaffMember(h.deps)(h.input, h.ctx)
    await expect(
      replaceStaffInvitation(db, () => NOW)(
        {
          organizationId: h.row.organizationId,
          participationId: added.participationId,
          oldEmail: h.input.email,
          email: 'corrected@example.com',
          invitationId: randomUUID(),
          actorId: h.row.inviterId,
        },
        async () => {
          throw new Error('Budget exhausted')
        },
      ),
    ).rejects.toThrow('Budget exhausted')
    const rows = await lease.pool.query(
      'SELECT email,status FROM invitation WHERE "staffParticipationId" = $1',
      [added.participationId],
    )
    expect(rows.rows).toEqual([{ email: h.input.email, status: 'pending' }])
  })
  it('refuses a linked or accepted person inside the transaction', async () => {
    const h = await setup()
    const added = await addStaffMember(h.deps)(h.input, h.ctx)
    await lease.pool.query(
      `UPDATE invitation SET status = 'accepted' WHERE "staffParticipationId" = $1`,
      [added.participationId],
    )
    await expect(
      replaceStaffInvitation(db, () => NOW)(
        {
          organizationId: h.row.organizationId,
          participationId: added.participationId,
          oldEmail: h.input.email,
          email: 'corrected@example.com',
          invitationId: randomUUID(),
          actorId: h.row.inviterId,
        },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'operation_conflict' })
  })
  it('serializes a correction with a concurrent Add of the same address', async () => {
    const h = await setup()
    const added = await addStaffMember(h.deps)(h.input, h.ctx)
    const email = `concurrent-${randomUUID()}@example.com`
    const management = createStaffManagementStore(db, () => NOW)
    const deps = { ...h.deps, management, removeLogin: async () => undefined }
    const outcomes = await Promise.allSettled([
      changeStaffInvitationEmail(deps)(
        { participationId: added.participationId, email },
        h.ctx,
      ),
      addStaffMember(h.deps)({ ...h.input, operationId: randomUUID(), email }, h.ctx),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const refused = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(refused).toMatchObject({
      status: 'rejected',
      reason: {
        code: expect.stringMatching(
          /already_invited|already_staff_here|operation_conflict/,
        ),
      },
    })
    const rows = await lease.pool.query(
      `SELECT id FROM invitation WHERE "organizationId" = $1 AND email = $2 AND status = 'pending'`,
      [h.row.organizationId, email],
    )
    expect(rows.rows).toHaveLength(1)
  })
})

it('two concurrent email corrections share the bounded pool without nested address slots', async () => {
  const h = await setup()
  const one = await addStaffMember(h.deps)(h.input, h.ctx)
  const two = await addStaffMember(h.deps)(
    {
      ...h.input,
      operationId: randomUUID(),
      email: `second-${randomUUID()}@example.com`,
    },
    h.ctx,
  )
  const deps = {
    ...h.deps,
    management: createStaffManagementStore(db, () => NOW),
    removeLogin: async () => undefined,
  }
  const results = await Promise.all([
    changeStaffInvitationEmail(deps)(
      {
        participationId: one.participationId,
        email: `fixed-one-${randomUUID()}@example.com`,
      },
      h.ctx,
    ),
    changeStaffInvitationEmail(deps)(
      {
        participationId: two.participationId,
        email: `fixed-two-${randomUUID()}@example.com`,
      },
      h.ctx,
    ),
  ])
  expect(results).toEqual([{ changed: true }, { changed: true }])
})

it('reads the current Group rather than the original Add choice', async () => {
  const h = await setup()
  const added = await addStaffMember(h.deps)(h.input, h.ctx)
  const groupId = randomUUID()
  await lease.pool.query(
    'INSERT INTO portal_groups (id,organization_id,property_id,name,sort_key) VALUES ($1,$2,$3,$4,$5)',
    [groupId, h.row.organizationId, h.row.propertyId, 'Reception', 'a'],
  )
  await lease.pool.query(
    'INSERT INTO portal_group_memberships (organization_id,property_id,portal_id,portal_group_id,created_by,effective_from) VALUES ($1,$2,$3,$4,$5,$6)',
    [
      h.row.organizationId,
      h.row.propertyId,
      added.portalId,
      groupId,
      h.row.inviterId,
      NOW,
    ],
  )
  const management = createStaffManagementStore(db, () => NOW)
  expect(
    (await management.list(h.row.organizationId, h.row.propertyId))[0]?.group,
  ).toEqual({ id: groupId, name: 'Reception' })
  await lease.pool.query(
    'DELETE FROM portal_group_memberships WHERE organization_id = $1',
    [h.row.organizationId],
  )
  await lease.pool.query('DELETE FROM portal_groups WHERE organization_id = $1', [
    h.row.organizationId,
  ])
})
