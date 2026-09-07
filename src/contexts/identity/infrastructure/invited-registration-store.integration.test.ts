import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { identityInvitationAccepted } from '../domain/events'
import { invitationId, userId, type InvitationId } from '#/shared/domain/ids'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { createInvitedRegistrationStore } from './invited-registration-store'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const PREFIX = 'invreg-integration-'

let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  invitationId: InvitationId
  email: string
  authIds: Readonly<{
    userId: string
    credentialAccountId: string
    initialSessionId: string
  }>
}>

async function seedInvitation(): Promise<Fixture> {
  const suffix = randomUUID()
  const organizationId = `${PREFIX}org-${suffix}`
  const rawInvitationId = `${PREFIX}invitation-${suffix}`
  const inviterId = `${PREFIX}inviter-${suffix}`
  const email = `${PREFIX}${suffix}@example.com`
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Invited registration test', $1, $2)`,
    [organizationId, NOW],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Inviter', $2, true, $3, $3)`,
    [inviterId, `${inviterId}@example.com`, NOW],
  )
  await lease.pool.query(
    `INSERT INTO invitation (
       id, "organizationId", email, role, status, "expiresAt", "propertyIds",
       "inviterId", "createdAt"
     ) VALUES ($1, $2, $3, 'admin', 'pending', $4, '["property-1"]', $5, $6)`,
    [
      rawInvitationId,
      organizationId,
      email,
      new Date('2026-09-27T12:00:00.000Z'),
      inviterId,
      NOW,
    ],
  )
  return {
    organizationId,
    invitationId: invitationId(rawInvitationId),
    email,
    authIds: {
      userId: `${PREFIX}user-${suffix}`,
      credentialAccountId: `${PREFIX}account-${suffix}`,
      initialSessionId: `${PREFIX}session-${suffix}`,
    },
  }
}

async function prepare(fixture: Fixture, proposedVerificationId: string = randomUUID()) {
  return createInvitedRegistrationStore(db).prepare({
    proposedVerificationId,
    invitationId: fixture.invitationId,
    email: fixture.email,
    proposedAuthIds: fixture.authIds,
    now: NOW,
    nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
  })
}

async function insertProviderAuthority(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Recovered manager', $2, true, $3, $3)`,
    [fixture.authIds.userId, fixture.email, NOW],
  )
  await lease.pool.query(
    `INSERT INTO account (
       id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'credential', $2, 'test-only-hash', $3, $3)`,
    [fixture.authIds.credentialAccountId, fixture.authIds.userId, NOW],
  )
  await lease.pool.query(
    `INSERT INTO session (
       id, "expiresAt", token, "userId", "createdAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $5)`,
    [
      fixture.authIds.initialSessionId,
      new Date('2026-09-27T12:00:00.000Z'),
      randomUUID(),
      fixture.authIds.userId,
      NOW,
    ],
  )
}

async function cleanFixtures(): Promise<void> {
  await lease.pool.query(
    `DELETE FROM verification WHERE identifier LIKE '${PREFIX}%' OR identifier LIKE 'invited-registration:${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM outbox_events WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM member
      WHERE "organizationId" LIKE '${PREFIX}%' OR "userId" LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM invitation WHERE "organizationId" LIKE '${PREFIX}%'`,
  )
  const organizations = await lease.pool.query<{ id: string }>(
    `SELECT id FROM organization WHERE id LIKE '${PREFIX}%'`,
  )
  await deleteTestOrganizations(
    lease.pool,
    organizations.rows.map(({ id }) => id),
  )
  await lease.pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}%'`)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(cleanFixtures)

afterAll(async () => {
  clearEventSchemas()
  await cleanFixtures()
  await lease.release()
})

