import {
  removeStaffMember,
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
    withAddressLock: (email, run) =>
      store.withAddressLock(email, (locked) => run(decorate(locked))),
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
    idGen: randomUUID,
    authorizeProperty: async () => undefined,
    invitationBudget: async () => 20,
    spendInvitationBudget: async () => undefined,
    deliverAccess: async () => undefined,
    portals: {
      check: async () => ({ omittedLinks: [] }),
      rename: async (input, _ctx, transaction) => {
        await (transaction as Tx).execute(
          sql`UPDATE portals SET name = ${input.displayName} WHERE organization_id = ${row.organizationId} AND id = ANY(${[...input.portalIds]}::uuid[])`,
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
      reason: { code: 'already_staff_here' },
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
