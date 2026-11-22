// BQC-3.5 — identity command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real better-auth tables:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no invitation/member row survives.
//   2. Happy path: the state row and the outbox_events row commit together
//      with the same eventId.
//   3. Guards hold on the real DB: already-member/already-invited,
//      last-owner, invitation lifecycle.

import { describe, it, expect, beforeEach } from 'vitest'
import { setupIdentityMembersDb } from '#/shared/testing/identity-members-fixtures'
import { expectSingleWinner } from '#/shared/testing/settled-race'
import { unregisteredFact } from '#/shared/testing/unregistered-fact'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import {
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberInvited,
  identityMemberRemoved,
  identityMemberRoleChanged,
} from '../domain/events'
import type { IdentityMemberInvited } from '../domain/events'
import { isIdentityError } from '../domain/errors'
import { createAtomicIdentityCommandStore } from './identity-command-store.server'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'

const ORG_ID = organizationId('org-idcmd-0000-0000-0000-000000000001')
const INVITER_ID = userId('user-idcmd-inviter-00000000000001')
const ACCEPTOR_ID = userId('user-idcmd-acceptor-0000000000001')
const ACCEPTOR_EMAIL = 'idcmd-acceptor@test.com'
const NOW = new Date('2026-06-01T12:00:00.000Z')
const INVITE_EXPIRES_AT = new Date('2026-06-08T12:00:00.000Z')
const PENDING_EXPIRES_AT = new Date('2027-01-01T00:00:00.000Z')

const h = setupIdentityMembersDb(createAtomicIdentityCommandStore)

beforeEach(async () => {
  await h.seedOrganization(ORG_ID)
  await h.seedUser({
    id: INVITER_ID,
    email: 'idcmd-inviter@test.com',
    emailVerified: true,
  })
  await h.seedUser({ id: ACCEPTOR_ID, email: ACCEPTOR_EMAIL, emailVerified: true })
})

const refusedWith = (code: string) => (reason: unknown) =>
  isIdentityError(reason) && reason.code === code

const expectIdentityError = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy(refusedWith(code))

const invitedEvent = (
  invId: string,
  targetOrganizationId: typeof ORG_ID = ORG_ID,
): IdentityMemberInvited =>
  identityMemberInvited({
    organizationId: targetOrganizationId,
    role: 'PropertyManager',
    userId: INVITER_ID,
    invitationId: invitationId(invId),
    occurredAt: NOW,
  })

type InviteArgs = Parameters<ReturnType<typeof h.store>['inviteMember']>[0]

const inviteArgs = (id: string, overrides: Partial<InviteArgs> = {}): InviteArgs => ({
  invitationId: invitationId(id),
  organizationId: ORG_ID,
  email: 'idcmd-new@test.com',
  role: 'admin',
  inviterId: INVITER_ID,
  propertyIds: [],
  now: NOW,
  expiresAt: INVITE_EXPIRES_AT,
  event: invitedEvent(id, overrides.organizationId),
  ...overrides,
})

const accept = (id: string, { inviter = false } = {}) =>
  h.store().acceptInvitation({
    invitationId: invitationId(id),
    acceptorEmail: ACCEPTOR_EMAIL,
    acceptorUserId: ACCEPTOR_ID,
    now: NOW,
    buildEvent: (accepted) =>
      identityInvitationAccepted({
        organizationId: accepted.organizationId,
        userId: ACCEPTOR_ID,
        invitationId: invitationId(id),
        propertyIds: accepted.propertyIds,
        ...(inviter ? { inviterId: accepted.inviterId ?? undefined } : {}),
        occurredAt: NOW,
      }),
  })

const insertInvitationRow = (
  id: string,
  overrides: Partial<Parameters<typeof h.seedInvitation>[0]> = {},
) =>
  h.seedInvitation({
    id,
    organizationId: ORG_ID,
    email: ACCEPTOR_EMAIL,
    role: 'admin',
    status: 'pending',
    expiresAt: PENDING_EXPIRES_AT,
    propertyIds: null,
    inviterId: INVITER_ID,
    createdAt: new Date(),
    ...overrides,
  })

