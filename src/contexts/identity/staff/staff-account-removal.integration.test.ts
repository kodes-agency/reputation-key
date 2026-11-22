import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { userId } from '#/shared/domain/ids'
import { STAFF_FIXTURE_NOW as NOW } from '#/shared/testing/staff-account-fixture'
import { identityMemberRemoved } from '../domain/events'
import { createAtomicIdentityCommandStore } from '../members/identity-command-store.server'
import { addStaffMember } from './add-staff-member.server'
import {
  removeStaffMember,
  removeStaffForMemberDeparture,
  renameStaffMember,
  resendStaffInvitation,
} from './manage-staff-accounts.server'
import { linkStaffInvitation } from './staff-invitation-link.server'
import { createStaffManagementStore } from './staff-management.store.server'
import { useStaffAccountEnv } from './staff-account-store.test-fixtures'

const env = useStaffAccountEnv()
const { setup, rows, insertMember, insertSession, seedExistingMember, removalDeps } = env

const SNAPSHOT_TABLES = [
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
] as const
type SnapshotTable = (typeof SNAPSHOT_TABLES)[number]

describe.sequential('staff onboarding checkpoints and constraints (PostgreSQL)', () => {
  it('keeps a manager login until a failed staff departure is retried and its Portal archived', async () => {
    const h = await setup()
    const memberId = await seedExistingMember(h, 'admin')
    const added = await addStaffMember(h.deps)({ ...h.input, email: h.row.email }, h.ctx)
    expect(added.status).toBe('done')
    await insertSession(h.row.userId)
    const commands = createAtomicIdentityCommandStore(env.db, randomUUID)
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
      management: createStaffManagementStore(env.db, () => NOW),
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
          await env.pool.query(
            "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
            [id],
          )
        },
      },
    })
    await expect(depart(h.row.userId, h.ctx)).rejects.toThrow(
      'Staff removal is unfinished',
    )
    expect(await rows('SELECT id FROM member WHERE id = $1', [memberId])).toHaveLength(1)
    expect(
      await rows('SELECT id FROM session WHERE "userId" = $1', [h.row.userId]),
    ).toHaveLength(1)
    await depart(h.row.userId, h.ctx)
    expect(
      await rows('SELECT publication_state FROM portals WHERE id = $1', [added.portalId]),
    ).toEqual([{ publication_state: 'archived' }])
    await commands.removeMember(command)
    expect(await rows('SELECT id FROM member WHERE id = $1', [memberId])).toEqual([])
    expect(
      await rows('SELECT id FROM session WHERE "userId" = $1', [h.row.userId]),
    ).toEqual([])
  })

  it.each([true, false])(
    'preserves the returning person on an old removal retry (completed: %s)',
    async (completed) => {
      const h = await setup()
      await seedExistingMember(h, 'member', false)
      await env.pool.query(
        'INSERT INTO staff_user_links (organization_id, staff_participant_id, user_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5)',
        [h.row.organizationId, h.row.participantId, h.row.userId, NOW, h.row.inviterId],
      )
      const management = createStaffManagementStore(env.db, () => NOW)
      const old = (await management.target(h.row.organizationId, h.row.participationId))!
      await management.denyAccess(h.row.organizationId, old)
      if (completed) {
        await env.pool.query(
          "UPDATE portals SET publication_state = 'archived' WHERE id = $1",
          [h.row.portalId],
        )
        await env.pool.query(
          'DELETE FROM member WHERE "organizationId" = $1 AND "userId" = $2',
          [h.row.organizationId, h.row.userId],
        )
        await insertMember(h.row.organizationId, h.row.userId, 'member')
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
      await insertSession(h.row.userId)
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
        const tables = await Promise.all(
          SNAPSHOT_TABLES.map(async (table) => {
            const column =
              table === 'member' || table === 'invitation'
                ? '"organizationId"'
                : table === 'session'
                  ? '"userId"'
                  : 'organization_id'
            const value = table === 'session' ? h.row.userId : h.row.organizationId
            return [
              table,
              await rows(`SELECT * FROM ${table} WHERE ${column} = $1 ORDER BY id`, [
                value,
              ]),
            ] as const
          }),
        )
        return Object.fromEntries(tables) as Record<
          SnapshotTable,
          Record<string, unknown>[]
        >
      }
      const before = await snapshot()
      const deps = removalDeps(h, management)
      const remove = removeStaffMember(deps)
      await expect(
        renameStaffMember(deps)(
          { participationId: h.row.participationId, displayName: 'Stale rename' },
          h.ctx,
        ),
      ).rejects.toThrow('This staff participation has ended')
      await expect(
        resendStaffInvitation(deps)({ participationId: h.row.participationId }, h.ctx),
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
        env.db.transaction((tx) =>
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
        expect(after.member).toEqual(before.member)
        expect(after.session).toEqual(before.session)
        expect(after.staff_user_links).toEqual(before.staff_user_links)
        expect(after.staff_onboardings).toEqual(before.staff_onboardings)
        expect(after.staff_participants).toEqual(before.staff_participants)
        expect(after.invitation).toEqual(before.invitation)
        expect(after.portal_responsibilities).toEqual(before.portal_responsibilities)
        expect(after.outbox_events).toEqual(before.outbox_events)
        expect(
          after.staff_participations.filter((row) => row.id !== h.row.participationId),
        ).toEqual(
          before.staff_participations.filter((row) => row.id !== h.row.participationId),
        )
        expect(after.portals.filter((row) => row.id !== h.row.portalId)).toEqual(
          before.portals.filter((row) => row.id !== h.row.portalId),
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

  it('keeps an unfinished removal visible for retry and resolves a login before its link step', async () => {
    const h = await setup('publication')
    await seedExistingMember(h, 'member')
    const operation = await addStaffMember(h.deps)(
      { ...h.input, email: h.row.email },
      h.ctx,
    )
    const management = createStaffManagementStore(env.db, () => NOW)
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

    await insertSession(h.row.userId, h.row.organizationId)
    let failAfterLogin = true
    const remove = removeStaffMember(
      removalDeps(h, management, {
        afterLogin: () => {
          if (failAfterLogin) {
            failAfterLogin = false
            throw new Error('Injected failure after login removal')
          }
        },
      }),
    )
    await expect(
      remove({ participationId: operation.participationId }, h.ctx),
    ).rejects.toThrow('Injected failure after login removal')
    expect(
      await rows('SELECT id FROM session WHERE "userId" = $1', [h.row.userId]),
    ).toEqual([])
    expect(await remove({ participationId: operation.participationId }, h.ctx)).toEqual({
      removed: true,
    })
    expect(
      await rows(
        'SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2',
        [h.row.organizationId, h.row.inviterId],
      ),
    ).toEqual([{ role: 'owner' }])
    expect(
      (await management.list(h.row.organizationId, h.row.propertyId)).some(
        (person) => person.participationId === operation.participationId,
      ),
    ).toBe(false)
  })
})
