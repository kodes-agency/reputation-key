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
import { isIdentityError } from '../domain/errors'
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

async function insertProviderAuthority(
  fixture: Fixture,
  options: Readonly<{ emailVerified?: boolean }> = {},
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Recovered manager', $2, $4, $3, $3)`,
    [fixture.authIds.userId, fixture.email, NOW, options.emailVerified ?? true],
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

  it('refuses an address that already has an account, leaving no verification behind', async () => {
    const fixture = await seedInvitation()
    const existingUserId = `${PREFIX}existing-${randomUUID()}`
    await lease.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Former member', $2, true, $3, $3)`,
      [existingUserId, fixture.email.toUpperCase(), NOW],
    )

    await expect(prepare(fixture)).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) &&
        error.code === 'account_exists' &&
        error.message ===
          'An account already exists for this email. Sign in, then open your invitation link again.',
    )

    const leftovers = await lease.pool.query<{ verifications: string; users: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM verification WHERE identifier = $1) AS verifications,
         (SELECT COUNT(*)::text FROM "user" WHERE LOWER(email) = LOWER($2)) AS users`,
      [`invited-registration:${fixture.invitationId as string}`, fixture.email],
    )
    expect(leftovers.rows[0]).toEqual({ verifications: '0', users: '1' })
  })

  it('tells a lapsed invitation from a consumed one, in fixed copy', async () => {
    const lapsed = await seedInvitation()
    await lease.pool.query(`UPDATE invitation SET "expiresAt" = $2 WHERE id = $1`, [
      lapsed.invitationId as string,
      new Date(NOW.getTime() - 1),
    ])
    const consumed = await seedInvitation()
    await lease.pool.query(`UPDATE invitation SET status = 'canceled' WHERE id = $1`, [
      consumed.invitationId as string,
    ])

    await expect(prepare(lapsed)).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) &&
        error.code === 'invitation_expired' &&
        error.message ===
          'This invitation has expired. Ask your Account Admin to resend it.',
    )
    await expect(prepare(consumed)).rejects.toSatisfy(
      (error: unknown) =>
        isIdentityError(error) &&
        error.code === 'invitation_not_found' &&
        !error.message.includes('canceled'),
    )
  })

  it('lets an interrupted attempt resume over the account it created itself', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture, 'verification-own-attempt')
    await insertProviderAuthority(fixture, { emailVerified: false })

    await expect(prepare(fixture, 'verification-ignored')).resolves.toEqual(prepared)
  })

  it('settles a verified registration although the member then signed in', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    await insertProviderAuthority(fixture, { emailVerified: false })
    const registrationStore = createInvitedRegistrationStore(db)
    const recovery = await registrationStore.reconcile({
      verificationId: prepared.verificationId,
      now: NOW,
      nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
    })
    if (recovery.kind !== 'ready_to_accept') throw new Error('expected recovery')

    await createAtomicIdentityCommandStore(db, randomUUID).acceptInvitation({
      invitationId: fixture.invitationId,
      acceptorEmail: recovery.acceptorEmail,
      acceptorUserId: userId(fixture.authIds.userId),
      now: NOW,
      markEmailVerified: true,
      buildEvent: (currentInvitation) =>
        identityInvitationAccepted({
          organizationId: currentInvitation.organizationId,
          userId: userId(fixture.authIds.userId),
          invitationId: fixture.invitationId,
          propertyIds: currentInvitation.propertyIds,
          occurredAt: NOW,
        }),
    })
    // Registration signs the member in after acceptance, on a session id
    // Better Auth chose rather than the preallocated one.
    await lease.pool.query(
      `INSERT INTO session (id, "expiresAt", token, "userId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [
        `${PREFIX}sign-in-${randomUUID()}`,
        new Date('2026-09-27T12:00:00.000Z'),
        randomUUID(),
        fixture.authIds.userId,
        NOW,
      ],
    )

    await expect(
      registrationStore.reconcile({
        verificationId: prepared.verificationId,
        now: NOW,
        nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
    ).resolves.toMatchObject({ kind: 'accepted', userId: fixture.authIds.userId })
    const verified = await lease.pool.query<{ emailVerified: boolean }>(
      `SELECT "emailVerified" FROM "user" WHERE id = $1`,
      [fixture.authIds.userId],
    )
    expect(verified.rows).toEqual([{ emailVerified: true }])
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
