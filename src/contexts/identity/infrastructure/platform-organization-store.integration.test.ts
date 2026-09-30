// The platform operator console on the real better-auth tables (Postgres):
//   - provisioning commits the Organization, its first AccountAdmin
//     invitation and that invitation's fact in one transaction, without
//     making the operator a member; a refused invitation creates nothing;
//   - a slug is taken once, also under concurrency;
//   - the list and administration reads count members, AccountAdmins and
//     open invitations;
//   - the first-admin round trip ends with exactly one AccountAdmin, after
//     which the console refuses to act; cancel and resend (of a lapsed row)
//     stay inside the Organization;
//   - every change commits one audit_logs row naming the Organization, the
//     operator and the action; a refused change writes none.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import {
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberInvited,
} from '../domain/events'
import type { InvitationEmail } from '../application/ports/invitation-email.port'
import type { ProvisionOrganizationCommand } from '../application/ports/platform-organization-store.port'
import { buildPlatformConsole } from '../build-platform'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { createPlatformOrganizationStore } from './platform-organization-store'

// Far in the future so these Organizations are the newest in a shared database.
const NOW = new Date('2100-01-01T12:00:00.000Z')
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const HOME_ORG = organizationId('org-plat-home-000000000000000001')
const OPERATOR = { userId: userId('user-plat-operator-00000000001'), name: 'Operator' }
const HOME_MEMBER_EMAIL = 'plat-home-member@test.com'

let pool: Pool
const db = getDb()
const store = createPlatformOrganizationStore(db, randomUUID)
const commandStore = createAtomicIdentityCommandStore(db, randomUUID)

let sequence = 0
const nextId = (kind: 'org' | 'inv'): string => {
  sequence += 1
  return `${kind}-plat-${String(sequence).padStart(6, '0')}-${randomUUID().slice(0, 8)}`
}

function provisionCommand(
  input: Readonly<{ slug: string; email: string; now?: Date }>,
): ProvisionOrganizationCommand {
  const orgId = organizationId(nextId('org'))
  const invId = invitationId(nextId('inv'))
  const now = input.now ?? NOW
  return {
    organizationId: orgId,
    name: `Platform ${input.slug}`,
    slug: input.slug,
    now,
    firstAdmin: {
      invitationId: invId,
      organizationId: orgId,
      email: input.email,
      role: 'owner',
      inviterId: OPERATOR.userId,
      propertyIds: [],
      now,
      expiresAt: new Date(now.getTime() + WEEK_MS),
      event: identityMemberInvited({
        organizationId: orgId,
        role: 'AccountAdmin',
        userId: OPERATOR.userId,
        invitationId: invId,
        occurredAt: now,
      }),
    },
  }
}

async function one<T extends Record<string, unknown>>(
  text: string,
  values: unknown[],
): Promise<T | null> {
  const result = await pool.query<T>(text, values)
  return result.rows[0] ?? null
}

async function count(text: string, values: unknown[]): Promise<number> {
  const row = await one<{ n: number }>(text, values)
  return row?.n ?? 0
}

type AuditRow = Readonly<{
  user_id: string
  action: string
  resource_type: string
  resource_id: string | null
  details: unknown
}>

/** The audit rows for one Organization, by action (the fixed clock ties their times). */
async function auditRows(orgId: string): Promise<ReadonlyArray<AuditRow>> {
  const result = await pool.query<AuditRow>(
    `SELECT user_id, action, resource_type, resource_id, details
       FROM audit_logs WHERE organization_id = $1 ORDER BY action, resource_id`,
    [orgId],
  )
  return result.rows
}

async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Platform Home', 'plat-home', $2) ON CONFLICT (id) DO NOTHING`,
    [HOME_ORG, NOW],
  )
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Operator', 'plat-operator@test.com', true, NOW(), NOW()),
            ('user-plat-home-member-000000001', 'Home Member', $2, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [OPERATOR.userId, HOME_MEMBER_EMAIL],
  )
  await pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ('mem-plat-operator', $1, $2, 'owner', NOW()),
            ('mem-plat-home-member', $1, 'user-plat-home-member-000000001', 'admin', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [HOME_ORG, OPERATOR.userId],
  )
}

