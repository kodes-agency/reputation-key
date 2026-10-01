// Invitation lifecycle on the real better-auth tables (Postgres):
//   - acceptance can mark the acceptor's email verified, atomically;
//   - a lapsed invitation reads as expired, blocks a same-Organization
//     re-invite with Resend advice, and yields to another Organization;
//   - Resend renews the same row;
//   - only an open invitation can be canceled.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  invitationId,
  organizationId,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import {
  identityInvitationAccepted,
  identityInvitationCanceled,
  identityMemberInvited,
} from '../domain/events'
import { isIdentityError, type IdentityErrorCode } from '../domain/errors'
import { createAtomicIdentityCommandStore } from './identity-command-store'

const ORG_ID = organizationId('org-idlife-0000-0000-0000-000000000001')
const OTHER_ORG_ID = organizationId('org-idlife-0000-0000-0000-000000000002')
const INVITER_ID = userId('user-idlife-inviter-000000000001')
const ACCEPTOR_ID = userId('user-idlife-acceptor-00000000001')
const ACCEPTOR_EMAIL = 'idlife-acceptor@test.com'
const NOW = new Date('2026-06-01T12:00:00.000Z')
const LIVE_EXPIRY = new Date('2026-06-08T12:00:00.000Z')
const LAPSED_EXPIRY = new Date('2026-05-30T12:00:00.000Z')
const RENEWED_EXPIRY = new Date('2026-06-08T12:00:00.000Z')

let pool: Pool
const db = getDb()
const store = createAtomicIdentityCommandStore(db, randomUUID)

const hasCode =
  (code: IdentityErrorCode, message?: RegExp) =>
  (error: unknown): boolean =>
    isIdentityError(error) &&
    error.code === code &&
    (message === undefined || message.test(error.message))

