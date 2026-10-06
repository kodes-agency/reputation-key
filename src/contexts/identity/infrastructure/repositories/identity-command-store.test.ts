// BQC-3.5 — identity command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real better-auth tables:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no invitation/member row survives.
//   2. Happy path: the state row and the outbox_events row commit together
//      with the same eventId.
//   3. Guards hold on the real DB: already-member/already-invited,
//      last-owner, invitation lifecycle.

import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import {
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberInvited,
  identityMemberRemoved,
  identityMemberRoleChanged,
} from '../../domain/events'
import type { IdentityMemberInvited } from '../../domain/events'
import { isIdentityError } from '../../domain/errors'
import { createAtomicIdentityCommandStore as createAtomicIdentityCommandStoreWithDeps } from '../identity-command-store'

const createAtomicIdentityCommandStore = (db: Database) =>
  createAtomicIdentityCommandStoreWithDeps(db, randomUUID)

const ORG_ID = organizationId('org-idcmd-0000-0000-0000-000000000001')
const INVITER_ID = userId('user-idcmd-inviter-00000000000001')
const ACCEPTOR_ID = userId('user-idcmd-acceptor-0000000000001')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const SLUG = 'idcmd-org-slug'

let pool: Pool
const db = getDb()

async function seedOrgAndUsers(p: Pool) {
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID, 'Identity Cmd Org', SLUG],
  )
  await p.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [INVITER_ID, 'Inviter', 'idcmd-inviter@test.com'],
  )
  await p.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ACCEPTOR_ID, 'Acceptor', 'idcmd-acceptor@test.com'],
  )
}

async function truncateAll(p: Pool) {
  // Receipts cascade from outbox_events; invitation/member cascade from org/user.
  // Triggers disabled: guard_last_owner (deployed last-owner backstop) blocks
  // deleting an org's final owner row, including fixture teardown.
  await withLastOwnerGuardDisabled(p, async (client) => {
    // First: deleting a member whose Google connection is still active fires
    // the connector-departure trigger, which records a fact.
    await client.query('DELETE FROM google_connections WHERE organization_id = $1', [
      ORG_ID,
    ])
    await client.query('DELETE FROM session WHERE "userId" IN ($1, $2)', [
      INVITER_ID,
      ACCEPTOR_ID,
    ])
    await client.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
    await client.query(
      `DELETE FROM invitation
        WHERE "organizationId" = $1
           OR "organizationId" LIKE 'org-idcmd-%'
           OR email LIKE 'idcmd-%@test.com'`,
      [ORG_ID],
    )
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG_ID])
    // Membership tests seed extra 'org-idcmd-' Organizations (member rows
    // cascade with them).
    await client.query(
      `DELETE FROM outbox_events WHERE organization_id LIKE 'org-idcmd-%'`,
    )
    const conflictingOrganizations = await client.query<{ id: string }>(
      `SELECT id FROM organization WHERE slug LIKE 'idcmd-%' AND id <> $1`,
      [ORG_ID],
    )
    await deleteTestOrganizations(
      client,
      conflictingOrganizations.rows.map(({ id }) => id),
    )
  })
}

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await deleteTestOrganizations(client, [ORG_ID])
    await client.query('DELETE FROM "user" WHERE id IN ($1, $2)', [
      INVITER_ID,
      ACCEPTOR_ID,
    ])
  })
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrgAndUsers(pool)
})

const invitedEvent = (invId: string): IdentityMemberInvited =>
  identityMemberInvited({
    organizationId: ORG_ID,
    role: 'PropertyManager',
    userId: INVITER_ID,
    invitationId: invitationId(invId),
    occurredAt: NOW,
  })