describe.sequential('invited registration store (integration)', () => {
  it('reuses one short-lived Better Auth verification with exact provider IDs', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture, 'verification-first')
    const retried = await prepare(fixture, 'verification-ignored')

    expect(retried).toEqual(prepared)
    const result = await lease.pool.query<{
      identifier: string
      value: string
      expires_at: Date
    }>(
      `SELECT identifier, value, "expiresAt" AS expires_at
         FROM verification WHERE id = $1`,
      [prepared.verificationId],
    )
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      identifier: `invited-registration:${fixture.invitationId as string}`,
      expires_at: new Date('2026-09-28T12:00:00.000Z'),
    })
    expect(JSON.parse(result.rows[0]!.value)).toEqual({
      version: 1,
      invitationId: fixture.invitationId,
      organizationId: fixture.organizationId,
      authIds: fixture.authIds,
    })
    expect(result.rows[0]!.value).not.toContain(fixture.email)
  })

  it('gives one due verification to only one concurrent claimant', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    const dueAt = new Date(NOW.getTime() + 5 * 60_000)
    const claimExpiresAt = new Date(dueAt.getTime() + 60_000)
    const store = createInvitedRegistrationStore(db)

    const claims = await Promise.all([
      store.claimDue({ now: dueAt, claimExpiresAt, limit: 100 }),
      store.claimDue({ now: dueAt, claimExpiresAt, limit: 100 }),
    ])

    expect(claims.flat()).toEqual([{ verificationId: prepared.verificationId }])
  })

  it('resumes exact provider identity and settles from Better Auth authority', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    await insertProviderAuthority(fixture)
    const registrationStore = createInvitedRegistrationStore(db)

    const recovery = await registrationStore.reconcile({
      verificationId: prepared.verificationId,
      now: NOW,
      nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
    })
    expect(recovery).toMatchObject({
      kind: 'ready_to_accept',
      acceptorEmail: fixture.email,
    })
    if (recovery.kind !== 'ready_to_accept') throw new Error('expected recovery')

    const accepted = await createAtomicIdentityCommandStore(
      db,
      randomUUID,
    ).acceptInvitation({
      invitationId: fixture.invitationId,
      acceptorEmail: recovery.acceptorEmail,
      acceptorUserId: userId(fixture.authIds.userId),
      now: NOW,
      buildEvent: (currentInvitation) =>
        identityInvitationAccepted({
          organizationId: currentInvitation.organizationId,
          userId: userId(fixture.authIds.userId),
          invitationId: fixture.invitationId,
          propertyIds: currentInvitation.propertyIds,
          occurredAt: NOW,
        }),
    })
    expect(accepted.propertyIds).toEqual(['property-1'])

    await expect(
      registrationStore.reconcile({
        verificationId: prepared.verificationId,
        now: NOW,
        nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
    ).resolves.toMatchObject({
      kind: 'accepted',
      organizationId: fixture.organizationId,
      userId: fixture.authIds.userId,
    })

    const authority = await lease.pool.query<{
      invitation_status: string
      membership_count: string
      verification_count: string
      fact_count: string
    }>(
      `SELECT
         (SELECT status FROM invitation WHERE id = $1) AS invitation_status,
         (SELECT COUNT(*)::text FROM member WHERE "userId" = $2) AS membership_count,
         (SELECT COUNT(*)::text FROM verification WHERE id = $3) AS verification_count,
         (SELECT COUNT(*)::text FROM outbox_events
           WHERE organization_id = $4 AND event_type = 'identity.invitation.accepted') AS fact_count`,
      [
        fixture.invitationId as string,
        fixture.authIds.userId,
        prepared.verificationId,
        fixture.organizationId,
      ],
    )
    expect(authority.rows[0]).toEqual({
      invitation_status: 'accepted',
      membership_count: '1',
      verification_count: '0',
      fact_count: '1',
    })
  })

  it('deletes only the exact partial provider user during compensation', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    const unrelatedUserId = `${PREFIX}unrelated-${randomUUID()}`
    await lease.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES
         ($1, 'Partial provider user', $2, true, $4, $4),
         ($3, 'Unrelated user', $5, true, $4, $4)`,
      [
        fixture.authIds.userId,
        fixture.email,
        unrelatedUserId,
        NOW,
        `${unrelatedUserId}@example.com`,
      ],
    )

    await expect(
      createInvitedRegistrationStore(db).reconcile({
        verificationId: prepared.verificationId,
        now: NOW,
        nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
    ).resolves.toEqual({ kind: 'compensated' })
    const users = await lease.pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE id = ANY($1::text[]) ORDER BY id`,
      [[fixture.authIds.userId, unrelatedUserId]],
    )
    expect(users.rows).toEqual([{ id: unrelatedUserId }])
    await expect(
      lease.pool.query('SELECT id FROM verification WHERE id = $1', [
        prepared.verificationId,
      ]),
    ).resolves.toMatchObject({ rowCount: 0 })
  })
})
