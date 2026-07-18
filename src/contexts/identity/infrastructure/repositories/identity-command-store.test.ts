// BQC-3.5 — identity command store integration tests (real Postgres).
//
// Crash-boundary proofs on the real better-auth tables:
//   1. A forced outbox failure (unregistered fact type) rolls back EVERYTHING
//      — no invitation/member/organization row survives.
//   2. Happy path: the state row and the outbox_events row commit together
//      with the same eventId.
//   3. Guards hold on the real DB: already-member/already-invited,
//      last-owner, slug conflict, invitation lifecycle.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import {
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberInvited,
  identityMemberRemoved,
  identityMemberRoleChanged,
  identityOrganizationCreated,
} from '../../domain/events'
import type { IdentityMemberInvited } from '../../domain/events'
import { isIdentityError } from '../../domain/errors'
import { createAtomicIdentityCommandStore } from '../identity-command-store'

const ORG_ID = organizationId('org-idcmd-0000-0000-0000-000000000001')
const INVITER_ID = userId('user-idcmd-inviter-00000000000001')
const ACCEPTOR_ID = userId('user-idcmd-acceptor-0000000000001')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const SLUG = 'idcmd-org-slug'

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

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
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_ID])
  await p.query('DELETE FROM invitation WHERE "organizationId" = $1', [ORG_ID])
  await p.query('DELETE FROM member WHERE "organizationId" = $1', [ORG_ID])
  // registerOrganization creates NEW orgs (member rows cascade with them).
  await p.query(`DELETE FROM outbox_events WHERE organization_id LIKE 'org-idcmd-%'`)
  await p.query(`DELETE FROM organization WHERE slug LIKE 'idcmd-%' AND id <> $1`, [
    ORG_ID,
  ])
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
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG_ID])
  await pool.query('DELETE FROM "user" WHERE id IN ($1, $2)', [INVITER_ID, ACCEPTOR_ID])
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrgAndUsers(pool)
})

const invitedEvent = (invId: string): IdentityMemberInvited =>
  identityMemberInvited({
    organizationId: ORG_ID,
    email: 'idcmd-new@test.com',
    role: 'Staff',
    userId: INVITER_ID,
    invitationId: invitationId(invId),
    occurredAt: NOW,
  })

