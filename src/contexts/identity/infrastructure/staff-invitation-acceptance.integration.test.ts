import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  seedStaffAccountFixture,
  seedStaffAccountUser,
  cleanStaffAccountFixture,
  STAFF_FIXTURE_NOW as NOW,
  type StaffAccountFixture,
} from '#/shared/testing/staff-account-fixture'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { identityInvitationAccepted } from '../domain/events'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { createInvitationReadModel } from './invitation-read-model'
import { createInvitedRegistrationStore } from './invited-registration-store'
import { acceptInvitation } from '../application/use-cases/accept-invitation'
import { registerInvitedUser } from '../application/use-cases/register-invited-user'
import { recoverInvitedRegistrations } from '../application/use-cases/recover-invited-registrations'
import { linkStaffInvitation } from './staff-invitation-link'

let lease: TestLease
let db: Database
let fixtures: StaffAccountFixture[] = []
beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  clearEventSchemas()
  registerAllEventSchemas()
})
afterEach(async () => {
  for (const fixture of fixtures) await cleanStaffAccountFixture(lease.pool, fixture)
  fixtures = []
})
afterAll(async () => {
  clearEventSchemas()
  await lease.release()
})
const seed = async () => {
  const row = await seedStaffAccountFixture(lease.pool)
  fixtures = [...fixtures, row]
  return row
}
const commands = () => createAtomicIdentityCommandStore(db, randomUUID, async () => true)
const admission = () => ({
  invitations: createInvitationReadModel(db),
  authorizeOrganization: async () => true,
})

async function assertAccepted(row: StaffAccountFixture) {
  const members = await lease.pool.query(
    'SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2',
    [row.organizationId, row.userId],
  )
  expect(members.rows).toEqual([{ role: 'member' }])
  const links = await lease.pool.query(
    'SELECT staff_participant_id FROM staff_user_links WHERE organization_id = $1 AND user_id = $2 AND effective_to IS NULL',
    [row.organizationId, row.userId],
  )
  expect(links.rows).toEqual([{ staff_participant_id: row.participantId }])
  const grants = await lease.pool.query(
    'SELECT id FROM property_access_grant WHERE organization_id = $1 AND user_id = $2',
    [row.organizationId, row.userId],
  )
  expect(grants.rows).toEqual([])
}

describe.sequential('staff invitation acceptance (PostgreSQL)', () => {
  it('commits a signed-in acceptance with its link and no Property grant', async () => {
    const row = await seed()
    await seedStaffAccountUser(lease.pool, row)
    const identity = createInMemoryIdentityPort()
    identity.setSessionUser({ id: row.userId, email: row.email })
    await acceptInvitation({
      ...admission(),
      identity,
      commandStore: commands(),
      clock: () => NOW,
      logger: { error: vi.fn() },
    })({
      invitationId: row.invitationId,
      userId: userId(row.userId),
      headers: new Headers(),
    })
    await assertAccepted(row)
  })
  it('commits invited registration with its link and no Property grant', async () => {
    const row = await seed()
    const registrationStore = createInvitedRegistrationStore(db)
    let index = 0
    const ids = [randomUUID(), row.userId, `${row.userId}-credential`]
    await registerInvitedUser({
      ...admission(),
      commandStore: commands(),
      registrationStore,
      signUp: async (_name, _email, _password, authIds) => {
        await seedStaffAccountUser(
          lease.pool,
          { ...row, userId: authIds.userId },
          authIds.credentialAccountId,
        )
        return authIds.userId
      },
      idGen: () => ids[index++] ?? randomUUID(),
      clock: () => NOW,
      logger: { error: vi.fn() },
    })({
      invitationId: row.invitationId,
      name: 'Polly Smith',
      email: row.email,
      password: 'a-safe-test-password',
    })
    await assertAccepted(row)
  })
  it('commits registration recovery with its link and no Property grant', async () => {
    const row = await seed()
    const registrationStore = createInvitedRegistrationStore(db)
    const credentialAccountId = `${row.userId}-credential`
    await registrationStore.prepare({
      proposedVerificationId: randomUUID(),
      invitationId: row.invitationId,
      email: row.email,
      proposedAuthIds: {
        userId: row.userId,
        credentialAccountId,
        initialSessionId: `${row.userId}-session`,
      },
      now: NOW,
      nextRecoveryAt: NOW,
    })
    await seedStaffAccountUser(lease.pool, row, credentialAccountId)
    expect(
      await recoverInvitedRegistrations({
        commandStore: commands(),
        registrationStore,
        clock: () => NOW,
        logger: { error: vi.fn() },
      })({ authorizeOrganization: async () => true }),
    ).toMatchObject({ accepted: 1, failures: 0 })
    await assertAccepted(row)
  })
  it('rolls the membership and link back together when the acceptance fact cannot commit', async () => {
    const row = await seed()
    await seedStaffAccountUser(lease.pool, row)
    await expect(
      commands().acceptInvitation({
        invitationId: row.invitationId,
        acceptorEmail: row.email,
        acceptorUserId: userId(row.userId),
        now: NOW,
        buildEvent: () => {
          throw new Error('Injected fact failure')
        },
      }),
    ).rejects.toThrow('Injected fact failure')
    expect(
      (
        await lease.pool.query('SELECT id FROM member WHERE "organizationId" = $1', [
          row.organizationId,
        ])
      ).rows,
    ).toEqual([])
    expect(
      (
        await lease.pool.query(
          'SELECT id FROM staff_user_links WHERE organization_id = $1',
          [row.organizationId],
        )
      ).rows,
    ).toEqual([])
    await commands().acceptInvitation({
      invitationId: row.invitationId,
      acceptorEmail: row.email,
      acceptorUserId: userId(row.userId),
      now: NOW,
      buildEvent: (accepted) =>
        identityInvitationAccepted({
          ...accepted,
          inviterId: accepted.inviterId ?? undefined,
          invitationId: row.invitationId,
          userId: userId(row.userId),
          occurredAt: NOW,
        }),
    })
    await assertAccepted(row)
  })
  it('refuses an ended participation with a plain invitation message', async () => {
    const row = await seed()
    await seedStaffAccountUser(lease.pool, row)
    await lease.pool.query(
      "UPDATE staff_participations SET status = 'archived', ended_at = $2, archive_reason = 'staff_removed' WHERE id = $1",
      [row.participationId, NOW],
    )
    await expect(
      db.transaction((tx) =>
        linkStaffInvitation(tx, {
          organizationId: row.organizationId,
          participationId: row.participationId,
          userId: row.userId,
          actorId: row.inviterId,
          at: NOW,
        }),
      ),
    ).rejects.toThrow('This staff invitation has ended')
    expect(
      (
        await lease.pool.query(
          'SELECT id FROM staff_user_links WHERE organization_id = $1',
          [row.organizationId],
        )
      ).rows,
    ).toEqual([])
  })
})