async function seed(p: Pool): Promise<void> {
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Lifecycle Org', 'idlife-org', NOW()),
            ($2, 'Other Lifecycle Org', 'idlife-other-org', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID, OTHER_ORG_ID],
  )
  await p.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Inviter', 'idlife-inviter@test.com', true, NOW(), NOW()),
            ($2, 'Acceptor', $3, false, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET "emailVerified" = EXCLUDED."emailVerified"`,
    [INVITER_ID, ACCEPTOR_ID, ACCEPTOR_EMAIL],
  )
}

async function cleanup(p: Pool): Promise<void> {
  await withLastOwnerGuardDisabled(p, async (client) => {
    await client.query(
      `DELETE FROM outbox_events WHERE organization_id LIKE 'org-idlife-%'`,
    )
    await client.query(
      `DELETE FROM invitation
        WHERE "organizationId" LIKE 'org-idlife-%' OR email LIKE 'idlife-%@test.com'`,
    )
    await client.query(`DELETE FROM member WHERE "organizationId" LIKE 'org-idlife-%'`)
  })
}

async function insertInvitation(
  row: Readonly<{
    id: string
    organizationId?: OrganizationId
    email?: string
    role?: string
    status?: string
    expiresAt?: Date
    propertyIds?: string | null
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO invitation
       (id, "organizationId", email, role, status, "expiresAt", "inviterId", "propertyIds", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      row.id,
      row.organizationId ?? ORG_ID,
      row.email ?? ACCEPTOR_EMAIL,
      row.role ?? 'admin',
      row.status ?? 'pending',
      row.expiresAt ?? LIVE_EXPIRY,
      INVITER_ID,
      row.propertyIds ?? null,
    ],
  )
}

async function invitationRow(id: string) {
  const rows = await pool.query<{ status: string; expiresAt: Date }>(
    `SELECT status, "expiresAt" FROM invitation WHERE id = $1`,
    [id],
  )
  return rows.rows[0] ?? null
}

async function acceptorVerified(): Promise<boolean> {
  const rows = await pool.query<{ emailVerified: boolean }>(
    `SELECT "emailVerified" FROM "user" WHERE id = $1`,
    [ACCEPTOR_ID],
  )
  return rows.rows[0]?.emailVerified ?? false
}

const accept = (
  id: string,
  options: Readonly<{
    acceptorUserId?: UserId
    acceptorEmail?: string
    markEmailVerified?: boolean
    storeOverride?: ReturnType<typeof createAtomicIdentityCommandStore>
  }> = {},
) =>
  (options.storeOverride ?? store).acceptInvitation({
    invitationId: invitationId(id),
    acceptorEmail: options.acceptorEmail ?? ACCEPTOR_EMAIL,
    acceptorUserId: options.acceptorUserId ?? ACCEPTOR_ID,
    now: NOW,
    markEmailVerified: options.markEmailVerified,
    buildEvent: (accepted) =>
      identityInvitationAccepted({
        organizationId: accepted.organizationId,
        userId: options.acceptorUserId ?? ACCEPTOR_ID,
        invitationId: invitationId(id),
        propertyIds: accepted.propertyIds,
        occurredAt: NOW,
      }),
  })

const invite = (id: string, targetOrganizationId: OrganizationId = ORG_ID) =>
  store.inviteMember({
    invitationId: invitationId(id),
    organizationId: targetOrganizationId,
    email: ACCEPTOR_EMAIL,
    role: 'admin',
    inviterId: INVITER_ID,
    propertyIds: [],
    now: NOW,
    expiresAt: LIVE_EXPIRY,
    event: identityMemberInvited({
      organizationId: targetOrganizationId,
      role: 'PropertyManager',
      userId: INVITER_ID,
      invitationId: invitationId(id),
      occurredAt: NOW,
    }),
  })

const renew = (id: string, targetOrganizationId: OrganizationId = ORG_ID) =>
  store.renewInvitation({
    invitationId: invitationId(id),
    organizationId: targetOrganizationId,
    now: NOW,
    expiresAt: RENEWED_EXPIRY,
  })

const cancel = (id: string) =>
  store.cancelInvitation({
    invitationId: invitationId(id),
    organizationId: ORG_ID,
    event: identityInvitationCanceled({
      organizationId: ORG_ID,
      invitationId: invitationId(id),
      occurredAt: NOW,
    }),
  })

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await cleanup(pool)
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await deleteTestOrganizations(client, [ORG_ID, OTHER_ORG_ID])
    await client.query('DELETE FROM "user" WHERE id IN ($1, $2)', [
      INVITER_ID,
      ACCEPTOR_ID,
    ])
  })
  await pool.end()
})

beforeEach(async () => {
  await cleanup(pool)
  await seed(pool)
})

describe.sequential('acceptInvitation (lifecycle)', () => {
  it('marks the acceptor verified in the acceptance transaction and names the inviter', async () => {
    await insertInvitation({ id: 'inv-idlife-verify', propertyIds: '["prop-a"]' })

    const accepted = await accept('inv-idlife-verify', { markEmailVerified: true })

    expect(accepted).toEqual({
      organizationId: ORG_ID,
      propertyIds: ['prop-a'],
      inviterId: INVITER_ID,
    })
    expect(await acceptorVerified()).toBe(true)
    expect(await invitationRow('inv-idlife-verify')).toMatchObject({
      status: 'accepted',
    })
  })

  it('leaves the address unverified on the signed-in path', async () => {
    await insertInvitation({ id: 'inv-idlife-signed-in' })

    await accept('inv-idlife-signed-in')

    expect(await acceptorVerified()).toBe(false)
  })

  it('rolls the verification back when the member insert fails', async () => {
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idlife-taken', $1, $2, 'owner', NOW())`,
      [ORG_ID, INVITER_ID],
    )
    await insertInvitation({ id: 'inv-idlife-rollback' })
    const collidingStore = createAtomicIdentityCommandStore(
      db,
      () => 'member-idlife-taken',
    )

    await expect(
      accept('inv-idlife-rollback', {
        markEmailVerified: true,
        storeOverride: collidingStore,
      }),
    ).rejects.toThrow(/duplicate key|member_pkey|Failed query/i)

    expect(await acceptorVerified()).toBe(false)
    expect(await invitationRow('inv-idlife-rollback')).toMatchObject({
      status: 'pending',
    })
  })

  it('refuses a registration whose user row is missing, with no membership', async () => {
    await insertInvitation({ id: 'inv-idlife-ghost' })

    await expect(
      accept('inv-idlife-ghost', {
        acceptorUserId: userId('user-idlife-ghost-000000000000001'),
        markEmailVerified: true,
      }),
    ).rejects.toSatisfy(
      hasCode('registration_failed', /^Registration failed\. Please try again\.$/),
    )

    const members = await pool.query(
      `SELECT id FROM member WHERE "organizationId" = $1`,
      [ORG_ID],
    )
    expect(members.rows).toEqual([])
    expect(await invitationRow('inv-idlife-ghost')).toMatchObject({ status: 'pending' })
  })

  it('reads a lapsed invitation as expired with Resend advice', async () => {
    await insertInvitation({ id: 'inv-idlife-lapsed', expiresAt: LAPSED_EXPIRY })

    await expect(accept('inv-idlife-lapsed')).rejects.toSatisfy(
      hasCode('invitation_expired', /expired\. Ask your Account Admin to resend it\./),
    )
  })

  it('says a consumed invitation is no longer active, without its status', async () => {
    await insertInvitation({ id: 'inv-idlife-canceled', status: 'canceled' })

    await expect(accept('inv-idlife-canceled')).rejects.toSatisfy(
      hasCode(
        'invitation_not_found',
        /^This invitation is no longer active\. Ask your Account Admin for a new one\.$/,
      ),
    )
  })

  it('tells a different address to sign out and open the link again', async () => {
    await insertInvitation({ id: 'inv-idlife-mismatch' })

    await expect(
      accept('inv-idlife-mismatch', { acceptorEmail: 'idlife-someone@test.com' }),
    ).rejects.toSatisfy(hasCode('forbidden', /different email address\. Sign out/))
  })
})

