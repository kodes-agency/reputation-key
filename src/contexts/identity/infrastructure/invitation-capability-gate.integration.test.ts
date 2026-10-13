// Invitation acceptance and the capability gate, against real PostgreSQL
// (R5G-03, ADR 0032).
//
// A suspended Organization, the kill switch and isolated restore mode stop
// every other Organization write. Consuming an invitation writes a standing
// membership, so the three paths that do it (signed in, registration, the
// registration recovery job) must ask the same question for the invitation's
// Organization before anything is written. The use cases are built the way the
// context builds them, and the job is given the authorizer the worker gives it.
//
// A suspension refuses an invitation; it does not cancel one, and the app's own
// Cancel is refused by the same suspension. The account-compromise runbook
// (docs/operations/runbooks.md §1) therefore gives the operator a statement to
// run before the suspension is lifted. The last block reads that statement out
// of the runbook and runs it, so the procedure cannot drift from the schema or
// from what acceptance then does.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Job } from 'bullmq'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createExecutionPolicy,
  initExecutionPolicy,
  requireExecutionAllowed,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { createScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  invitationId,
  organizationId as toOrganizationId,
  userId,
  type InvitationId,
} from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import { buildInvitationUseCases } from '../build-invitations'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { createInvitedRegistrationStore } from './invited-registration-store'
import { createRecoverInvitedRegistrationsHandler } from './jobs/recover-invited-registrations.job'

const START = new Date('2026-10-13T12:00:00.000Z')
const EXPIRES_AT = new Date('2026-10-20T12:00:00.000Z')
const RECOVERY_INTERVAL_MS = 5 * 60_000
const PREFIX = 'invgate-integration-'
const HEADERS = new Headers()
const REFUSAL = 'This invitation cannot be accepted right now. Try again later.'

let lease: TestLease
let db: Database
let now = START

type Fixture = Readonly<{
  organizationId: string
  inviterId: string
  invitationId: InvitationId
  email: string
  acceptorId: string
  accountId: string
}>

/** An AccountAdmin of the Organization; returns the user id. */
async function insertAccountAdmin(organizationId: string): Promise<string> {
  const adminId = `${PREFIX}inviter-${randomUUID()}`
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Inviter', $2, true, $3, $3)`,
    [adminId, `${adminId}@example.com`, START],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [`${PREFIX}member-${randomUUID()}`, organizationId, adminId, START],
  )
  return adminId
}

/** An AccountAdmin invitation as stored, in the given status; returns its id. */
async function insertInvitation(
  input: Readonly<{
    organizationId: string
    inviterId: string
    status: string
    id?: string
    email?: string
  }>,
): Promise<string> {
  const id = input.id ?? `${PREFIX}invitation-${randomUUID()}`
  await lease.pool.query(
    `INSERT INTO invitation (
       id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt"
     ) VALUES ($1, $2, $3, 'owner', $4, $5, $6, $7)`,
    [
      id,
      input.organizationId,
      input.email ?? `${id}@example.com`,
      input.status,
      EXPIRES_AT,
      input.inviterId,
      START,
    ],
  )
  return id
}

/** An Organization with one AccountAdmin and a pending manager invitation. */
async function seedInvitation(): Promise<Fixture> {
  const suffix = randomUUID()
  const organizationId = `${PREFIX}org-${suffix}`
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Gated invitation', $1, $2)`,
    [organizationId, START],
  )
  const fixture: Fixture = {
    organizationId,
    inviterId: await insertAccountAdmin(organizationId),
    invitationId: invitationId(`${PREFIX}invitation-${suffix}`),
    email: `${PREFIX}${suffix}@example.com`,
    acceptorId: `${PREFIX}acceptor-${suffix}`,
    accountId: `${PREFIX}account-${suffix}`,
  }
  await insertInvitation({
    organizationId,
    inviterId: fixture.inviterId,
    status: 'pending',
    id: fixture.invitationId as string,
    email: fixture.email,
  })
  return fixture
}

/** The stored status of each of these invitations, in the order given. */
async function invitationStatuses(
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<string | undefined>> {
  const rows = await lease.pool.query<{ id: string; status: string }>(
    `SELECT id, status FROM invitation WHERE id = ANY($1::text[])`,
    [ids],
  )
  return ids.map((id) => rows.rows.find((row) => row.id === id)?.status)
}

/** The invitee's account: one they already had, or the one sign-up creates. */
async function insertAcceptor(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Invitee', $2, false, $3, $3)`,
    [fixture.acceptorId, fixture.email, START],
  )
  await lease.pool.query(
    `INSERT INTO account (
       id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'credential', $2, 'test-only-hash', $3, $3)`,
    [fixture.accountId, fixture.acceptorId, START],
  )
}