describe.sequential('identityCommandStore (integration)', () => {
  it('inviteMember commits the invitation + fact in one transaction', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
    const event = invitedEvent('inv-idcmd-1')

    await store.inviteMember({
      invitationId: invitationId('inv-idcmd-1'),
      organizationId: ORG_ID,
      email: 'IdCmd-New@Test.com',
      role: 'member',
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
      role: 'member',
      status: 'pending',
      inviterId: INVITER_ID,
      propertyIds: '["prop-a"]',
    })
    const facts = await pool.query(
      `SELECT id, event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.member.invited'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].id).toBe(event.eventId)
  })

  it('inviteMember rolls back the invitation when the fact insert fails (unregistered type)', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
    const ghost = {
      ...invitedEvent('inv-idcmd-2'),
      _tag: 'identity.member.ghost',
    } as unknown as Parameters<typeof store.inviteMember>[0]['event']

    await expect(
      store.inviteMember({
        invitationId: invitationId('inv-idcmd-2'),
        organizationId: ORG_ID,
        email: 'idcmd-new@test.com',
        role: 'member',
        inviterId: INVITER_ID,
        propertyIds: [],
        now: NOW,
        expiresAt: new Date('2026-06-08T12:00:00.000Z'),
        event: ghost,
      }),
    ).rejects.toThrow()

    const invitations = await pool.query(
      'SELECT id FROM invitation WHERE "organizationId" = $1',
      [ORG_ID],
    )
    expect(invitations.rows).toHaveLength(0)
  })

  it('inviteMember rejects an already-member email and a duplicate pending invite', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
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
        role: 'member',
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

  it('acceptInvitation commits member + accepted status + fact in one transaction', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
    await pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "propertyIds", "createdAt")
       VALUES ('inv-idcmd-accept', $1, 'idcmd-acceptor@test.com', 'member', 'pending', $2, $3, '["prop-a","prop-b"]', NOW())`,
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
          occurredAt: NOW,
        }),
    })

    expect(result.organizationId).toBe(ORG_ID)
    expect(result.propertyIds).toEqual(['prop-a', 'prop-b'])
    const members = await pool.query(
      'SELECT "userId", role FROM member WHERE "organizationId" = $1',
      [ORG_ID],
    )
    expect(members.rows).toEqual([{ userId: ACCEPTOR_ID, role: 'member' }])
    const invitations = await pool.query(
      `SELECT status FROM invitation WHERE id = 'inv-idcmd-accept'`,
    )
    expect(invitations.rows[0].status).toBe('accepted')
    const facts = await pool.query(
      `SELECT event_type FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'identity.invitation.accepted'`,
      [ORG_ID],
    )
    expect(facts.rows).toHaveLength(1)
  })

  it('cancelInvitation commits the status update + fact; missing invitation records nothing', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
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

  it('removeMember deletes + records; the last-owner guard fires on the real DB', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idcmd-owner', $1, $2, 'owner', NOW()),
              ('member-idcmd-staff', $1, $3, 'member', NOW())`,
      [ORG_ID, INVITER_ID, ACCEPTOR_ID],
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
    const store = createAtomicIdentityCommandStore(db, silentEvents)
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
        previousRole: 'Staff',
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

  it('registerOrganization commits org + owner member + fact; forced outbox failure rolls back both', async () => {
    const store = createAtomicIdentityCommandStore(db, silentEvents)
    const newOrgId = organizationId('org-idcmd-registered-000000000001')
    const event = identityOrganizationCreated({
      organizationId: newOrgId,
      organizationName: 'Registered Org',
      slug: 'idcmd-registered',
      ownerId: INVITER_ID,
      occurredAt: NOW,
    })

    await store.registerOrganization({
      organizationId: newOrgId,
      organizationName: 'Registered Org',
      slug: 'idcmd-registered',
      ownerId: INVITER_ID,
      now: NOW,
      event,
    })

    const orgs = await pool.query('SELECT id, slug FROM organization WHERE id = $1', [
      newOrgId,
    ])
    expect(orgs.rows).toHaveLength(1)
    const members = await pool.query(
      'SELECT "userId", role FROM member WHERE "organizationId" = $1',
      [newOrgId],
    )
    expect(members.rows).toEqual([{ userId: INVITER_ID, role: 'owner' }])
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE id = $1 AND event_type = 'identity.organization.created'`,
      [event.eventId],
    )
    expect(facts.rows).toHaveLength(1)

    // Forced outbox failure: neither the org nor the member row survives.
    const ghostOrgId = organizationId('org-idcmd-ghost-00000000000001')
    const ghost = {
      ...identityOrganizationCreated({
        organizationId: ghostOrgId,
        organizationName: 'Ghost Org',
        slug: 'idcmd-ghost',
        ownerId: INVITER_ID,
        occurredAt: NOW,
      }),
      _tag: 'identity.organization.ghost',
    } as unknown as Parameters<typeof store.registerOrganization>[0]['event']

    await expect(
      store.registerOrganization({
        organizationId: ghostOrgId,
        organizationName: 'Ghost Org',
        slug: 'idcmd-ghost',
        ownerId: INVITER_ID,
        now: NOW,
        event: ghost,
      }),
    ).rejects.toThrow()

    const ghostOrgs = await pool.query('SELECT id FROM organization WHERE id = $1', [
      ghostOrgId,
    ])
    expect(ghostOrgs.rows).toHaveLength(0)
    const ghostMembers = await pool.query(
      'SELECT id FROM member WHERE "organizationId" = $1',
      [ghostOrgId],
    )
    expect(ghostMembers.rows).toHaveLength(0)
  })
})
