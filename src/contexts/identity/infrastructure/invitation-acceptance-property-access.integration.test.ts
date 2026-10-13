// Invited Property access against real PostgreSQL (R1B-04, R3B-03).
//
// The grants an invitation carries commit in the transaction that creates the
// membership. Each acceptance path (signed in, registration, recovery) is run
// through its real stores, with whatever follows the commit failing, and the
// member must still hold every invited Property.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { invitationId, userId, type InvitationId } from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import {
  identityInvitationAccepted,
  type IdentityInvitationAccepted,
} from '../domain/events'
import { acceptInvitation } from '../application/use-cases/accept-invitation'
import { registerInvitedUser } from '../application/use-cases/register-invited-user'
import { recoverInvitedRegistrations } from '../application/use-cases/recover-invited-registrations'
import { createAtomicIdentityCommandStore } from './identity-command-store'
import { createInvitationReadModel } from './invitation-read-model'
import { createInvitedRegistrationStore } from './invited-registration-store'

const NOW = new Date('2026-10-13T12:00:00.000Z')
const EXPIRES_AT = new Date('2026-10-20T12:00:00.000Z')
const PREFIX = 'invacc-integration-'
const HEADERS = new Headers()

let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  inviterId: string
  invitationId: InvitationId
  email: string
  acceptorId: string
  propertyIds: readonly [string, string]
}>

type GrantRow = Readonly<{ property_id: string; source: string; created_by: string }>

/**
 * An Organization with two Properties and a pending invitation naming both,
 * with `alsoInvited` between them: ids the invitation names besides those two.
 */
async function seedInvitation(alsoInvited: ReadonlyArray<string> = []): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `${PREFIX}org-${suffix}`,
    inviterId: `${PREFIX}inviter-${suffix}`,
    invitationId: invitationId(`${PREFIX}invitation-${suffix}`),
    email: `${PREFIX}${suffix}@example.com`,
    acceptorId: `${PREFIX}acceptor-${suffix}`,
    propertyIds: [randomUUID(), randomUUID()].sort() as [string, string],
  }
  await lease.pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Invited access', $1, $2)`,
    [fixture.organizationId, NOW],
  )
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Inviter', $2, true, $3, $3)`,
    [fixture.inviterId, `${fixture.inviterId}@example.com`, NOW],
  )
  await lease.pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, 'owner', $4)`,
    [`${PREFIX}member-${suffix}`, fixture.organizationId, fixture.inviterId, NOW],
  )
  for (const [index, propertyId] of fixture.propertyIds.entries()) {
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, $3, $3, 'UTC')`,
      [propertyId, fixture.organizationId, `invacc-${index}-${suffix}`],
    )
  }
  await lease.pool.query(
    `INSERT INTO invitation (
       id, "organizationId", email, role, status, "expiresAt", "propertyIds",
       "inviterId", "createdAt"
     ) VALUES ($1, $2, $3, 'admin', 'pending', $4, $5, $6, $7)`,
    [
      fixture.invitationId as string,
      fixture.organizationId,
      fixture.email,
      EXPIRES_AT,
      JSON.stringify([fixture.propertyIds[0], ...alsoInvited, fixture.propertyIds[1]]),
      fixture.inviterId,
      NOW,
    ],
  )
  return fixture
}

/** The account a signed-in invitee already has, or the one sign-up creates. */
async function insertAcceptor(
  fixture: Fixture,
  accountId: string | null = null,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Invitee', $2, false, $3, $3)`,
    [fixture.acceptorId, fixture.email, NOW],
  )
  if (accountId === null) return
  await lease.pool.query(
    `INSERT INTO account (
       id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
     ) VALUES ($1, $2, 'credential', $2, 'test-only-hash', $3, $3)`,
    [accountId, fixture.acceptorId, NOW],
  )
}

async function activeGrants(fixture: Fixture): Promise<ReadonlyArray<GrantRow>> {
  const rows = await lease.pool.query<GrantRow>(
    `SELECT property_id::text AS property_id, source, created_by
       FROM property_access_grant
      WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL
      ORDER BY property_id`,
    [fixture.organizationId, fixture.acceptorId],
  )
  return rows.rows
}