async function cleanup(): Promise<void> {
  const orgs = await pool.query<{ id: string }>(
    `SELECT id FROM organization WHERE id LIKE 'org-plat-%'`,
  )
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query(
      `DELETE FROM outbox_events WHERE organization_id LIKE 'org-plat-%'`,
    )
    await client.query(`DELETE FROM audit_logs WHERE organization_id LIKE 'org-plat-%'`)
    await client.query(
      `DELETE FROM invitation
        WHERE "organizationId" LIKE 'org-plat-%' OR email LIKE 'plat-%@test.com'`,
    )
    await client.query(`DELETE FROM member WHERE "organizationId" LIKE 'org-plat-%'`)
    await deleteTestOrganizations(
      client,
      orgs.rows.map((row) => row.id),
    )
    await client.query(`DELETE FROM "user" WHERE id LIKE 'user-plat-%'`)
  })
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 3 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await cleanup()
  await pool.end()
})

beforeEach(async () => {
  await cleanup()
  await seed()
})

describe.sequential('provisionOrganization', () => {
  it('commits the Organization and its first AccountAdmin invitation, operator outside', async () => {
    const command = provisionCommand({
      slug: 'plat-riviera',
      email: 'plat-first-admin@test.com',
    })

    await store.provisionOrganization(command)

    const org = await one<{ name: string; slug: string }>(
      `SELECT name, slug FROM organization WHERE id = $1`,
      [command.organizationId],
    )
    expect(org).toEqual({ name: 'Platform plat-riviera', slug: 'plat-riviera' })
    const lifecycle = await one<{
      state: string
      last_reason_code: string
      last_support_evidence_ref: string
    }>(
      `SELECT state, last_reason_code, last_support_evidence_ref
         FROM organization_lifecycle_authority WHERE organization_id = $1`,
      [command.organizationId],
    )
    expect(lifecycle).toEqual({
      state: 'active',
      last_reason_code: 'provisioned',
      last_support_evidence_ref: 'organization:create',
    })
    expect(
      await count(`SELECT count(*)::int AS n FROM member WHERE "organizationId" = $1`, [
        command.organizationId,
      ]),
    ).toBe(0)
    const invitation = await one<{
      email: string
      role: string
      status: string
      inviterId: string
      propertyIds: string | null
    }>(
      `SELECT email, role, status, "inviterId", "propertyIds" FROM invitation WHERE id = $1`,
      [command.firstAdmin.invitationId],
    )
    expect(invitation).toEqual({
      email: 'plat-first-admin@test.com',
      role: 'owner',
      status: 'pending',
      inviterId: OPERATOR.userId,
      propertyIds: null,
    })
    // The durable fact is content-minimal (v2): it names the invitation and
    // role; the operator is on record as the invitation's inviterId.
    const fact = await one<{ event_type: string; invitation_id: string; role: string }>(
      `SELECT event_type, payload->>'invitationId' AS invitation_id, payload->>'role' AS role
         FROM outbox_events WHERE organization_id = $1`,
      [command.organizationId],
    )
    expect(fact).toEqual({
      event_type: 'identity.member.invited',
      invitation_id: command.firstAdmin.invitationId,
      role: 'AccountAdmin',
    })
    // Who made the change: the audit row, committed with it.
    expect(await auditRows(command.organizationId)).toEqual([
      {
        user_id: OPERATOR.userId,
        action: 'platform.organization_provisioned',
        resource_type: 'organization',
        resource_id: command.organizationId,
        details: { invitationId: command.firstAdmin.invitationId },
      },
    ])
  })

  it('refuses a slug another Organization uses and writes nothing for the attempt', async () => {
    await store.provisionOrganization(
      provisionCommand({ slug: 'plat-taken', email: 'plat-a@test.com' }),
    )
    const second = provisionCommand({ slug: 'plat-taken', email: 'plat-b@test.com' })

    await expect(store.provisionOrganization(second)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'already_exists',
    })
    expect(
      await count(`SELECT count(*)::int AS n FROM organization WHERE id = $1`, [
        second.organizationId,
      ]),
    ).toBe(0)
    expect(
      await count(`SELECT count(*)::int AS n FROM invitation WHERE email = $1`, [
        'plat-b@test.com',
      ]),
    ).toBe(0)
  })

  it('lets exactly one of two concurrent provisions take a slug', async () => {
    const results = await Promise.allSettled([
      store.provisionOrganization(
        provisionCommand({ slug: 'plat-race', email: 'plat-race-a@test.com' }),
      ),
      store.provisionOrganization(
        provisionCommand({ slug: 'plat-race', email: 'plat-race-b@test.com' }),
      ),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((result) => result.status === 'rejected')
    expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
      code: 'already_exists',
    })
    expect(
      await count(
        `SELECT count(*)::int AS n FROM organization WHERE slug = 'plat-race'`,
        [],
      ),
    ).toBe(1)
  })

  it.each([
    ['belongs to another Organization', HOME_MEMBER_EMAIL],
    ['holds a live invitation from another Organization', 'plat-invited-home@test.com'],
  ])('creates nothing when the first admin address %s', async (_label, email) => {
    await pool.query(
      `INSERT INTO invitation
           (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
         VALUES ('inv-plat-home-live', $1, 'plat-invited-home@test.com', 'admin', 'pending', $2, $3, NOW())`,
      [HOME_ORG, new Date(NOW.getTime() + WEEK_MS), OPERATOR.userId],
    )
    const command = provisionCommand({ slug: 'plat-refused', email })

    await expect(store.provisionOrganization(command)).rejects.toMatchObject({
      _tag: 'IdentityError',
      code: 'organization_conflict',
    })
    expect(
      await count(`SELECT count(*)::int AS n FROM organization WHERE id = $1`, [
        command.organizationId,
      ]),
    ).toBe(0)
    expect(
      await count(
        `SELECT count(*)::int AS n FROM organization_lifecycle_authority WHERE organization_id = $1`,
        [command.organizationId],
      ),
    ).toBe(0)
    expect(
      await count(
        `SELECT count(*)::int AS n FROM outbox_events WHERE organization_id = $1`,
        [command.organizationId],
      ),
    ).toBe(0)
    expect(await auditRows(command.organizationId)).toEqual([])
  })
})