describe.sequential('inviteMember (lapsed invitations)', () => {
  it('refuses a same-Organization re-invite over a lapsed invitation with Resend advice', async () => {
    await insertInvitation({ id: 'inv-idlife-same-lapsed', expiresAt: LAPSED_EXPIRY })

    await expect(invite('inv-idlife-same-new')).rejects.toSatisfy(
      hasCode('already_exists', /expired invitation\. Use Resend to renew it\./),
    )
    expect(await invitationRow('inv-idlife-same-new')).toBeNull()
  })

  it('still refuses a same-Organization re-invite over a live invitation', async () => {
    await insertInvitation({ id: 'inv-idlife-same-live' })

    await expect(invite('inv-idlife-same-live-2')).rejects.toSatisfy(
      hasCode('already_exists', /already invited/),
    )
  })

  it("marks another Organization's lapsed invitation expired and proceeds", async () => {
    await insertInvitation({
      id: 'inv-idlife-other-lapsed',
      organizationId: OTHER_ORG_ID,
      expiresAt: LAPSED_EXPIRY,
    })

    await invite('inv-idlife-after-other')

    expect(await invitationRow('inv-idlife-other-lapsed')).toMatchObject({
      status: 'expired',
    })
    expect(await invitationRow('inv-idlife-after-other')).toMatchObject({
      status: 'pending',
    })
    const facts = await pool.query(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1`,
      [OTHER_ORG_ID],
    )
    expect(facts.rows).toEqual([])
  })

  it("still refuses while another Organization's invitation is live", async () => {
    await insertInvitation({ id: 'inv-idlife-other-live', organizationId: OTHER_ORG_ID })

    await expect(invite('inv-idlife-blocked')).rejects.toSatisfy(
      hasCode('organization_conflict'),
    )
  })
})

describe.sequential('renewInvitation', () => {
  it('renews a lapsed pending invitation in place', async () => {
    await insertInvitation({
      id: 'inv-idlife-renew-lapsed',
      expiresAt: LAPSED_EXPIRY,
      propertyIds: '["prop-a","prop-b"]',
    })

    const renewed = await renew('inv-idlife-renew-lapsed')

    expect(renewed).toEqual({
      email: ACCEPTOR_EMAIL,
      role: 'admin',
      propertyIds: ['prop-a', 'prop-b'],
      expiresAt: RENEWED_EXPIRY,
    })
    expect(await invitationRow('inv-idlife-renew-lapsed')).toEqual({
      status: 'pending',
      expiresAt: RENEWED_EXPIRY,
    })
  })

  it('reopens a row marked expired', async () => {
    await insertInvitation({
      id: 'inv-idlife-renew-expired',
      status: 'expired',
      expiresAt: LAPSED_EXPIRY,
    })

    await renew('inv-idlife-renew-expired')

    expect(await invitationRow('inv-idlife-renew-expired')).toEqual({
      status: 'pending',
      expiresAt: RENEWED_EXPIRY,
    })
  })

  it.each(['accepted', 'canceled', 'rejected'])(
    'refuses a %s invitation',
    async (status) => {
      await insertInvitation({ id: `inv-idlife-renew-${status}`, status })

      await expect(renew(`inv-idlife-renew-${status}`)).rejects.toSatisfy(
        hasCode(
          'invitation_not_found',
          /^This invitation was already accepted or cancelled\.$/,
        ),
      )
      expect(await invitationRow(`inv-idlife-renew-${status}`)).toMatchObject({ status })
    },
  )

  it("refuses another Organization's invitation", async () => {
    await insertInvitation({
      id: 'inv-idlife-renew-foreign',
      organizationId: OTHER_ORG_ID,
    })

    await expect(renew('inv-idlife-renew-foreign')).rejects.toSatisfy(
      hasCode('invitation_not_found'),
    )
  })

  it('refuses while another Organization holds a live invitation', async () => {
    await insertInvitation({
      id: 'inv-idlife-renew-mine',
      status: 'expired',
      expiresAt: LAPSED_EXPIRY,
    })
    await insertInvitation({
      id: 'inv-idlife-renew-theirs',
      organizationId: OTHER_ORG_ID,
    })

    await expect(renew('inv-idlife-renew-mine')).rejects.toSatisfy(
      hasCode('organization_conflict'),
    )
    expect(await invitationRow('inv-idlife-renew-mine')).toMatchObject({
      status: 'expired',
    })
  })

  it('refuses once the address already belongs to an Organization', async () => {
    await insertInvitation({ id: 'inv-idlife-renew-member', expiresAt: LAPSED_EXPIRY })
    await pool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       VALUES ('member-idlife-renew', $1, $2, 'admin', NOW())`,
      [OTHER_ORG_ID, ACCEPTOR_ID],
    )

    await expect(renew('inv-idlife-renew-member')).rejects.toSatisfy(
      hasCode('organization_conflict'),
    )
  })
})

describe.sequential('cancelInvitation (open invitations only)', () => {
  it('cancels an expired invitation', async () => {
    await insertInvitation({
      id: 'inv-idlife-cancel-expired',
      status: 'expired',
      expiresAt: LAPSED_EXPIRY,
    })

    await cancel('inv-idlife-cancel-expired')

    expect(await invitationRow('inv-idlife-cancel-expired')).toMatchObject({
      status: 'canceled',
    })
  })

  it('refuses an accepted invitation and records no fact', async () => {
    await insertInvitation({ id: 'inv-idlife-cancel-accepted', status: 'accepted' })

    await expect(cancel('inv-idlife-cancel-accepted')).rejects.toSatisfy(
      hasCode('invitation_not_found'),
    )
    expect(await invitationRow('inv-idlife-cancel-accepted')).toMatchObject({
      status: 'accepted',
    })
    const facts = await pool.query(
      `SELECT event_type FROM outbox_events WHERE organization_id = $1`,
      [ORG_ID],
    )
    expect(facts.rows).toEqual([])
  })
})