async function membershipRoles(fixture: Fixture): Promise<ReadonlyArray<string>> {
  const rows = await lease.pool.query<{ role: string }>(
    `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
    [fixture.organizationId, fixture.acceptorId],
  )
  return rows.rows.map((row) => row.role)
}

const invitationGrant = (fixture: Fixture, propertyId: string): GrantRow => ({
  property_id: propertyId,
  source: 'invitation',
  created_by: fixture.inviterId,
})

const invitedGrants = (fixture: Fixture): ReadonlyArray<GrantRow> =>
  fixture.propertyIds.map((propertyId) => invitationGrant(fixture, propertyId))

async function cleanFixtures(): Promise<void> {
  await lease.pool.query(
    `DELETE FROM verification WHERE identifier LIKE 'invited-registration:${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM outbox_events WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(
    `DELETE FROM property_access_grant WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await lease.pool.query(`DELETE FROM properties WHERE organization_id LIKE '${PREFIX}%'`)
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

const commandStore = () => createAtomicIdentityCommandStore(db, randomUUID)

/** Capability policy is open here; invitation-capability-gate covers the stops. */
const authorizeOrganization = async () => true
const admission = () => ({
  invitations: createInvitationReadModel(db),
  authorizeOrganization,
})

/**
 * Accept straight through the command store, as every acceptance path does.
 * `factTag` swaps in a fact type the outbox does not know, so the last write
 * of the transaction fails.
 */
const accept = (fixture: Fixture, factTag?: string) =>
  commandStore().acceptInvitation({
    invitationId: fixture.invitationId,
    acceptorEmail: fixture.email,
    acceptorUserId: userId(fixture.acceptorId),
    now: NOW,
    buildEvent: (accepted) => {
      const fact = identityInvitationAccepted({
        organizationId: accepted.organizationId,
        userId: userId(fixture.acceptorId),
        invitationId: fixture.invitationId,
        propertyIds: accepted.propertyIds,
        occurredAt: NOW,
      })
      return factTag === undefined
        ? fact
        : ({ ...fact, _tag: factTag } as unknown as IdentityInvitationAccepted)
    },
  })

async function insertGrant(
  fixture: Fixture,
  propertyId: string,
  expiresAt: Date | null,
): Promise<void> {
  await lease.pool.query(
    `INSERT INTO property_access_grant
       (organization_id, property_id, user_id, source, created_by, expires_at)
     VALUES ($1, $2, $3, 'operator', 'earlier-admin', $4)`,
    [fixture.organizationId, propertyId, fixture.acceptorId, expiresAt],
  )
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

describe.sequential('invited Property access (integration)', () => {
  it('grants the invited Properties in the transaction that creates the membership', async () => {
    const fixture = await seedInvitation()
    await insertAcceptor(fixture)

    const acceptance = await accept(fixture)

    expect(acceptance.ungrantedPropertyIds).toEqual([])
    expect(await membershipRoles(fixture)).toEqual(['admin'])
    // Each grant records who sent the invitation as its creator.
    expect(await activeGrants(fixture)).toEqual(invitedGrants(fixture))
  })

  it('rolls the grants back with the membership when the fact insert fails', async () => {
    const fixture = await seedInvitation()
    await insertAcceptor(fixture)

    await expect(accept(fixture, 'identity.invitation.ghost')).rejects.toThrow(
      /Event type identity\.invitation\.ghost:v\d+ is not registered for the outbox/,
    )

    expect(await membershipRoles(fixture)).toEqual([])
    expect(await activeGrants(fixture)).toEqual([])
  })

  it('accepts with the valid siblings of a stale selection and names what it could not grant', async () => {
    const otherOrganization = await seedInvitation()
    const foreignPropertyId = otherOrganization.propertyIds[0]
    const deletedPropertyId = randomUUID()
    const unknownPropertyId = randomUUID()
    const stale = ['prop-a', deletedPropertyId, foreignPropertyId, unknownPropertyId]
    const fixture = await seedInvitation(stale)
    await insertAcceptor(fixture)
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, deleted_at)
       VALUES ($1, $2, 'invacc-deleted', 'invacc-deleted', 'UTC', $3)`,
      [deletedPropertyId, fixture.organizationId, NOW],
    )

    const acceptance = await accept(fixture)

    expect([...acceptance.ungrantedPropertyIds].sort()).toEqual([...stale].sort())
    expect(await membershipRoles(fixture)).toEqual(['admin'])
    expect(await activeGrants(fixture)).toEqual(invitedGrants(fixture))
  })

  it('keeps a grant the invitee still holds and replaces one that lapsed', async () => {
    const fixture = await seedInvitation()
    await insertAcceptor(fixture)
    const [held, lapsed] = fixture.propertyIds
    await insertGrant(fixture, held, null)
    await insertGrant(fixture, lapsed, new Date(NOW.getTime() - 60_000))

    const acceptance = await accept(fixture)

    expect(acceptance.ungrantedPropertyIds).toEqual([])
    expect(await activeGrants(fixture)).toEqual(
      [
        { property_id: held, source: 'operator', created_by: 'earlier-admin' },
        invitationGrant(fixture, lapsed),
      ].sort((a, b) => a.property_id.localeCompare(b.property_id)),
    )
  })

  it('leaves a signed-in acceptor with the invited Properties when the session call fails', async () => {
    const fixture = await seedInvitation()
    await insertAcceptor(fixture)
    const identity = createInMemoryIdentityPort()
    identity.setSessionUser({ id: fixture.acceptorId, email: fixture.email })
    const acceptSignedIn = acceptInvitation({
      ...admission(),
      identity: {
        ...identity,
        setActiveOrganization: () => Promise.reject(new Error('session store down')),
      },
      commandStore: commandStore(),
      clock: () => NOW,
      logger: { error: vi.fn() },
    })
    const input = {
      invitationId: fixture.invitationId,
      headers: HEADERS,
      userId: userId(fixture.acceptorId),
    }

    await expect(acceptSignedIn(input)).rejects.toThrow('session store down')

    // The membership committed and the invitation cannot be accepted again.
    expect(await membershipRoles(fixture)).toEqual(['admin'])
    await expect(acceptSignedIn(input)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'invitation_not_found',
    )
    expect(await activeGrants(fixture)).toEqual(invitedGrants(fixture))
  })

  it('leaves a registered invitee with the invited Properties and nothing to retry', async () => {
    const fixture = await seedInvitation()
    const registrationStore = createInvitedRegistrationStore(db)
    const ids = [randomUUID(), fixture.acceptorId, `${fixture.acceptorId}-account`]
    const register = registerInvitedUser({
      ...admission(),
      commandStore: commandStore(),
      registrationStore,
      signUp: async (_name, _email, _password, authIds) => {
        await insertAcceptor(fixture, authIds.credentialAccountId)
        return authIds.userId
      },
      idGen: () => ids.shift() ?? randomUUID(),
      clock: () => NOW,
      logger: { error: vi.fn() },
    })

    await expect(
      register({
        invitationId: fixture.invitationId,
        name: 'Invitee',
        email: fixture.email,
        password: 'a-safe-test-password',
      }),
    ).resolves.toEqual({ organizationId: fixture.organizationId })

    // The recovery record is gone, and nothing is left for it to do.
    expect(await membershipRoles(fixture)).toEqual(['admin'])
    const retryAt = new Date(NOW.getTime() + 60 * 60_000)
    expect(
      await registrationStore.claimDue({
        now: retryAt,
        claimExpiresAt: new Date(retryAt.getTime() + 60_000),
        limit: 100,
      }),
    ).toEqual([])
    expect(await activeGrants(fixture)).toEqual(invitedGrants(fixture))
  })

  it('leaves a recovered registration with the invited Properties', async () => {
    const fixture = await seedInvitation()
    const registrationStore = createInvitedRegistrationStore(db)
    const accountId = `${fixture.acceptorId}-account`
    await registrationStore.prepare({
      proposedVerificationId: randomUUID(),
      invitationId: fixture.invitationId,
      email: fixture.email,
      proposedAuthIds: {
        userId: fixture.acceptorId,
        credentialAccountId: accountId,
        initialSessionId: `${fixture.acceptorId}-session`,
      },
      now: NOW,
      nextRecoveryAt: NOW,
    })
    // The foreground request died between sign-up and acceptance.
    await insertAcceptor(fixture, accountId)
    const recover = recoverInvitedRegistrations({
      commandStore: commandStore(),
      registrationStore,
      clock: () => NOW,
      logger: { error: vi.fn() },
    })

    await expect(recover({ authorizeOrganization })).resolves.toMatchObject({
      accepted: 1,
      failures: 0,
    })

    expect(await membershipRoles(fixture)).toEqual(['admin'])
    expect(await activeGrants(fixture)).toEqual(invitedGrants(fixture))
  })
})