/** What the Organization gained and what is left of the attempt. */
async function outcome(fixture: Fixture) {
  const rows = await lease.pool.query<{
    membership_roles: string[]
    invitation_status: string
    accounts: string
    recovery_records: string
  }>(
    `SELECT
       ARRAY(SELECT role FROM member
              WHERE "organizationId" = $1 AND "userId" = $2) AS membership_roles,
       (SELECT status FROM invitation WHERE id = $3) AS invitation_status,
       (SELECT COUNT(*)::text FROM "user" WHERE id = $2) AS accounts,
       (SELECT COUNT(*)::text FROM verification
         WHERE identifier = 'invited-registration:' || $3) AS recovery_records`,
    [fixture.organizationId, fixture.acceptorId, fixture.invitationId as string],
  )
  const row = rows.rows[0]
  return {
    membershipRoles: row?.membership_roles,
    invitationStatus: row?.invitation_status,
    accounts: Number(row?.accounts),
    recoveryRecords: Number(row?.recovery_records),
  }
}

async function cleanFixtures(): Promise<void> {
  await lease.pool.query(
    `DELETE FROM verification WHERE identifier LIKE 'invited-registration:${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM outbox_events WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM invitation WHERE "organizationId" LIKE '${PREFIX}%'`,
  )
  await withLastOwnerGuardDisabled(lease.pool, async (client) => {
    await client.query(`DELETE FROM member WHERE "organizationId" LIKE '${PREFIX}%'`)
    const organizations = await client.query<{ id: string }>(
      `SELECT id FROM organization WHERE id LIKE '${PREFIX}%'`,
    )
    await deleteTestOrganizations(
      client,
      organizations.rows.map(({ id }) => id),
    )
  })
  await lease.pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}%'`)
}

/** The process posture: environment-backed capability policy, as deployed. */
function installPolicy(env: Readonly<Record<string, string>>): void {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
  initExecutionPolicy(
    createExecutionPolicy({ listAccessiblePropertyIds: async () => [] }),
  )
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
}

type Posture = Readonly<{
  name: string
  env: (fixture: Fixture) => Readonly<Record<string, string>>
  restoreIsolated?: boolean
}>

const STOPPED: ReadonlyArray<Posture> = [
  {
    name: 'its Organization is suspended',
    env: (fixture) => ({ BETA_SUSPENDED_ORGS: fixture.organizationId }),
  },
  { name: 'the kill switch is on', env: () => ({ BETA_CAPABILITIES_OFF: 'all' }) },
  {
    name: 'identity.invite is switched off',
    env: () => ({ BETA_CAPABILITIES_OFF: 'identity.invite' }),
  },
  { name: 'restore mode is isolated', env: () => ({}), restoreIsolated: true },
]

function enter(posture: Posture, fixture: Fixture): void {
  installPolicy(posture.env(fixture))
  if (posture.restoreIsolated) vi.stubEnv('RESTORE_MODE', 'isolated')
}

/** The invitation use cases as the context builds them, over the real stores. */
function build(fixture: Fixture) {
  const identityPort = createInMemoryIdentityPort()
  identityPort.setSessionUser({ id: fixture.acceptorId, email: fixture.email })
  const signUp = vi.fn(async () => {
    await insertAcceptor(fixture)
    return fixture.acceptorId
  })
  const ids = [randomUUID(), fixture.acceptorId, fixture.accountId]
  const useCases = buildInvitationUseCases({
    db,
    identityPort: { ...identityPort, signUp },
    commandStore: createAtomicIdentityCommandStore(db, randomUUID),
    clock: () => now,
    idGen: () => ids.shift() ?? randomUUID(),
    sendEmail: async () => {},
    baseUrl: 'http://localhost:3000',
    invitationExpiresInMs: EXPIRES_AT.getTime() - START.getTime(),
    propertyNames: async () => [],
    logger: createMockLogger(),
    resolveOrganizationName: async () => 'Gated invitation',
  })
  return { useCases, signUp }
}

const acceptInput = (fixture: Fixture) => ({
  invitationId: fixture.invitationId,
  headers: HEADERS,
  userId: userId(fixture.acceptorId),
})

const registerInput = (fixture: Fixture) => ({
  invitationId: fixture.invitationId,
  name: 'Invitee',
  email: fixture.email,
  password: 'a-safe-test-password',
})

const isRefusal = (error: unknown): boolean =>
  isIdentityError(error) && error.code === 'forbidden' && error.message === REFUSAL

/** The stores' answer for an invitation that is cancelled, accepted or unknown. */
const isGone = (error: unknown): boolean =>
  isIdentityError(error) && error.code === 'invitation_not_found'