describe.sequential('listOrganizations and readAdministration', () => {
  it('counts members, AccountAdmins and open invitations; lists a memberless Organization', async () => {
    const command = provisionCommand({
      slug: 'plat-count',
      email: 'plat-owner-1@test.com',
    })
    await store.provisionOrganization(command)
    const orgId = command.organizationId
    const lapsed = new Date(NOW.getTime() - 60_000)
    await pool.query(
      `INSERT INTO invitation
         (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-plat-owner-lapsed', $1, 'plat-owner-2@test.com', 'owner', 'pending', $2, $3, $4),
              ('inv-plat-owner-marked', $1, 'plat-owner-3@test.com', 'owner', 'expired', $5, $3, $4),
              ('inv-plat-manager', $1, 'plat-manager@test.com', 'admin', 'pending', $5, $3, $4),
              ('inv-plat-owner-done', $1, 'plat-owner-4@test.com', 'owner', 'canceled', $5, $3, $4)`,
      [orgId, lapsed, OPERATOR.userId, NOW, new Date(NOW.getTime() + WEEK_MS)],
    )

    const rows = await store.listOrganizations({ limit: 200, now: NOW })
    const provisioned = rows.find((row) => row.id === orgId)
    const home = rows.find((row) => row.id === HOME_ORG)

    expect(provisioned).toMatchObject({
      name: 'Platform plat-count',
      slug: 'plat-count',
      lifecycleState: 'active',
      memberCount: 0,
      accountAdminCount: 0,
      pendingInvitationCount: 2,
    })
    expect(
      provisioned?.adminInvitations.map((invitation) => invitation.id).sort(),
    ).toEqual(
      [
        command.firstAdmin.invitationId,
        'inv-plat-owner-lapsed',
        'inv-plat-owner-marked',
      ].sort(),
    )
    expect(home).toMatchObject({
      memberCount: 2,
      accountAdminCount: 1,
      pendingInvitationCount: 0,
    })

    const administration = await store.readAdministration(orgId)
    expect(administration).toMatchObject({
      organizationId: orgId,
      name: 'Platform plat-count',
      lifecycleState: 'active',
      accountAdminCount: 0,
    })
    expect([...(administration?.openAdminInvitationIds ?? [])].sort()).toEqual(
      [
        command.firstAdmin.invitationId,
        'inv-plat-owner-lapsed',
        'inv-plat-owner-marked',
      ].sort(),
    )
    expect(await store.readAdministration(HOME_ORG)).toMatchObject({
      accountAdminCount: 1,
    })
    expect(await store.readAdministration(organizationId('org-plat-missing'))).toBeNull()
  })

  it('lists newest first within the limit', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    await store.provisionOrganization(
      provisionCommand({
        slug: 'plat-older',
        email: 'plat-older@test.com',
        now: new Date(NOW.getTime() - DAY_MS),
      }),
    )
    const newer = provisionCommand({
      slug: 'plat-newer',
      email: 'plat-newer@test.com',
      now: new Date(NOW.getTime() + DAY_MS),
    })
    await store.provisionOrganization(newer)

    const rows = await store.listOrganizations({ limit: 1, now: NOW })

    expect(rows.map((row) => row.id)).toEqual([newer.organizationId])
  })
})

