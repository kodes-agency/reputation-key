import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { STAFF_FIXTURE_NOW as NOW } from '#/shared/testing/staff-account-fixture'
import { STAFF_ONBOARDING_STEPS } from '../domain/staff-account'
import { addStaffMember } from './add-staff-member.server'
import { changeStaffInvitationEmail } from './change-staff-email.server'
import { linkStaffInvitation } from './staff-invitation-link.server'
import { createStaffManagementStore } from './staff-management.store.server'
import { useStaffAccountEnv } from './staff-account-store.test-fixtures'

const env = useStaffAccountEnv()
const { setup, rows, seedExistingMember, replace } = env

describe.sequential('staff onboarding checkpoints and constraints (PostgreSQL)', () => {
  it('cannot create a staff link across a concurrent membership deletion', async () => {
    const h = await setup()
    const memberId = await seedExistingMember(h, 'admin', false)
    const client = await env.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM member WHERE id = $1', [memberId])
      const result = env.db
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
        await rows('SELECT id FROM staff_user_links WHERE organization_id = $1', [
          h.row.organizationId,
        ]),
      ).toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
  it('leaves legacy participations out of the staff-account roster', async () => {
    const h = await setup()
    await env.pool.query(
      'UPDATE staff_participations SET personal_portal_id = NULL WHERE id = $1',
      [h.row.participationId],
    )
    const management = createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000)
    expect(
      await management.target(h.row.organizationId, h.row.participationId),
    ).toBeNull()
    expect(await management.list(h.row.organizationId, h.row.propertyId)).toEqual([])
  })
  it.each(['member', 'admin'])(
    'refuses a pending %s invitation at another Property before creating a setup',
    async (role) => {
      const h = await setup()
      await env.pool.query('UPDATE invitation SET role = $2 WHERE id = $1', [
        h.row.invitationId,
        role,
      ])
      const propertyId = randomUUID()
      await env.pool.query(
        "INSERT INTO properties (id, organization_id, name, slug, timezone) VALUES ($1::uuid,$2,'Second Property',$1::text,'UTC')",
        [propertyId, h.row.organizationId],
      )
      await expect(
        addStaffMember(h.deps)({ ...h.input, propertyId, email: h.row.email }, h.ctx),
      ).rejects.toMatchObject({ code: 'already_invited' })
      expect(
        await rows('SELECT id FROM staff_onboardings WHERE organization_id = $1', [
          h.row.organizationId,
        ]),
      ).toEqual([])
    },
  )
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
        await rows(
          'SELECT id FROM staff_participations WHERE organization_id = $1 AND id = $2',
          [h.row.organizationId, first.participationId],
        ),
      ).toHaveLength(1)
      expect(
        await rows('SELECT id FROM portals WHERE organization_id = $1 AND id = $2', [
          h.row.organizationId,
          first.portalId,
        ]),
      ).toHaveLength(1)
      expect(
        await rows(
          'SELECT id FROM invitation WHERE "organizationId" = $1 AND "staffParticipationId" = $2',
          [h.row.organizationId, first.participationId],
        ),
      ).toHaveLength(1)
    },
  )

  it('reconciles a concurrent canonical rename when binding an already-created Portal', async () => {
    const h = await setup('portal')
    const first = await addStaffMember(h.deps)(h.input, h.ctx)
    const saved = (await h.base.findOperation(h.row.organizationId, h.input.operationId))!
    await env.pool.query(
      'UPDATE staff_participants SET display_name = $1 WHERE id = $2',
      ['Canonical name', saved.staffParticipantId],
    )
    expect((await addStaffMember(h.deps)(h.input, h.ctx)).status).toBe('done')
    expect(
      await rows('SELECT display_name FROM staff_participations WHERE id = $1', [
        first.participationId,
      ]),
    ).toEqual([{ display_name: 'Canonical name' }])
    expect(
      await rows('SELECT name FROM portals WHERE id = $1', [first.portalId]),
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
      await rows('SELECT id FROM staff_onboardings WHERE organization_id = $1', [
        h.row.organizationId,
      ]),
    ).toHaveLength(1)
  })
  it('links an existing Organization member without an invitation and ends access before later removal work', async () => {
    const h = await setup()
    await seedExistingMember(h, 'member')
    const result = await addStaffMember(h.deps)({ ...h.input, email: h.row.email }, h.ctx)
    expect(result.status).toBe('done')
    expect(
      await rows('SELECT id FROM invitation WHERE "staffParticipationId" = $1', [
        result.participationId,
      ]),
    ).toEqual([])
    const management = createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000)
    const target = (await management.target(
      h.row.organizationId,
      result.participationId,
    ))!
    await management.denyAccess(h.row.organizationId, target)
    await management.denyAccess(h.row.organizationId, target)
    expect(
      await rows(
        'SELECT id FROM staff_user_links WHERE organization_id = $1 AND user_id = $2 AND effective_to IS NULL',
        [h.row.organizationId, h.row.userId],
      ),
    ).toEqual([])
  })

  describe('the roster for someone with a login', () => {
    const DAY = 86_400_000
    async function linkedPerson() {
      const h = await setup()
      await seedExistingMember(h, 'member')
      const result = await addStaffMember(h.deps)(
        { ...h.input, email: h.row.email },
        h.ctx,
      )
      const management = createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000)
      const row = async () =>
        (await management.list(h.row.organizationId, h.row.propertyId)).find(
          (member) => member.participationId === result.participationId,
        )!
      return { h, result, row }
    }
    it('dates joining from this Property, not an older login at another', async () => {
      const { h, result, row } = await linkedPerson()
      const linkedLongAgo = new Date(NOW.getTime() - 20 * DAY)
      await env.pool.query(
        'UPDATE staff_user_links SET effective_from = $1 WHERE organization_id = $2 AND user_id = $3',
        [linkedLongAgo, h.row.organizationId, h.row.userId],
      )
      await env.pool.query(
        'UPDATE staff_participations SET started_at = $1 WHERE id = $2',
        [NOW, result.participationId],
      )
      expect(new Date((await row()).joinedAt!).getTime()).toBe(NOW.getTime())
      await env.pool.query(
        'UPDATE staff_participations SET started_at = $1 WHERE id = $2',
        [new Date(NOW.getTime() - 40 * DAY), result.participationId],
      )
      expect(new Date((await row()).joinedAt!).getTime()).toBe(linkedLongAgo.getTime())
    })
    it('has no joined date for someone who has not joined', async () => {
      const h = await setup()
      const added = await addStaffMember(h.deps)(h.input, h.ctx)
      const roster = await createStaffManagementStore(
        env.db,
        () => NOW,
        7 * 86_400_000,
      ).list(h.row.organizationId, h.row.propertyId)
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

  it('enforces tenant scope, unique active personal ownership and identifiers-only completion', async () => {
    const h = await setup()
    await expect(
      env.pool.query(
        "INSERT INTO staff_participations (organization_id, property_id, staff_participant_id, personal_portal_id, display_name, created_by) VALUES ($1,$2,$3,$4,'Duplicate','test')",
        [h.row.organizationId, h.row.propertyId, h.row.participantId, h.row.portalId],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      env.pool.query(
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
      env.pool.query("UPDATE staff_onboardings SET status = 'done' WHERE id = $1", [
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
    const management = createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000)
    const email = `corrected-${randomUUID()}@example.com`
    const corrected = await replace(h, added, email)
    expect(corrected.portalId).toBe(added.portalId)
    expect(
      await rows(
        'SELECT email,status FROM invitation WHERE "staffParticipationId" = $1',
        [added.participationId],
      ),
    ).toEqual(
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
      replace(h, added, undefined, async () => {
        throw new Error('Budget exhausted')
      }),
    ).rejects.toThrow('Budget exhausted')
    expect(
      await rows(
        'SELECT email,status FROM invitation WHERE "staffParticipationId" = $1',
        [added.participationId],
      ),
    ).toEqual([{ email: h.input.email, status: 'pending' }])
  })
  it('refuses a linked or accepted person inside the transaction', async () => {
    const h = await setup()
    const added = await addStaffMember(h.deps)(h.input, h.ctx)
    await env.pool.query(
      `UPDATE invitation SET status = 'accepted' WHERE "staffParticipationId" = $1`,
      [added.participationId],
    )
    await expect(replace(h, added)).rejects.toMatchObject({ code: 'operation_conflict' })
  })
  it('serializes a correction with a concurrent Add of the same address', async () => {
    const h = await setup()
    const added = await addStaffMember(h.deps)(h.input, h.ctx)
    const email = `concurrent-${randomUUID()}@example.com`
    const management = createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000)
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
    expect(
      await rows(
        `SELECT id FROM invitation WHERE "organizationId" = $1 AND email = $2 AND status = 'pending'`,
        [h.row.organizationId, email],
      ),
    ).toHaveLength(1)
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
    management: createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000),
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
  await env.pool.query(
    'INSERT INTO portal_groups (id,organization_id,property_id,name,sort_key) VALUES ($1,$2,$3,$4,$5)',
    [groupId, h.row.organizationId, h.row.propertyId, 'Reception', 'a'],
  )
  await env.pool.query(
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
  const management = createStaffManagementStore(env.db, () => NOW, 7 * 86_400_000)
  expect(
    (await management.list(h.row.organizationId, h.row.propertyId))[0]?.group,
  ).toEqual({
    id: groupId,
    name: 'Reception',
  })
  await env.pool.query(
    'DELETE FROM portal_group_memberships WHERE organization_id = $1',
    [h.row.organizationId],
  )
  await env.pool.query('DELETE FROM portal_groups WHERE organization_id = $1', [
    h.row.organizationId,
  ])
})