/** Runbook §1, account compromise: the procedure that suspends an Organization. */
const RUNBOOK_COMPROMISE =
  /^## 1\. [^]*?(?=^## )/m.exec(
    readFileSync('docs/operations/runbooks.md', 'utf8'),
  )?.[0] ?? ''

/** The statement §1 has the operator run before the suspension is lifted. */
function runbookCancelStatement(): string {
  const statement = /`(UPDATE invitation SET status = 'canceled'[^`]*)`/.exec(
    RUNBOOK_COMPROMISE,
  )?.[1]
  if (!statement) {
    throw new Error('Runbook §1 gives no statement that cancels invitations')
  }
  return statement
}

/** Run §1's statement for one Organization and one compromised account. */
async function cancelAsTheRunbookSays(fixture: Fixture): Promise<ReadonlyArray<string>> {
  const cancelled = await lease.pool.query<{ id: string }>(runbookCancelStatement(), [
    fixture.organizationId,
    fixture.inviterId,
  ])
  return cancelled.rows.map((row) => row.id).sort()
}

/** One firing of the recovery job, wired as the worker wires it. */
function recoveryJob(fixture: Fixture) {
  const logger = { info: vi.fn() }
  const run = createRecoverInvitedRegistrationsHandler({
    recover: build(fixture).useCases.recoverInvitedRegistrations,
    authorizeScope: createScheduledScopeAuthorizer('system:identity.accept_invitation'),
    logger,
  })
  return { run: () => run({} as Job), logger }
}

/** A registration whose request died between sign-up and acceptance. */
async function interruptRegistration(fixture: Fixture): Promise<void> {
  await createInvitedRegistrationStore(db).prepare({
    proposedVerificationId: randomUUID(),
    invitationId: fixture.invitationId,
    email: fixture.email,
    proposedAuthIds: {
      userId: fixture.acceptorId,
      credentialAccountId: fixture.accountId,
      initialSessionId: `${PREFIX}session-${randomUUID()}`,
    },
    now,
    nextRecoveryAt: now,
  })
  await insertAcceptor(fixture)
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  resetDelayedExecutionPolicy()
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
  now = START
  await cleanFixtures()
})

afterAll(async () => {
  clearEventSchemas()
  await cleanFixtures()
  await lease.release()
})

describe.sequential(
  'invitation acceptance asks the capability gate (integration)',
  () => {
    it.each(STOPPED)(
      'refuses a signed-in acceptance while $name, and writes nothing',
      async (posture) => {
        const fixture = await seedInvitation()
        await insertAcceptor(fixture)
        enter(posture, fixture)

        await expect(
          build(fixture).useCases.acceptInvitation(acceptInput(fixture)),
        ).rejects.toSatisfy(isRefusal)

        expect(await outcome(fixture)).toMatchObject({
          membershipRoles: [],
          invitationStatus: 'pending',
        })
      },
    )

    it.each(STOPPED)(
      'refuses a registration while $name, before any account exists',
      async (posture) => {
        const fixture = await seedInvitation()
        enter(posture, fixture)
        const { useCases, signUp } = build(fixture)

        await expect(
          useCases.registerInvitedUser(registerInput(fixture)),
        ).rejects.toSatisfy(isRefusal)

        expect(signUp).not.toHaveBeenCalled()
        expect(await outcome(fixture)).toEqual({
          membershipRoles: [],
          invitationStatus: 'pending',
          accounts: 0,
          recoveryRecords: 0,
        })
      },
    )

    it('still accepts and registers for another Organization while one is suspended', async () => {
      const suspended = await seedInvitation()
      const signedIn = await seedInvitation()
      const registering = await seedInvitation()
      await insertAcceptor(signedIn)
      installPolicy({ BETA_SUSPENDED_ORGS: suspended.organizationId })

      await build(signedIn).useCases.acceptInvitation(acceptInput(signedIn))
      await build(registering).useCases.registerInvitedUser(registerInput(registering))

      expect((await outcome(signedIn)).membershipRoles).toEqual(['owner'])
      expect((await outcome(registering)).membershipRoles).toEqual(['owner'])
    })

    it('leaves an interrupted registration alone while its Organization is suspended, and finishes it once the suspension lifts', async () => {
      const fixture = await seedInvitation()
      const other = await seedInvitation()
      await interruptRegistration(fixture)
      await interruptRegistration(other)
      installPolicy({ BETA_SUSPENDED_ORGS: fixture.organizationId })
      const suspendedRun = recoveryJob(fixture)

      await suspendedRun.run()

      expect(await outcome(fixture)).toEqual({
        membershipRoles: [],
        invitationStatus: 'pending',
        accounts: 1,
        recoveryRecords: 1,
      })
      // The other Organization's registration was finished in the same pass.
      expect((await outcome(other)).membershipRoles).toEqual(['owner'])
      expect(suspendedRun.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ accepted: 1, denied: 1, failures: 0 }),
        'Invited registration recovery completed',
      )

      installPolicy({})
      now = new Date(START.getTime() + RECOVERY_INTERVAL_MS)
      await recoveryJob(fixture).run()

      expect(await outcome(fixture)).toEqual({
        membershipRoles: ['owner'],
        invitationStatus: 'accepted',
        accounts: 1,
        recoveryRecords: 0,
      })
    })

    it.each([
      ['the kill switch is on', { BETA_CAPABILITIES_OFF: 'all' }],
      ['identity.invite is switched off', { BETA_CAPABILITIES_OFF: 'identity.invite' }],
    ])('the recovery job accepts nothing while %s', async (_name, env) => {
      const fixture = await seedInvitation()
      await interruptRegistration(fixture)
      installPolicy(env)

      await recoveryJob(fixture).run()

      expect(await outcome(fixture)).toMatchObject({
        membershipRoles: [],
        invitationStatus: 'pending',
        recoveryRecords: 1,
      })
    })
  },
)

describe.sequential(
  'runbook §1: the invitations of a suspended Organization (integration)',
  () => {
    it("says what the gate does: the suspension refuses the app's own Cancel, so the operator cancels before lifting it", async () => {
      const fixture = await seedInvitation()
      const cancelInTheApp = () =>
        requireExecutionAllowed({
          actor: buildTestAuthContext({
            organizationId: toOrganizationId(fixture.organizationId),
            userId: userId(fixture.inviterId),
            role: 'AccountAdmin',
          }),
          action: 'invitation.cancel',
        })

      installPolicy({})
      await expect(cancelInTheApp()).resolves.toBeUndefined()
      installPolicy({ BETA_SUSPENDED_ORGS: fixture.organizationId })
      await expect(cancelInTheApp()).rejects.toMatchObject({
        code: 'org_suspended',
        status: 403,
      })

      expect(RUNBOOK_COMPROMISE).toContain('is refused with `org_suspended`')
      expect(RUNBOOK_COMPROMISE).toContain(
        'Before the Organization leaves `BETA_SUSPENDED_ORGS`',
      )
    })

    it('its statement cancels the open invitations the compromised account sent and nothing else, and they stay refused once the suspension lifts', async () => {
      const fixture = await seedInvitation()
      await insertAcceptor(fixture)
      const sent = {
        organizationId: fixture.organizationId,
        inviterId: fixture.inviterId,
      }
      const lapsed = await insertInvitation({ ...sent, status: 'expired' })
      const alreadyJoined = await insertInvitation({ ...sent, status: 'accepted' })
      const fromAnotherAdmin = await insertInvitation({
        organizationId: fixture.organizationId,
        inviterId: await insertAccountAdmin(fixture.organizationId),
        status: 'pending',
      })
      const inAnotherOrganization = await insertInvitation({
        organizationId: (await seedInvitation()).organizationId,
        inviterId: fixture.inviterId,
        status: 'pending',
      })
      installPolicy({ BETA_SUSPENDED_ORGS: fixture.organizationId })

      const cancelled = await cancelAsTheRunbookSays(fixture)

      expect(cancelled).toEqual([fixture.invitationId as string, lapsed].sort())
      expect(
        await invitationStatuses([
          alreadyJoined,
          fromAnotherAdmin,
          inAnotherOrganization,
        ]),
      ).toEqual(['accepted', 'pending', 'pending'])

      installPolicy({})
      await expect(
        build(fixture).useCases.acceptInvitation(acceptInput(fixture)),
      ).rejects.toSatisfy(isGone)
      expect(await outcome(fixture)).toMatchObject({
        membershipRoles: [],
        invitationStatus: 'canceled',
      })
    })

    it('recovery deletes the half-created account of a registration interrupted on an invitation cancelled that way, under the suspension too', async () => {
      const fixture = await seedInvitation()
      await interruptRegistration(fixture)
      installPolicy({ BETA_SUSPENDED_ORGS: fixture.organizationId })
      await cancelAsTheRunbookSays(fixture)
      const suspendedRun = recoveryJob(fixture)

      await suspendedRun.run()

      expect(await outcome(fixture)).toEqual({
        membershipRoles: [],
        invitationStatus: 'canceled',
        accounts: 0,
        recoveryRecords: 0,
      })
      expect(suspendedRun.logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ compensated: 1, denied: 0, failures: 0 }),
        'Invited registration recovery completed',
      )

      installPolicy({})
      const { useCases, signUp } = build(fixture)
      await expect(
        useCases.registerInvitedUser(registerInput(fixture)),
      ).rejects.toSatisfy(isGone)
      expect(signUp).not.toHaveBeenCalled()
    })
  },
)
