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
import { invitationId, userId } from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { createInvitedRegistrationStore } from './invited-registration-store'

const NOW = new Date('2026-08-27T12:00:00.000Z')
const PREFIX = 'invreg-integration-'

let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  invitationId: ReturnType<typeof invitationId>
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

async function prepare(fixture: Fixture) {
  return createInvitedRegistrationStore(db).prepare({
    proposedAttemptId: randomUUID(),
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
    `DELETE FROM outbox_events WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM invited_registration_attempts WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM user_organization_bindings
      WHERE organization_id LIKE '${PREFIX}%' OR user_id LIKE '${PREFIX}%'`,
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
  it('commits the manual-review fence before reporting the registration error', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    await lease.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Unexpected authority', $2, true, $3, $3)`,
      [fixture.authIds.userId, fixture.email, NOW],
    )
    await lease.pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'admin', $4)`,
      [randomUUID(), fixture.authIds.userId, fixture.organizationId, NOW],
    )

    await expect(prepare(fixture)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'registration_failed',
    )
    const row = await lease.pool.query<{
      state: string
      manual_review_at: Date | null
      last_failure_code: string | null
    }>(
      `SELECT state, manual_review_at, last_failure_code
         FROM invited_registration_attempts WHERE id = $1`,
      [prepared.id],
    )
    expect(row.rows[0]).toMatchObject({
      state: 'manual_review',
      last_failure_code: 'unexpected_authority',
    })
    expect(row.rows[0]?.manual_review_at).toEqual(NOW)
  })

  it('gives a due attempt to only one lease owner and rejects the loser', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    const dueAt = new Date(NOW.getTime() + 5 * 60_000)
    const firstOwner = randomUUID()
    const secondOwner = randomUUID()
    const store = createInvitedRegistrationStore(db)

    const claims = await Promise.all([
      store.claimDue({
        now: dueAt,
        leaseOwner: firstOwner,
        leaseExpiresAt: new Date(dueAt.getTime() + 60_000),
        limit: 100,
      }),
      store.claimDue({
        now: dueAt,
        leaseOwner: secondOwner,
        leaseExpiresAt: new Date(dueAt.getTime() + 60_000),
        limit: 100,
      }),
    ])
    expect(claims.flat()).toEqual([{ id: prepared.id }])
    const winner = claims[0]?.length ? firstOwner : secondOwner
    const loser = winner === firstOwner ? secondOwner : firstOwner

    await expect(
      store.reconcile({
        attemptId: prepared.id,
        now: dueAt,
        nextRecoveryAt: new Date(dueAt.getTime() + 5 * 60_000),
        leaseOwner: loser,
      }),
    ).resolves.toEqual({ kind: 'claim_lost' })
    await expect(
      store.reconcile({
        attemptId: prepared.id,
        now: dueAt,
        nextRecoveryAt: new Date(dueAt.getTime() + 5 * 60_000),
        leaseOwner: winner,
      }),
    ).resolves.toEqual({ kind: 'awaiting_provider' })
  })

  it('resumes the exact provider identity into one atomic membership and fact', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    await insertProviderAuthority(fixture)
    const registrationStore = createInvitedRegistrationStore(db)

    const recovery = await registrationStore.reconcile({
      attemptId: prepared.id,
      now: NOW,
      nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
    })
    expect(recovery).toMatchObject({
      kind: 'ready_to_accept',
      acceptorEmail: fixture.email,
    })
    if (recovery.kind !== 'ready_to_accept') throw new Error('expected recovery')

    const commandStore = createAtomicIdentityCommandStore(db, randomUUID)
    const accepted = await commandStore.acceptInvitation({
      invitationId: fixture.invitationId,
      registrationAttemptId: prepared.id,
      acceptorEmail: recovery.acceptorEmail,
      acceptorUserId: userId(fixture.authIds.userId),
      now: NOW,
      buildEvent: (invitation) =>
        identityInvitationAccepted({
          organizationId: invitation.organizationId,
          userId: userId(fixture.authIds.userId),
          invitationId: fixture.invitationId,
          propertyIds: invitation.propertyIds,
          occurredAt: NOW,
        }),
    })
    expect(accepted.propertyIds).toEqual(['property-1'])

    const authority = await lease.pool.query<{
      invitation_status: string
      attempt_state: string
      membership_count: string
      binding_count: string
      fact_count: string
    }>(
      `SELECT
         (SELECT status FROM invitation WHERE id = $1) AS invitation_status,
         (SELECT state FROM invited_registration_attempts WHERE id = $2) AS attempt_state,
         (SELECT COUNT(*)::text FROM member WHERE "userId" = $3) AS membership_count,
         (SELECT COUNT(*)::text FROM user_organization_bindings WHERE user_id = $3) AS binding_count,
         (SELECT COUNT(*)::text FROM outbox_events
           WHERE organization_id = $4 AND event_type = 'identity.invitation.accepted') AS fact_count`,
      [
        fixture.invitationId as string,
        prepared.id,
        fixture.authIds.userId,
        fixture.organizationId,
      ],
    )
    expect(authority.rows[0]).toEqual({
      invitation_status: 'accepted',
      attempt_state: 'accepted',
      membership_count: '1',
      binding_count: '1',
      fact_count: '1',
    })
  })

  it('serializes foreground acceptance and recovery without a lock-order deadlock', async () => {
    const fixture = await seedInvitation()
    const prepared = await prepare(fixture)
    await insertProviderAuthority(fixture)
    const registrationStore = createInvitedRegistrationStore(db)
    const commandStore = createAtomicIdentityCommandStore(db, randomUUID)

    const [recovery, accepted] = await Promise.all([
      registrationStore.reconcile({
        attemptId: prepared.id,
        now: NOW,
        nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
      commandStore.acceptInvitation({
        invitationId: fixture.invitationId,
        registrationAttemptId: prepared.id,
        acceptorEmail: fixture.email,
        acceptorUserId: userId(fixture.authIds.userId),
        now: NOW,
        buildEvent: (invitation) =>
          identityInvitationAccepted({
            organizationId: invitation.organizationId,
            userId: userId(fixture.authIds.userId),
            invitationId: fixture.invitationId,
            propertyIds: invitation.propertyIds,
            occurredAt: NOW,
          }),
      }),
    ])

    expect(['ready_to_accept', 'accepted']).toContain(recovery.kind)
    expect(accepted.organizationId as string).toBe(fixture.organizationId)
    const row = await lease.pool.query<{ state: string }>(
      `SELECT state FROM invited_registration_attempts WHERE id = $1`,
      [prepared.id],
    )
    expect(row.rows[0]?.state).toBe('accepted')
  })

  it('deletes only the exact fenced partial provider user during compensation', async () => {
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
        attemptId: prepared.id,
        now: NOW,
        nextRecoveryAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
    ).resolves.toEqual({ kind: 'compensated' })
    const users = await lease.pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE id = ANY($1::text[]) ORDER BY id`,
      [[fixture.authIds.userId, unrelatedUserId]],
    )
    expect(users.rows).toEqual([{ id: unrelatedUserId }])
  })
})