describe.sequential('identityCommandStore (integration)', () => {
  it('inviteMember commits the invitation + fact in one transaction', async () => {
    const store = createAtomicIdentityCommandStore(db)
    const event = invitedEvent('inv-idcmd-1')

    await store.inviteMember({
      invitationId: invitationId('inv-idcmd-1'),
      organizationId: ORG_ID,
      email: 'IdCmd-New@Test.com',
      role: 'admin',
      inviterId: INVITER_ID,
      propertyIds: ['prop-a'],
      now: NOW,
      expiresAt: new Date('2026-06-08T12:00:00.000Z'),
      event,
    })

    const invitations = await pool.query(
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
    const facts = await pool.query(
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
    const store = createAtomicIdentityCommandStore(db)
    const ghost = {
      ...invitedEvent('inv-idcmd-2'),
      _tag: 'identity.member.ghost',
    } as unknown as Parameters<typeof store.inviteMember>[0]['event']

    await expect(
      store.inviteMember({
        invitationId: invitationId('inv-idcmd-2'),
        organizationId: ORG_ID,
        email: 'idcmd-new@test.com',
        role: 'admin',
        inviterId: INVITER_ID,
        propertyIds: [],
        now: NOW,
        expiresAt: new Date('2026-06-08T12:00:00.000Z'),
        event: ghost,
      }),
    ).rejects.toThrow(
      /Event type identity\.member\.ghost:v1 is not registered for the outbox/,
    )

    const invitations = await pool.query(
      'SELECT id FROM invitation WHERE "organizationId" = $1',
      [ORG_ID],
    )
    expect(invitations.rows).toHaveLength(0)
  })

  it('inviteMember rejects an already-member email and a duplicate pending invite', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idcmd-1', $1, $2, 'member', NOW())`,
      [ORG_ID, ACCEPTOR_ID],
    )

    await expect(
      store.inviteMember({
        invitationId: invitationId('inv-idcmd-3'),
        organizationId: ORG_ID,
        email: 'idcmd-acceptor@test.com',
        role: 'admin',
        inviterId: INVITER_ID,
        propertyIds: [],
        now: NOW,
        expiresAt: new Date('2026-06-08T12:00:00.000Z'),
        event: invitedEvent('inv-idcmd-3'),
      }),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'already_exists')

    // No fact recorded for the rejected invite
    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('inviteMember rejects an existing membership in another Organization', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ('org-idcmd-other-membership', 'Other membership', 'idcmd-other-membership', NOW())`,
    )
    await pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ('member-idcmd-other-membership', $1, 'org-idcmd-other-membership', 'admin', NOW())`,
      [ACCEPTOR_ID],
    )

    await expect(
      store.inviteMember({
        invitationId: invitationId('inv-idcmd-membership-conflict'),
        organizationId: ORG_ID,
        email: 'idcmd-acceptor@test.com',
        role: 'admin',
        inviterId: INVITER_ID,
        propertyIds: [],
        now: NOW,
        expiresAt: new Date('2026-06-08T12:00:00.000Z'),
        event: invitedEvent('inv-idcmd-membership-conflict'),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) && error.code === 'organization_conflict',
    )

    const invitations = await pool.query(
      `SELECT id FROM invitation WHERE id = 'inv-idcmd-binding-conflict'`,
    )
    expect(invitations.rows).toHaveLength(0)
  })

  it('serializes competing cross-Organization invitations for one email', async () => {
    const store = createAtomicIdentityCommandStore(db)
    const otherOrg = organizationId('org-idcmd-0000-0000-0000-000000000003')
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Invitation Race Org', 'idcmd-invitation-race', NOW())`,
      [otherOrg],
    )
    const invite = (id: string, targetOrganizationId: typeof ORG_ID) =>
      store.inviteMember({
        invitationId: invitationId(id),
        organizationId: targetOrganizationId,
        email: 'idcmd-invite-race@test.com',
        role: 'admin',
        inviterId: INVITER_ID,
        propertyIds: [],
        now: NOW,
        expiresAt: new Date('2026-06-08T12:00:00.000Z'),
        event: identityMemberInvited({
          organizationId: targetOrganizationId,
          role: 'PropertyManager',
          userId: INVITER_ID,
          invitationId: invitationId(id),
          occurredAt: NOW,
        }),
      })

    const outcomes = await Promise.allSettled([
      invite('inv-idcmd-email-race-a', ORG_ID),
      invite('inv-idcmd-email-race-b', otherOrg),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toSatisfy(
      (outcome: PromiseSettledResult<unknown> | undefined) =>
        outcome?.status === 'rejected' &&
        isIdentityError(outcome.reason) &&
        outcome.reason.code === 'organization_conflict',
    )
    const invitations = await pool.query(
      `SELECT id FROM invitation WHERE email = 'idcmd-invite-race@test.com'`,
    )
    expect(invitations.rows).toHaveLength(1)
  })

  it('preflights the exact pending beta-manager invitation', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-idcmd-register-preflight', $1, 'idcmd-new@test.com', 'admin', 'pending', $2, $3, NOW())`,
      [ORG_ID, new Date('2027-01-01T00:00:00.000Z'), INVITER_ID],
    )

    await expect(
      store.validateInvitationRegistration({
        invitationId: invitationId('inv-idcmd-register-preflight'),
        email: 'IdCmd-New@Test.com',
        now: NOW,
      }),
    ).resolves.toBeUndefined()
    await expect(
      store.validateInvitationRegistration({
        invitationId: invitationId('inv-idcmd-register-preflight'),
        email: 'attacker@test.com',
        now: NOW,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )
  })

  it('acceptInvitation commits member + accepted status + fact in one transaction', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "propertyIds", "createdAt")
       VALUES ('inv-idcmd-accept', $1, 'idcmd-acceptor@test.com', 'admin', 'pending', $2, $3, '["prop-a","prop-b"]', NOW())`,
      [ORG_ID, new Date('2027-01-01T00:00:00.000Z'), INVITER_ID],
    )

    const result = await store.acceptInvitation({
      invitationId: invitationId('inv-idcmd-accept'),
      acceptorEmail: 'IdCmd-Acceptor@Test.com',
      acceptorUserId: ACCEPTOR_ID,
      now: NOW,
      buildEvent: (accepted) =>
        identityInvitationAccepted({
          organizationId: accepted.organizationId,
          userId: ACCEPTOR_ID,
          invitationId: invitationId('inv-idcmd-accept'),
          propertyIds: accepted.propertyIds,
          inviterId: accepted.inviterId ?? undefined,
          occurredAt: NOW,
        }),
    })

    expect(result.organizationId).toBe(ORG_ID)
    expect(result.propertyIds).toEqual(['prop-a', 'prop-b'])
    expect(result.inviterId).toBe(INVITER_ID)
    const members = await pool.query(
      'SELECT "userId", role FROM member WHERE "organizationId" = $1',
      [ORG_ID],
    )
    expect(members.rows).toEqual([{ userId: ACCEPTOR_ID, role: 'admin' }])
    const invitations = await pool.query(
      `SELECT status FROM invitation WHERE id = 'inv-idcmd-accept'`,
    )
    expect(invitations.rows[0].status).toBe('accepted')
    const facts = await pool.query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.invitation.accepted'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
    // The recorded fact names the inviter, so Feed can tell them.
    expect(facts.rows[0].payload.inviterId).toBe(INVITER_ID as string)
  })

  it('rejects and consumes no authority for a legacy Member invitation', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-idcmd-staff-beta', $1, 'idcmd-acceptor@test.com', 'member', 'pending', $2, $3, NOW())`,
      [ORG_ID, new Date('2027-01-01T00:00:00.000Z'), INVITER_ID],
    )

    await expect(
      store.acceptInvitation({
        invitationId: invitationId('inv-idcmd-staff-beta'),
        acceptorEmail: 'idcmd-acceptor@test.com',
        acceptorUserId: ACCEPTOR_ID,
        now: NOW,
        buildEvent: (accepted) =>
          identityInvitationAccepted({
            organizationId: accepted.organizationId,
            userId: ACCEPTOR_ID,
            invitationId: invitationId('inv-idcmd-staff-beta'),
            propertyIds: accepted.propertyIds,
            occurredAt: NOW,
          }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )

    const invitationState = await pool.query(
      `SELECT status FROM invitation WHERE id = 'inv-idcmd-staff-beta'`,
    )
    expect(invitationState.rows).toEqual([{ status: 'rejected' }])
    const memberships = await pool.query(`SELECT id FROM member WHERE "userId" = $1`, [
      ACCEPTOR_ID,
    ])
    expect(memberships.rows).toHaveLength(0)
  })

  it('rejects an existing membership in another Organization', async () => {
    const store = createAtomicIdentityCommandStore(db)
    const otherOrg = organizationId('org-idcmd-0000-0000-0000-000000000004')
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Legacy Membership Org', 'idcmd-legacy-membership', NOW())`,
      [otherOrg],
    )
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idcmd-legacy-other', $1, $2, 'admin', NOW())`,
      [otherOrg, ACCEPTOR_ID],
    )
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-idcmd-legacy-other', $1, 'idcmd-acceptor@test.com', 'admin', 'pending', $2, $3, NOW())`,
      [ORG_ID, new Date('2027-01-01T00:00:00.000Z'), INVITER_ID],
    )

    await expect(
      store.acceptInvitation({
        invitationId: invitationId('inv-idcmd-legacy-other'),
        acceptorEmail: 'idcmd-acceptor@test.com',
        acceptorUserId: ACCEPTOR_ID,
        now: NOW,
        buildEvent: (accepted) =>
          identityInvitationAccepted({
            organizationId: accepted.organizationId,
            userId: ACCEPTOR_ID,
            invitationId: invitationId('inv-idcmd-legacy-other'),
            propertyIds: accepted.propertyIds,
            occurredAt: NOW,
          }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) && error.code === 'organization_conflict',
    )

    const invitationState = await pool.query(
      `SELECT status FROM invitation WHERE id = 'inv-idcmd-legacy-other'`,
    )
    expect(invitationState.rows).toEqual([{ status: 'pending' }])
  })

  it('serializes competing invitations and permits only one Organization membership', async () => {
    const store = createAtomicIdentityCommandStore(db)
    const otherOrg = organizationId('org-idcmd-0000-0000-0000-000000000002')
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Other Identity Org', 'idcmd-other-org', NOW())`,
      [otherOrg],
    )
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-idcmd-race-a', $1, 'idcmd-acceptor@test.com', 'admin', 'pending', $3, $2, NOW()),
              ('inv-idcmd-race-b', $4, 'idcmd-acceptor@test.com', 'admin', 'pending', $3, $2, NOW())`,
      [ORG_ID, INVITER_ID, new Date('2027-01-01T00:00:00.000Z'), otherOrg],
    )
    const accept = (id: string) =>
      store.acceptInvitation({
        invitationId: invitationId(id),
        acceptorEmail: 'idcmd-acceptor@test.com',
        acceptorUserId: ACCEPTOR_ID,
        now: NOW,
        buildEvent: (accepted) =>
          identityInvitationAccepted({
            organizationId: accepted.organizationId,
            userId: ACCEPTOR_ID,
            invitationId: invitationId(id),
            propertyIds: accepted.propertyIds,
            occurredAt: NOW,
          }),
      })

    const outcomes = await Promise.allSettled([
      accept('inv-idcmd-race-a'),
      accept('inv-idcmd-race-b'),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected).toSatisfy(
      (outcome: PromiseSettledResult<unknown> | undefined) =>
        outcome?.status === 'rejected' &&
        isIdentityError(outcome.reason) &&
        outcome.reason.code === 'organization_conflict',
    )
    const members = await pool.query(
      `SELECT "organizationId" FROM member WHERE "userId" = $1`,
      [ACCEPTOR_ID],
    )
    expect(members.rows).toHaveLength(1)
    expect(members.rows[0].organizationId).toMatch(/^org-idcmd-/u)
    const invitations = await pool.query(
      `SELECT status FROM invitation WHERE id IN ('inv-idcmd-race-a', 'inv-idcmd-race-b') ORDER BY id`,
    )
    expect(invitations.rows.map((row) => row.status).sort()).toEqual([
      'accepted',
      'pending',
    ])
  })

  it('cancelInvitation commits the status update + fact; missing invitation records nothing', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-idcmd-cancel', $1, 'idcmd-new@test.com', 'member', 'pending', $2, $3, NOW())`,
      [ORG_ID, new Date('2027-01-01T00:00:00.000Z'), INVITER_ID],
    )

    await store.cancelInvitation({
      invitationId: invitationId('inv-idcmd-cancel'),
      organizationId: ORG_ID,
      event: identityInvitationCanceled({
        organizationId: ORG_ID,
        invitationId: invitationId('inv-idcmd-cancel'),
        occurredAt: NOW,
      }),
    })

    const invitations = await pool.query(
      `SELECT status FROM invitation WHERE id = 'inv-idcmd-cancel'`,
    )
    expect(invitations.rows[0].status).toBe('canceled')
    const facts = await pool.query(
      `SELECT event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.invitation.canceled'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)

    await expect(
      store.cancelInvitation({
        invitationId: invitationId('inv-idcmd-missing'),
        organizationId: ORG_ID,
        event: identityInvitationCanceled({
          organizationId: ORG_ID,
          invitationId: invitationId('inv-idcmd-missing'),
          occurredAt: NOW,
        }),
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
    )
  })

  it('removeMember revokes sessions and membership atomically', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idcmd-owner', $1, $2, 'owner', NOW()),
              ('member-idcmd-staff', $1, $3, 'member', NOW())`,
      [ORG_ID, INVITER_ID, ACCEPTOR_ID],
    )
    await pool.query(
      `INSERT INTO session
         (id, "expiresAt", token, "userId", "activeOrganizationId", "createdAt", "updatedAt")
       VALUES ('session-idcmd-removed', $1, 'token-idcmd-removed', $2, $3, $4, $4)`,
      [new Date('2026-07-01T12:00:00.000Z'), ACCEPTOR_ID, ORG_ID, NOW],
    )

    await store.removeMember({
      organizationId: ORG_ID,
      memberId: 'member-idcmd-staff',
      event: identityMemberRemoved({
        organizationId: ORG_ID,
        userId: ACCEPTOR_ID,
        removedBy: INVITER_ID,
        occurredAt: NOW,
      }),
    })

    const members = await pool.query(
      'SELECT id FROM member WHERE "organizationId" = $1',
      [ORG_ID],
    )
    expect(members.rows).toEqual([{ id: 'member-idcmd-owner' }])
    const sessions = await pool.query('SELECT id FROM session WHERE "userId" = $1', [
      ACCEPTOR_ID,
    ])
    expect(sessions.rows).toEqual([])
    const facts = await pool.query(
      `SELECT event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.member.removed'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)

    // Last-owner guard: removing the sole remaining owner must fail atomically.
    await expect(
      store.removeMember({
        organizationId: ORG_ID,
        memberId: 'member-idcmd-owner',
        event: identityMemberRemoved({
          organizationId: ORG_ID,
          userId: INVITER_ID,
          removedBy: INVITER_ID,
          occurredAt: NOW,
        }),
      }),
    ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'last_owner')
    const stillThere = await pool.query(
      `SELECT id FROM member WHERE id = 'member-idcmd-owner'`,
    )
    expect(stillThere.rows).toHaveLength(1)
  })

  it('changeMemberRole updates the role + records the fact', async () => {
    const store = createAtomicIdentityCommandStore(db)
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idcmd-staff', $1, $2, 'member', NOW())`,
      [ORG_ID, ACCEPTOR_ID],
    )

    await store.changeMemberRole({
      organizationId: ORG_ID,
      memberId: 'member-idcmd-staff',
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

    const members = await pool.query(
      `SELECT role FROM member WHERE id = 'member-idcmd-staff'`,
    )
    expect(members.rows[0].role).toBe('admin')
    const facts = await pool.query(
      `SELECT id, event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.member.role_changed'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
    // BQC-3.5 schema fix: the recorded payload keeps the TARGET member id.
    expect(facts.rows[0].payload.memberUserId).toBe(ACCEPTOR_ID as string)
    expect(facts.rows[0].payload.userId).toBe(INVITER_ID as string)
  })

  // D2: an AccountAdmin may demote another AccountAdmin; the Organization keeps
  // at least one, and the lock decides a race between two demotions.
  const demoteOwner = (memberId: string, memberUserId: typeof INVITER_ID) =>
    createAtomicIdentityCommandStore(db).changeMemberRole({
      organizationId: ORG_ID,
      memberId,
      newRole: 'admin',
      event: identityMemberRoleChanged({
        organizationId: ORG_ID,
        memberUserId,
        previousRole: 'AccountAdmin',
        newRole: 'PropertyManager',
        userId: memberUserId === INVITER_ID ? ACCEPTOR_ID : INVITER_ID,
        occurredAt: NOW,
      }),
    })

  const seedTwoOwners = () =>
    pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idcmd-owner-a', $1, $2, 'owner', NOW()),
              ('member-idcmd-owner-b', $1, $3, 'owner', NOW())`,
      [ORG_ID, INVITER_ID, ACCEPTOR_ID],
    )

  it('changeMemberRole lets one AccountAdmin demote another while an owner remains', async () => {
    await seedTwoOwners()

    await demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID)

    const members = await pool.query(
      `SELECT id, role FROM member WHERE "organizationId" = $1 ORDER BY id`,
      [ORG_ID],
    )
    expect(members.rows).toEqual([
      { id: 'member-idcmd-owner-a', role: 'owner' },
      { id: 'member-idcmd-owner-b', role: 'admin' },
    ])
    const facts = await pool.query(
      `SELECT payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.member.role_changed'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('changeMemberRole leaves one AccountAdmin when both are demoted at once', async () => {
    await seedTwoOwners()

    const outcomes = await Promise.allSettled([
      demoteOwner('member-idcmd-owner-a', INVITER_ID),
      demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID),
    ])

    const refused = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(
      refused.every(
        (outcome) =>
          isIdentityError(outcome.reason) && outcome.reason.code === 'last_owner',
      ),
    ).toBe(true)
    const owners = await pool.query(
      `SELECT id FROM member WHERE "organizationId" = $1 AND role = 'owner'`,
      [ORG_ID],
    )
    expect(owners.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.member.role_changed'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
  })

  // The member row's connector-departure trigger fences a demoted
  // AccountAdmin's Google connection inside the demotion's own transaction, so
  // updateMemberRole converges the connector only after the store commits.
  const CONNECTION_A = '00000000-0000-4000-8000-0000000000a1'
  const CONNECTION_B = '00000000-0000-4000-8000-0000000000b1'

  const seedGoogleConnection = (connectionId: string, connectorUserId: string) =>
    pool.query(
      `INSERT INTO google_connections (
         id, organization_id, google_subject, encrypted_access_token,
         encrypted_refresh_token, token_expires_at, scopes, connected_by
       )
       VALUES (
         $1::uuid, $2, $3, 'encrypted-access', 'encrypted-refresh',
         NOW() + interval '1 hour',
         ARRAY['https://www.googleapis.com/auth/business.manage']::text[], $4
       )`,
      [connectionId, ORG_ID, `subject-${connectionId}`, connectorUserId],
    )

  const connectionStates = async () =>
    (
      await pool.query(
        `SELECT connected_by, status, status_reason FROM google_connections
         WHERE organization_id = $1 ORDER BY connected_by`,
        [ORG_ID],
      )
    ).rows

  const reauthorizationFacts = async () =>
    (
      await pool.query(
        `SELECT payload FROM outbox_events
         WHERE organization_id = $1
           AND event_type = 'integration.google_account.reauthorization_required'`,
        [ORG_ID],
      )
    ).rows

  it("changeMemberRole fences the demoted AccountAdmin's Google connection in the same transaction", async () => {
    await seedTwoOwners()
    await seedGoogleConnection(CONNECTION_A, INVITER_ID)
    await seedGoogleConnection(CONNECTION_B, ACCEPTOR_ID)

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
        payload: expect.objectContaining({
          connectionId: CONNECTION_B,
          cause: 'account_admin_role_lost',
        }),
      },
    ])
  })

  it("a refused concurrent demotion leaves the remaining AccountAdmin's Google connection active", async () => {
    await seedTwoOwners()
    await seedGoogleConnection(CONNECTION_A, INVITER_ID)
    await seedGoogleConnection(CONNECTION_B, ACCEPTOR_ID)

    await Promise.allSettled([
      demoteOwner('member-idcmd-owner-a', INVITER_ID),
      demoteOwner('member-idcmd-owner-b', ACCEPTOR_ID),
    ])

    const owner = await pool.query<{ userId: string }>(
      `SELECT "userId" FROM member WHERE "organizationId" = $1 AND role = 'owner'`,
      [ORG_ID],
    )
    const remainingOwner = owner.rows[0]?.userId
    const states = await connectionStates()
    expect(states.filter((row) => row.status === 'active')).toEqual([
      { connected_by: remainingOwner, status: 'active', status_reason: null },
    ])
    expect(states.filter((row) => row.status === 'reauth_required')).toHaveLength(1)
    expect(await reauthorizationFacts()).toHaveLength(1)
  })
})