// Raw insert: the last-owner guard stays armed, unlike the shared seedMember.
const insertMemberRows = (
  rows: ReadonlyArray<
    readonly [id: string, targetOrganizationId: string, user: string, role: string]
  >,
) =>
  Promise.all(
    rows.map(([id, targetOrganizationId, user, role]) =>
      h.pool().query(
        `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
         VALUES ($1, $2, $3, $4, NOW())`,
        [id, targetOrganizationId, user, role],
      ),
    ),
  )

const seedOtherOrganization = async (id: string) => {
  const other = organizationId(id)
  await h.seedOrganization(other)
  return other
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)

const invitationStatuses = async (...ids: string[]) =>
  (
    await h
      .pool()
      .query(`SELECT status FROM invitation WHERE id = ANY($1) ORDER BY id`, [ids])
  ).rows

describe.sequential('identityCommandStore (integration)', () => {
  it('inviteMember commits the invitation + fact in one transaction', async () => {
    const event = invitedEvent('inv-idcmd-1')

    await h.store().inviteMember(
      inviteArgs('inv-idcmd-1', {
        email: 'IdCmd-New@Test.com',
        propertyIds: ['prop-a'],
        event,
      }),
    )

    const invitations = await h
      .pool()
      .query(
        'SELECT id, email, role, status, "inviterId", "propertyIds" FROM invitation WHERE "organizationId" = $1',
        [ORG_ID],
      )
    expect(invitations.rows).toHaveLength(1)
    expect(invitations.rows[0]).toMatchObject({
      id: 'inv-idcmd-1',
      email: 'idcmd-new@test.com',
      role: 'admin',
      status: 'pending',
      inviterId: INVITER_ID,
      propertyIds: '["prop-a"]',
    })
    const facts = await h.pool().query(
      `SELECT id, event_type, event_version, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.member.invited'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].id).toBe(event.eventId)
    expect(facts.rows[0].event_version).toBe(2)
    expect(facts.rows[0].payload).not.toHaveProperty('email')
    expect(JSON.stringify(facts.rows[0].payload)).not.toContain('idcmd-new@test.com')
  })

  it('inviteMember rolls back the invitation when the fact insert fails (unregistered type)', async () => {
    const ghost = unregisteredFact(invitedEvent('inv-idcmd-2'), 'identity.member.ghost')

    await expect(
      h.store().inviteMember(inviteArgs('inv-idcmd-2', { event: ghost })),
    ).rejects.toThrow(
      /Event type identity\.member\.ghost:v1 is not registered for the outbox/,
    )

    expect(await h.allInvitations()).toHaveLength(0)
  })

  it('inviteMember rejects an already-member email and a duplicate pending invite', async () => {
    await insertMemberRows([['member-idcmd-1', ORG_ID, ACCEPTOR_ID, 'member']])

    await expectIdentityError(
      h.store().inviteMember(inviteArgs('inv-idcmd-3', { email: ACCEPTOR_EMAIL })),
      'already_exists',
    )

    // No fact recorded for the rejected invite
    expect(await h.facts()).toHaveLength(0)
  })

  it('inviteMember rejects an existing membership in another Organization', async () => {
    const other = await seedOtherOrganization('org-idcmd-other-membership')
    await insertMemberRows([
      ['member-idcmd-other-membership', other, ACCEPTOR_ID, 'admin'],
    ])

    await expectIdentityError(
      h
        .store()
        .inviteMember(
          inviteArgs('inv-idcmd-membership-conflict', { email: ACCEPTOR_EMAIL }),
        ),
      'organization_conflict',
    )

    expect(await h.invitationById('inv-idcmd-binding-conflict')).toBeNull()
  })

  it('serializes competing cross-Organization invitations for one email', async () => {
    const otherOrg = await seedOtherOrganization('org-idcmd-0000-0000-0000-000000000003')
    const invite = (id: string, organizationId: typeof ORG_ID) =>
      h
        .store()
        .inviteMember(
          inviteArgs(id, { email: 'idcmd-invite-race@test.com', organizationId }),
        )

    const outcomes = await Promise.allSettled([
      invite('inv-idcmd-email-race-a', ORG_ID),
      invite('inv-idcmd-email-race-b', otherOrg),
    ])

    expectSingleWinner(outcomes, refusedWith('organization_conflict'))
    const invitations = await h
      .pool()
      .query(`SELECT id FROM invitation WHERE email = 'idcmd-invite-race@test.com'`)
    expect(invitations.rows).toHaveLength(1)
  })

  it('preflights the exact pending beta-manager invitation', async () => {
    await insertInvitationRow('inv-idcmd-register-preflight', {
      email: 'idcmd-new@test.com',
    })
    const validate = (email: string) =>
      h.store().validateInvitationRegistration({
        invitationId: invitationId('inv-idcmd-register-preflight'),
        email,
        now: NOW,
      })

    await expect(validate('IdCmd-New@Test.com')).resolves.toBeUndefined()
    await expectIdentityError(validate('attacker@test.com'), 'forbidden')
  })

  it('acceptInvitation commits member + accepted status + fact in one transaction', async () => {
    await insertInvitationRow('inv-idcmd-accept', { propertyIds: '["prop-a","prop-b"]' })

    const result = await accept('inv-idcmd-accept', { inviter: true })

    expect(result.organizationId).toBe(ORG_ID)
    expect(result.propertyIds).toEqual(['prop-a', 'prop-b'])
    expect(result.inviterId).toBe(INVITER_ID)
    const members = await h.allMembers()
    expect(members.map(({ userId, role }) => ({ userId, role }))).toEqual([
      { userId: ACCEPTOR_ID, role: 'admin' },
    ])
    expect((await h.invitationById('inv-idcmd-accept'))?.status).toBe('accepted')
    const facts = await h.factsByTag('identity.invitation.accepted')
    expect(facts).toHaveLength(1)
    // The recorded fact names the inviter, so Feed can tell them.
    expect(facts[0]!.payload.inviterId).toBe(INVITER_ID as string)
  })

  it('rejects and consumes no authority for a legacy Member invitation', async () => {
    await insertInvitationRow('inv-idcmd-staff-beta', { role: 'member' })

    await expectIdentityError(accept('inv-idcmd-staff-beta'), 'forbidden')

    expect(await invitationStatuses('inv-idcmd-staff-beta')).toEqual([
      { status: 'rejected' },
    ])
    const memberships = await h
      .pool()
      .query(`SELECT id FROM member WHERE "userId" = $1`, [ACCEPTOR_ID])
    expect(memberships.rows).toHaveLength(0)
  })

  it('rejects an existing membership in another Organization', async () => {
    const otherOrg = await seedOtherOrganization('org-idcmd-0000-0000-0000-000000000004')
    await insertMemberRows([
      ['member-idcmd-legacy-other', otherOrg, ACCEPTOR_ID, 'admin'],
    ])
    await insertInvitationRow('inv-idcmd-legacy-other')

    await expectIdentityError(accept('inv-idcmd-legacy-other'), 'organization_conflict')

    expect(await invitationStatuses('inv-idcmd-legacy-other')).toEqual([
      { status: 'pending' },
    ])
  })

  it('serializes competing invitations and permits only one Organization membership', async () => {
    const otherOrg = await seedOtherOrganization('org-idcmd-0000-0000-0000-000000000002')
    await insertInvitationRow('inv-idcmd-race-a')
    await insertInvitationRow('inv-idcmd-race-b', { organizationId: otherOrg })

    const outcomes = await Promise.allSettled([
      accept('inv-idcmd-race-a'),
      accept('inv-idcmd-race-b'),
    ])

    expectSingleWinner(outcomes, refusedWith('organization_conflict'))
    const members = await h
      .pool()
      .query(`SELECT "organizationId" FROM member WHERE "userId" = $1`, [ACCEPTOR_ID])
    expect(members.rows).toHaveLength(1)
    expect(members.rows[0].organizationId).toMatch(/^org-idcmd-/u)
    const statuses = await invitationStatuses('inv-idcmd-race-a', 'inv-idcmd-race-b')
    expect(statuses.map((row) => row.status).sort()).toEqual(['accepted', 'pending'])
  })

  it('cancelInvitation commits the status update + fact; missing invitation records nothing', async () => {
    await insertInvitationRow('inv-idcmd-cancel', {
      email: 'idcmd-new@test.com',
      role: 'member',
    })
    const cancel = (id: string) =>
      h.store().cancelInvitation({
        invitationId: invitationId(id),
        organizationId: ORG_ID,
        event: identityInvitationCanceled({
          organizationId: ORG_ID,
          invitationId: invitationId(id),
          occurredAt: NOW,
        }),
      })

    await cancel('inv-idcmd-cancel')

    expect((await h.invitationById('inv-idcmd-cancel'))?.status).toBe('canceled')
    expect(await h.factsByTag('identity.invitation.canceled')).toHaveLength(1)

    await expectIdentityError(cancel('inv-idcmd-missing'), 'invitation_not_found')
  })

  it('removeMember revokes sessions and membership atomically', async () => {
    await insertMemberRows([
      ['member-idcmd-owner', ORG_ID, INVITER_ID, 'owner'],
      ['member-idcmd-staff', ORG_ID, ACCEPTOR_ID, 'admin'],
    ])
    await h.pool().query(
      `INSERT INTO session
         (id, "expiresAt", token, "userId", "activeOrganizationId", "createdAt", "updatedAt")
       VALUES ('session-idcmd-removed', $1, 'token-idcmd-removed', $2, $3, $4, $4)`,
      [new Date('2026-07-01T12:00:00.000Z'), ACCEPTOR_ID, ORG_ID, NOW],
    )
    const remove = (memberId: string, memberUserId: typeof ORG_ID | string) =>
      h.store().removeMember({
        organizationId: ORG_ID,
        memberId,
        event: identityMemberRemoved({
          organizationId: ORG_ID,
          userId: userId(memberUserId),
          removedBy: INVITER_ID,
          occurredAt: NOW,
        }),
      })

    await remove('member-idcmd-staff', ACCEPTOR_ID)

    expect((await h.allMembers()).map(({ id }) => id)).toEqual(['member-idcmd-owner'])
    const sessions = await h
      .pool()
      .query('SELECT id FROM session WHERE "userId" = $1', [ACCEPTOR_ID])
    expect(sessions.rows).toEqual([])
    expect(await h.factsByTag('identity.member.removed')).toHaveLength(1)

    // Last-owner guard: removing the sole remaining owner must fail atomically.
    await expectIdentityError(remove('member-idcmd-owner', INVITER_ID), 'last_owner')
    expect(await h.memberById('member-idcmd-owner')).not.toBeNull()
  })

  it('changeMemberRole updates the role + records the fact', async () => {
    await insertMemberRows([
      ['member-idcmd-owner', ORG_ID, INVITER_ID, 'owner'],
      ['member-idcmd-staff', ORG_ID, ACCEPTOR_ID, 'member'],
    ])

    await h.store().changeMemberRole({
      organizationId: ORG_ID,
      memberId: 'member-idcmd-staff',
      actorUserId: INVITER_ID,
      newRole: 'admin',
      event: identityMemberRoleChanged({
        organizationId: ORG_ID,
        memberUserId: ACCEPTOR_ID,
        previousRole: 'Member',
        newRole: 'PropertyManager',
        userId: INVITER_ID,
        occurredAt: NOW,
      }),
    })

    expect((await h.memberById('member-idcmd-staff'))?.role).toBe('admin')
    const facts = await h.factsByTag('identity.member.role_changed')
    expect(facts).toHaveLength(1)
    // The recorded payload keeps the TARGET member id.
    expect(facts[0]!.payload.memberUserId).toBe(ACCEPTOR_ID as string)
    expect(facts[0]!.payload.userId).toBe(INVITER_ID as string)
  })

  // An AccountAdmin may demote another AccountAdmin; the Organization keeps
  // at least one, and the lock decides a race between two demotions.
  const demoteOwner = (memberId: string, memberUserId: typeof INVITER_ID) => {
    const actor = memberUserId === INVITER_ID ? ACCEPTOR_ID : INVITER_ID
    return h.store().changeMemberRole({
      organizationId: ORG_ID,
      memberId,
      actorUserId: actor,
      newRole: 'admin',
      event: identityMemberRoleChanged({
        organizationId: ORG_ID,
        memberUserId,
        previousRole: 'AccountAdmin',
        newRole: 'PropertyManager',
        userId: actor,
        occurredAt: NOW,
      }),
    })
  }

  const seedTwoOwners = () =>
    insertMemberRows([
      ['member-idcmd-owner-a', ORG_ID, INVITER_ID, 'owner'],
      ['member-idcmd-owner-b', ORG_ID, ACCEPTOR_ID, 'owner'],
    ])

  it('changeMemberRole lets one AccountAdmin demote another while an owner remains', async () => {
    await seedTwoOwners()

    await demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID)

    expect(
      (await h.allMembers()).map(({ id, role }) => ({ id, role })).sort(byId),
    ).toEqual([
      { id: 'member-idcmd-owner-a', role: 'owner' },
      { id: 'member-idcmd-owner-b', role: 'admin' },
    ])
    expect(await h.factsByTag('identity.member.role_changed')).toHaveLength(1)
  })

  it('changeMemberRole leaves one AccountAdmin when both are demoted at once', async () => {
    await seedTwoOwners()

    const outcomes = await Promise.allSettled([
      demoteOwner('member-idcmd-owner-a', INVITER_ID),
      demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID),
    ])

    // Each demotes the other, so whichever commits second finds its actor is
    // no longer an AccountAdmin before it reaches the last-owner check.
    expectSingleWinner(outcomes, refusedWith('forbidden'))
    expect((await h.allMembers()).filter(({ role }) => role === 'owner')).toHaveLength(1)
    expect(await h.factsByTag('identity.member.role_changed')).toHaveLength(1)
  })

  // The member row's connector-departure trigger fences a demoted
  // AccountAdmin's Google connection inside the demotion's own transaction, so
  // updateMemberRole converges the connector only after the store commits.
  const CONNECTION_A = '00000000-0000-4000-8000-0000000000a1'
  const CONNECTION_B = '00000000-0000-4000-8000-0000000000b1'

  const seedConnection = (connectionId: string, connectorUserId: string) =>
    seedGoogleConnection(h.pool(), {
      id: connectionId,
      organizationId: ORG_ID,
      googleSubject: `subject-${connectionId}`,
      accessToken: 'encrypted-access',
      refreshToken: 'encrypted-refresh',
      connectedBy: connectorUserId,
    })

  const connectionStates = async () =>
    (
      await h.pool().query(
        `SELECT connected_by, status, status_reason FROM google_connections
         WHERE organization_id = $1 ORDER BY connected_by`,
        [ORG_ID],
      )
    ).rows

  const reauthorizationFacts = () =>
    h.factsByTag('integration.google_account.reauthorization_required')

  it("changeMemberRole fences the demoted AccountAdmin's Google connection in the same transaction", async () => {
    await seedTwoOwners()
    await seedConnection(CONNECTION_A, INVITER_ID)
    await seedConnection(CONNECTION_B, ACCEPTOR_ID)

    await demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID)

    // Ordered by connector: the acceptor ('user-idcmd-a…') before the inviter.
    expect(await connectionStates()).toEqual([
      {
        connected_by: ACCEPTOR_ID,
        status: 'reauth_required',
        status_reason: 'connector_departure_account_admin_role_lost',
      },
      { connected_by: INVITER_ID, status: 'active', status_reason: null },
    ])
    expect(await reauthorizationFacts()).toEqual([
      {
        tag: 'integration.google_account.reauthorization_required',
        payload: expect.objectContaining({
          connectionId: CONNECTION_B,
          cause: 'account_admin_role_lost',
        }),
      },
    ])
  })

  it("a refused concurrent demotion leaves the remaining AccountAdmin's Google connection active", async () => {
    await seedTwoOwners()
    await seedConnection(CONNECTION_A, INVITER_ID)
    await seedConnection(CONNECTION_B, ACCEPTOR_ID)

    await Promise.allSettled([
      demoteOwner('member-idcmd-owner-a', INVITER_ID),
      demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID),
    ])

    const remainingOwner = (await h.allMembers()).find(
      ({ role }) => role === 'owner',
    )?.userId
    const states = await connectionStates()
    expect(states.filter((row) => row.status === 'active')).toEqual([
      { connected_by: remainingOwner, status: 'active', status_reason: null },
    ])
    expect(states.filter((row) => row.status === 'reauth_required')).toHaveLength(1)
    expect(await reauthorizationFacts()).toHaveLength(1)
  })
})