describe.sequential('the platform console end to end', () => {
  const sent: InvitationEmail[] = []
  let ids = 0
  const platform = buildPlatformConsole({
    db,
    clock: () => NOW,
    // Every generated id carries the cleanup prefix, whatever it names.
    idGen: () => {
      ids += 1
      return `org-plat-console-${String(ids).padStart(4, '0')}-${randomUUID().slice(0, 8)}`
    },
    logger: createMockLogger(),
    sendEmail: async (email) => {
      sent.push(email)
    },
    baseUrl: 'https://app.example.test',
    invitationExpiresInMs: WEEK_MS,
    isControlledBetaEnabled: () => true,
  })

  beforeEach(() => {
    sent.length = 0
  })

  it('ends the first-admin round trip with exactly one AccountAdmin, then stops acting', async () => {
    const provisioned = await platform.provisionOrganization(
      {
        name: 'Platform Round Trip',
        slug: 'plat-round-trip',
        adminEmail: 'plat-invitee@test.com',
      },
      OPERATOR,
    )
    expect(provisioned.emailSent).toBe(true)
    expect(sent[0]).toMatchObject({
      email: 'plat-invitee@test.com',
      organizationName: 'Platform Round Trip',
      role: 'AccountAdmin',
    })
    const orgId = organizationId(provisioned.organizationId)

    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ('user-plat-invitee-00000000001', 'Invitee', 'plat-invitee@test.com', false, NOW(), NOW())`,
    )
    await commandStore.acceptInvitation({
      invitationId: invitationId(provisioned.invitationId),
      acceptorEmail: 'plat-invitee@test.com',
      acceptorUserId: userId('user-plat-invitee-00000000001'),
      now: NOW,
      markEmailVerified: true,
      buildEvent: (accepted) =>
        identityInvitationAccepted({
          organizationId: accepted.organizationId,
          userId: userId('user-plat-invitee-00000000001'),
          invitationId: invitationId(provisioned.invitationId),
          propertyIds: accepted.propertyIds,
          occurredAt: NOW,
        }),
    })

    const members = await pool.query<{ userId: string; role: string }>(
      `SELECT "userId", role FROM member WHERE "organizationId" = $1`,
      [orgId],
    )
    expect(members.rows).toEqual([
      { userId: 'user-plat-invitee-00000000001', role: 'owner' },
    ])
    expect(await store.readAdministration(orgId)).toMatchObject({ accountAdminCount: 1 })
    await expect(
      platform.inviteAdmin(
        { organizationId: orgId, email: 'plat-second@test.com' },
        OPERATOR,
      ),
    ).rejects.toMatchObject({ _tag: 'IdentityError', code: 'forbidden' })
    const view = (await platform.listOrganizations()).find((row) => row.id === orgId)
    expect(view).toMatchObject({ accountAdminCount: 1, pendingAdminInvitations: [] })
  })

  it('cancels an admin invitation with its fact, and never one of another Organization', async () => {
    const provisioned = await platform.provisionOrganization(
      { name: 'Platform Cancel', adminEmail: 'plat-cancel@test.com' },
      OPERATOR,
    )
    await pool.query(
      `INSERT INTO invitation
         (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ('inv-plat-home-owner', $1, 'plat-home-owner@test.com', 'owner', 'pending', $2, $3, NOW())`,
      [HOME_ORG, new Date(NOW.getTime() + WEEK_MS), OPERATOR.userId],
    )

    await expect(
      platform.cancelInvitation(
        {
          organizationId: provisioned.organizationId,
          invitationId: 'inv-plat-home-owner',
        },
        OPERATOR,
      ),
    ).rejects.toMatchObject({ code: 'invitation_not_found' })
    await platform.cancelInvitation(
      {
        organizationId: provisioned.organizationId,
        invitationId: provisioned.invitationId,
      },
      OPERATOR,
    )

    expect(
      await one(`SELECT status FROM invitation WHERE id = $1`, [
        provisioned.invitationId,
      ]),
    ).toEqual({ status: 'canceled' })
    expect(
      await one(`SELECT status FROM invitation WHERE id = 'inv-plat-home-owner'`, []),
    ).toEqual({ status: 'pending' })
    expect(
      await count(
        `SELECT count(*)::int AS n FROM outbox_events
          WHERE organization_id = $1 AND event_type = 'identity.invitation.canceled'`,
        [provisioned.organizationId],
      ),
    ).toBe(1)
  })

  it('resends a lapsed admin invitation as the same row with a fresh expiry', async () => {
    const provisioned = await platform.provisionOrganization(
      { name: 'Platform Resend', adminEmail: 'plat-resend@test.com' },
      OPERATOR,
    )
    await pool.query(`UPDATE invitation SET "expiresAt" = $2 WHERE id = $1`, [
      provisioned.invitationId,
      new Date(NOW.getTime() - 60_000),
    ])
    sent.length = 0

    const resent = await platform.resendInvitation(
      {
        organizationId: provisioned.organizationId,
        invitationId: provisioned.invitationId,
      },
      OPERATOR,
    )

    expect(resent).toEqual({
      expiresAt: new Date(NOW.getTime() + WEEK_MS).toISOString(),
      emailSent: true,
    })
    expect(
      await one<{ status: string; expiresAt: Date }>(
        `SELECT status, "expiresAt" FROM invitation WHERE id = $1`,
        [provisioned.invitationId],
      ),
    ).toEqual({ status: 'pending', expiresAt: new Date(NOW.getTime() + WEEK_MS) })
    expect(sent).toEqual([
      expect.objectContaining({
        email: 'plat-resend@test.com',
        inviteLink: `https://app.example.test/accept-invitation?id=${provisioned.invitationId}`,
      }),
    ])
  })

  it('audits every change to the operator and the Organization, and nothing it refuses', async () => {
    const provisioned = await platform.provisionOrganization(
      { name: 'Platform Audit', adminEmail: 'plat-audit-first@test.com' },
      OPERATOR,
    )
    const orgId = provisioned.organizationId
    const second = await platform.inviteAdmin(
      { organizationId: orgId, email: 'plat-audit-second@test.com' },
      OPERATOR,
    )
    await platform.resendInvitation(
      { organizationId: orgId, invitationId: provisioned.invitationId },
      OPERATOR,
    )
    await platform.cancelInvitation(
      { organizationId: orgId, invitationId: second.invitationId },
      OPERATOR,
    )
    // A change the command refuses writes no audit row: the second invitation
    // is canceled now, so it cannot be canceled again.
    await expect(
      store.cancelAdminInvitation(
        {
          invitationId: invitationId(second.invitationId),
          organizationId: organizationId(orgId),
          event: identityInvitationCanceled({
            organizationId: organizationId(orgId),
            invitationId: invitationId(second.invitationId),
            occurredAt: NOW,
          }),
        },
        OPERATOR.userId,
      ),
    ).rejects.toMatchObject({ code: 'invitation_not_found' })

    const rows = await auditRows(orgId)
    expect(rows.map(({ details: _details, ...row }) => row)).toEqual([
      {
        user_id: OPERATOR.userId,
        action: 'platform.admin_invitation_canceled',
        resource_type: 'invitation',
        resource_id: second.invitationId,
      },
      {
        user_id: OPERATOR.userId,
        action: 'platform.admin_invitation_resent',
        resource_type: 'invitation',
        resource_id: provisioned.invitationId,
      },
      {
        user_id: OPERATOR.userId,
        action: 'platform.admin_invited',
        resource_type: 'invitation',
        resource_id: second.invitationId,
      },
      {
        user_id: OPERATOR.userId,
        action: 'platform.organization_provisioned',
        resource_type: 'organization',
        resource_id: orgId,
      },
    ])
    // Content-free: ids and actions, never an invitee address.
    expect(JSON.stringify(rows)).not.toContain('@')
  })
})
