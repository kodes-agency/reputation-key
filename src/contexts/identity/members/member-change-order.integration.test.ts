// Member role changes, removal and invitation acceptance against real
// PostgreSQL: what commits together, what a concurrent command sees, and what
// is released afterwards from the committed fact.
//
// Races are staged with a held lock: a separate connection takes the row or
// advisory lock a command needs, the command is started, the test waits until
// PostgreSQL reports it waiting on that lock, and only then lets it go. No
// timing assumption decides the order.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PoolClient } from 'pg'
import type { Database } from '#/shared/db/index'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createConsumerRegistry, type ConsumerEvent } from '#/shared/outbox'
import { invitationId, organizationId, userId } from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import {
  identityInvitationAccepted,
  identityMemberRemoved,
  identityMemberRoleChanged,
  type IdentityMemberRemoved,
} from '../domain/events'
import { createAtomicIdentityCommandStore } from '../infrastructure/identity-command-store'
import { createBetterAuthIdentityAdapter } from '../infrastructure/adapters/auth-identity.adapter'
import { registerMemberRoleConsumers } from '../infrastructure/member-role-outbox-consumers'
import {
  MEMBER_ROLE_CLEANUP_CONSUMER,
  roleChangeCleanup,
} from './member-role-cleanup.server'
import { updateMemberRole } from './update-member-role.server'
import { removeMember } from './remove-member.server'
import { registerMemberDepartureConsumers } from '#/contexts/integration/infrastructure/member-departure-outbox-consumers'
import { createActiveMemberAuthResolver } from '#/contexts/integration/infrastructure/active-member-auth.adapter'
import { createGoogleConnectorDepartureStore } from '#/contexts/integration/infrastructure/google-connector-departure.store'
import { prepareGoogleConnectorDeparture } from '#/contexts/integration/application/use-cases/prepare-google-connector-departure'

const PREFIX = 'mco-integration-'
const NOW = new Date('2026-11-11T12:00:00.000Z')
const EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z')

let lease: TestLease
let db: Database

type Fixture = Readonly<{
  organizationId: string
  adminA: string
  adminB: string
  manager: string
  managerEmail: string
  managerMemberId: string
  propertyId: string
}>

const memberRowId = (fixture: Fixture, user: string) =>
  `${fixture.organizationId}:${user}`

async function seed(): Promise<Fixture> {
  const suffix = randomUUID()
  const fixture: Fixture = {
    organizationId: `${PREFIX}org-${suffix}`,
    adminA: `${PREFIX}admin-a-${suffix}`,
    adminB: `${PREFIX}admin-b-${suffix}`,
    manager: `${PREFIX}manager-${suffix}`,
    managerEmail: `${PREFIX}manager-${suffix}@example.com`,
    managerMemberId: `${PREFIX}org-${suffix}:${PREFIX}manager-${suffix}`,
    propertyId: randomUUID(),
  }
  const { pool } = lease
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Member order', $1, $2)`,
    [fixture.organizationId, NOW],
  )
  for (const [user, email] of [
    [fixture.adminA, `${fixture.adminA}@example.com`],
    [fixture.adminB, `${fixture.adminB}@example.com`],
    [fixture.manager, fixture.managerEmail],
  ] as const) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, 'Person', $2, true, $3, $3)`,
      [user, email, NOW],
    )
  }
  for (const [user, role] of [
    [fixture.adminA, 'owner'],
    [fixture.adminB, 'owner'],
    [fixture.manager, 'admin'],
  ] as const) {
    await insertMember(fixture, user, role)
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, $3, $3, 'UTC')`,
    [fixture.propertyId, fixture.organizationId, `mco-${suffix}`],
  )
  await insertGrant(fixture)
  await insertSession(fixture, `${PREFIX}session-${suffix}`)
  return fixture
}

async function insertMember(fixture: Fixture, user: string, role: string): Promise<void> {
  await lease.pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, $4, $5)`,
    [memberRowId(fixture, user), fixture.organizationId, user, role, NOW],
  )
}

async function insertGrant(fixture: Fixture): Promise<void> {
  await lease.pool.query(
    `INSERT INTO property_access_grant
       (organization_id, property_id, user_id, source, created_by)
     VALUES ($1, $2, $3, 'operator', $4)`,
    [fixture.organizationId, fixture.propertyId, fixture.manager, fixture.adminA],
  )
}

async function insertSession(fixture: Fixture, id: string): Promise<void> {
  await lease.pool.query(
    `INSERT INTO session
       (id, "expiresAt", token, "userId", "activeOrganizationId", "createdAt", "updatedAt")
     VALUES ($1, $2, $1, $3, $4, $5, $5)`,
    [id, EXPIRES_AT, fixture.manager, fixture.organizationId, NOW],
  )
}

async function insertConnection(fixture: Fixture, connectorUserId: string) {
  const id = randomUUID()
  await lease.pool.query(
    `INSERT INTO google_connections (
       id, organization_id, google_subject, encrypted_access_token,
       encrypted_refresh_token, token_expires_at, scopes, connected_by
     ) VALUES (
       $1::uuid, $2, $3, 'encrypted-access', 'encrypted-refresh',
       NOW() + interval '1 hour',
       ARRAY['https://www.googleapis.com/auth/business.manage']::text[], $4
     )`,
    [id, fixture.organizationId, `subject-${id}`, connectorUserId],
  )
  return id
}

async function cleanFixtures(): Promise<void> {
  const { pool } = lease
  await pool.query(
    `DELETE FROM google_connections WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await pool.query(`DELETE FROM session WHERE "userId" LIKE '${PREFIX}%'`)
  await pool.query(`DELETE FROM outbox_events WHERE organization_id LIKE '${PREFIX}%'`)
  await pool.query(
    `DELETE FROM property_access_grant WHERE organization_id LIKE '${PREFIX}%'`,
  )
  await pool.query(`DELETE FROM properties WHERE organization_id LIKE '${PREFIX}%'`)
  await pool.query(`DELETE FROM invitation WHERE "organizationId" LIKE '${PREFIX}%'`)
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query(`DELETE FROM member WHERE "organizationId" LIKE '${PREFIX}%'`)
    const organizations = await client.query<{ id: string }>(
      `SELECT id FROM organization WHERE id LIKE '${PREFIX}%'`,
    )
    await deleteTestOrganizations(
      client,
      organizations.rows.map(({ id }) => id),
    )
  })
  await pool.query(`DELETE FROM "user" WHERE id LIKE '${PREFIX}%'`)
}

const store = () => createAtomicIdentityCommandStore(db, randomUUID)

const removalFact = (fixture: Fixture, removedBy = fixture.adminA) =>
  identityMemberRemoved({
    organizationId: organizationId(fixture.organizationId),
    userId: userId(fixture.manager),
    removedBy: userId(removedBy),
    occurredAt: NOW,
  })

const removeManager = (
  fixture: Fixture,
  actor = fixture.adminA,
  event = removalFact(fixture, actor),
) =>
  store().removeMember({
    organizationId: organizationId(fixture.organizationId),
    memberId: fixture.managerMemberId,
    actorUserId: actor,
    event,
  })

const demote = (fixture: Fixture, target: string, actor: string) =>
  store().changeMemberRole({
    organizationId: organizationId(fixture.organizationId),
    memberId: memberRowId(fixture, target),
    actorUserId: actor,
    newRole: 'admin',
    event: identityMemberRoleChanged({
      organizationId: organizationId(fixture.organizationId),
      memberUserId: userId(target),
      previousRole: 'AccountAdmin',
      newRole: 'PropertyManager',
      userId: userId(actor),
      occurredAt: NOW,
    }),
  })

type ManagerState = Readonly<{
  members: number
  sessions: number
  activeGrants: number
  removalFacts: number
}>

async function managerState(fixture: Fixture): Promise<ManagerState> {
  const row = await lease.pool.query<ManagerState>(
    `SELECT
       (SELECT COUNT(*)::int FROM member
         WHERE "organizationId" = $1 AND "userId" = $2) AS members,
       (SELECT COUNT(*)::int FROM session WHERE "userId" = $2) AS sessions,
       (SELECT COUNT(*)::int FROM property_access_grant
         WHERE organization_id = $1 AND user_id = $2 AND revoked_at IS NULL)
         AS "activeGrants",
       (SELECT COUNT(*)::int FROM outbox_events
         WHERE organization_id = $1 AND event_type = 'identity.member.removed')
         AS "removalFacts"`,
    [fixture.organizationId, fixture.manager],
  )
  return row.rows[0]!
}

async function roleOf(fixture: Fixture, user: string): Promise<string | null> {
  const rows = await lease.pool.query<{ role: string }>(
    `SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
    [fixture.organizationId, user],
  )
  return rows.rows[0]?.role ?? null
}

/** Hold a lock on its own connection until `release` commits it. */
async function holdLock(sql: string, params: ReadonlyArray<unknown>) {
  const client: PoolClient = await lease.pool.connect()
  await client.query('BEGIN')
  await client.query(sql, [...params])
  return {
    client,
    release: async () => {
      await client.query('COMMIT')
      client.release()
    },
  }
}

/** Resolve once `count` other backends wait on a lock in this database. */
async function lockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await lease.pool.query<{ waiting: number }>(
      `SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    )
    if ((rows.rows[0]?.waiting ?? 0) >= count) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Expected ${count} lock waiter(s)`)
}

const deliver = async (
  register: (registry: ReturnType<typeof createConsumerRegistry>) => void,
  eventType: string,
  fixture: Fixture,
) => {
  const rows = await lease.pool.query<{
    id: string
    event_version: number
    payload: Record<string, unknown>
  }>(
    `SELECT id, event_version, payload FROM outbox_events
      WHERE organization_id = $1 AND event_type = $2
      ORDER BY created_at DESC LIMIT 1`,
    [fixture.organizationId, eventType],
  )
  const row = rows.rows[0]!
  const event: ConsumerEvent = {
    eventId: row.id,
    eventType,
    eventVersion: row.event_version,
    organizationId: fixture.organizationId,
    propertyId: null,
    sourceContext: 'identity',
    sourceAggregateId: fixture.manager,
    occurredAt: NOW.toISOString(),
    payload: row.payload,
  }
  const registry = createConsumerRegistry()
  register(registry)
  return Promise.all(
    registry.listFor(eventType).map((consumer) => consumer.handler(event)),
  )
}

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 6)
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

describe.sequential('member removal (row 1, row 3)', () => {
  it('commits sessions, grants, membership and the fact together', async () => {
    const fixture = await seed()

    await removeManager(fixture)

    expect(await managerState(fixture)).toEqual({
      members: 0,
      sessions: 0,
      activeGrants: 0,
      removalFacts: 1,
    })
  })

  it('rolls all of it back when the fact cannot commit', async () => {
    const fixture = await seed()
    const unknownFact = {
      ...removalFact(fixture),
      _tag: 'identity.member.unknown',
    } as unknown as IdentityMemberRemoved

    await expect(removeManager(fixture, fixture.adminA, unknownFact)).rejects.toThrow(
      /Event type identity\.member\.unknown:v\d+ is not registered for the outbox/,
    )

    expect(await managerState(fixture)).toEqual({
      members: 1,
      sessions: 1,
      activeGrants: 1,
      removalFacts: 0,
    })
  })

  it('refuses an actor whose demotion commits while the removal waits, with no writes', async () => {
    const fixture = await seed()
    const demotion = await holdLock(
      `UPDATE member SET role = 'admin' WHERE "organizationId" = $1 AND "userId" = $2`,
      [fixture.organizationId, fixture.adminA],
    )

    const removal = removeManager(fixture).then(
      () => null,
      (error: unknown) => error,
    )
    await lockWaiters(1)
    await demotion.release()

    expect(await removal).toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )
    expect(await managerState(fixture)).toEqual({
      members: 1,
      sessions: 1,
      activeGrants: 1,
      removalFacts: 0,
    })
  })

  it("fences the removed member's Google connection in the removal's own commit", async () => {
    const fixture = await seed()
    const connection = await insertConnection(fixture, fixture.manager)

    await removeManager(fixture)

    const rows = await lease.pool.query(
      `SELECT status, status_reason FROM google_connections WHERE id = $1`,
      [connection],
    )
    expect(rows.rows).toEqual([
      { status: 'reauth_required', status_reason: 'connector_departure_member_removed' },
    ])
  })

  it('keeps an acceptance of a new invitation waiting until the removal commits, then admits it', async () => {
    const fixture = await seed()
    const invitation = invitationId(`${PREFIX}invitation-${randomUUID()}`)
    await lease.pool.query(
      `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       VALUES ($1, $2, $3, 'admin', 'pending', $4, $5, $6)`,
      [
        invitation,
        fixture.organizationId,
        fixture.managerEmail,
        EXPIRES_AT,
        fixture.adminA,
        NOW,
      ],
    )
    const membershipLock = await holdLock(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`user-organization-membership:${fixture.manager}`],
    )

    const removal = removeManager(fixture)
    await lockWaiters(1)
    const acceptance = store().acceptInvitation({
      invitationId: invitation,
      acceptorEmail: fixture.managerEmail,
      acceptorUserId: userId(fixture.manager),
      now: NOW,
      buildEvent: (accepted) =>
        identityInvitationAccepted({
          organizationId: accepted.organizationId,
          userId: userId(fixture.manager),
          invitationId: invitation,
          propertyIds: accepted.propertyIds,
          occurredAt: NOW,
        }),
    })
    await lockWaiters(2)
    await membershipLock.release()

    await expect(removal).resolves.toBeUndefined()
    await expect(acceptance).resolves.toMatchObject({
      organizationId: fixture.organizationId,
    })
    const state = await managerState(fixture)
    expect(state.members).toBe(1)
    expect(state.removalFacts).toBe(1)
  })

  it("releases Google authority from the fact, and leaves a later membership's connection alone", async () => {
    const fixture = await seed()
    const oldConnection = await insertConnection(fixture, fixture.manager)
    await removeManager(fixture)
    // Invited again and back before the fact is delivered, with a connection
    // of their own.
    await insertMember(fixture, fixture.manager, 'owner')
    await insertSession(fixture, `${PREFIX}session-later-${randomUUID()}`)
    const laterConnection = await insertConnection(fixture, fixture.manager)
    const cancelImportsForUser = vi.fn(async () => undefined)
    const cancelImportsForConnection = vi.fn(async () => undefined)

    const outcomes = await deliver(
      (registry) =>
        registerMemberDepartureConsumers(registry, {
          prepareDeparture: prepareGoogleConnectorDeparture({
            store: createGoogleConnectorDepartureStore(db),
            cancelGoogleImportsForConnection: cancelImportsForConnection,
            clock: () => NOW,
          }),
          cancelImportsForUser,
          resolveActiveMember: createActiveMemberAuthResolver(db),
          receipts: { insertReceipt: async () => undefined },
        }),
      'identity.member.removed',
      fixture,
    )

    expect(outcomes).toEqual([{ status: 'obsolete' }])
    expect(cancelImportsForUser).not.toHaveBeenCalled()
    const rows = await lease.pool.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM google_connections WHERE organization_id = $1 ORDER BY id`,
      [fixture.organizationId],
    )
    expect(Object.fromEntries(rows.rows.map((row) => [row.id, row.status]))).toEqual({
      [oldConnection]: 'reauth_required',
      [laterConnection]: 'active',
    })
    const state = await managerState(fixture)
    expect(state.members).toBe(1)
    expect(state.sessions).toBe(1)
  })

  it('fences and cancels from the fact when the member stays removed', async () => {
    const fixture = await seed()
    await removeManager(fixture)
    const cancelImportsForUser = vi.fn(async () => undefined)

    const outcomes = await deliver(
      (registry) =>
        registerMemberDepartureConsumers(registry, {
          prepareDeparture: prepareGoogleConnectorDeparture({
            store: createGoogleConnectorDepartureStore(db),
            cancelGoogleImportsForConnection: async () => undefined,
            clock: () => NOW,
          }),
          cancelImportsForUser,
          resolveActiveMember: createActiveMemberAuthResolver(db),
          receipts: { insertReceipt: async () => undefined },
        }),
      'identity.member.removed',
      fixture,
    )

    expect(outcomes).toEqual([{ status: 'applied' }])
    expect(cancelImportsForUser).toHaveBeenCalledWith(
      fixture.organizationId,
      fixture.manager,
    )
  })
})

describe.sequential('member role changes (rows 1 and 2)', () => {
  it('refuses the last AccountAdmin demotion without a write', async () => {
    const fixture = await seed()
    await demote(fixture, fixture.adminB, fixture.adminA)

    await expect(demote(fixture, fixture.adminA, fixture.adminA)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'last_owner',
    )

    expect(await roleOf(fixture, fixture.adminA)).toBe('owner')
    const facts = await lease.pool.query(
      `SELECT COUNT(*)::int AS n FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'identity.member.role_changed'`,
      [fixture.organizationId],
    )
    expect(facts.rows[0].n).toBe(1)
  })

  it('commits role, permission version and one fact together', async () => {
    const fixture = await seed()
    const versionOf = async () =>
      Number(
        (
          await lease.pool.query<{ version: string }>(
            `SELECT version::text FROM permission_version WHERE organization_id = $1`,
            [fixture.organizationId],
          )
        ).rows[0]?.version ?? 0,
      )

    const before = await versionOf()
    await demote(fixture, fixture.adminB, fixture.adminA)

    expect(await roleOf(fixture, fixture.adminB)).toBe('admin')
    expect(await versionOf()).toBeGreaterThan(before)
  })

  it('refuses an admitted actor demoted while its own command waits', async () => {
    const fixture = await seed()
    const demotion = await holdLock(
      `UPDATE member SET role = 'admin' WHERE "organizationId" = $1 AND "userId" = $2`,
      [fixture.organizationId, fixture.adminA],
    )

    const change = demote(fixture, fixture.adminB, fixture.adminA).then(
      () => null,
      (error: unknown) => error,
    )
    await lockWaiters(1)
    await demotion.release()

    expect(await change).toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )
    expect(await roleOf(fixture, fixture.adminB)).toBe('owner')
  })

  it('resumes a failed cleanup when the same request is sent again, and reports success only then', async () => {
    const fixture = await seed()
    let attempts = 0
    const reconcile = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('reconcile unavailable')
    })
    const commandStore = store()
    const cleanup = roleChangeCleanup({
      commandStore,
      reconcileResponsibleManagerEligibility: reconcile,
    })
    const useCase = updateMemberRole({
      identity: createBetterAuthIdentityAdapter(db),
      commandStore,
      clock: () => NOW,
      cleanup,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      userId: userId(fixture.adminA),
      organizationId: organizationId(fixture.organizationId),
    })
    const input = {
      memberId: memberRowId(fixture, fixture.adminB),
      role: 'PropertyManager' as const,
    }

    await expect(useCase(input, ctx)).rejects.toThrow('reconcile unavailable')
    expect(await roleOf(fixture, fixture.adminB)).toBe('admin')

    await expect(useCase(input, ctx)).resolves.toEqual({ success: true })
    expect(reconcile).toHaveBeenCalledTimes(2)
    const receipts = await lease.pool.query(
      `SELECT r.status FROM event_consumer_receipts r
         JOIN outbox_events e ON e.id = r.event_id
        WHERE e.organization_id = $1 AND r.consumer_name = $2`,
      [fixture.organizationId, MEMBER_ROLE_CLEANUP_CONSUMER],
    )
    expect(receipts.rows).toEqual([{ status: 'applied' }])

    // Done: the same request is an ordinary no-op again.
    await expect(useCase(input, ctx)).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'validation_error',
    )
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('lets the durable consumer finish a cleanup the request never reached', async () => {
    const fixture = await seed()
    await demote(fixture, fixture.adminB, fixture.adminA)
    const reconcile = vi.fn(async () => undefined)
    const commandStore = store()

    await deliver(
      (registry) =>
        registerMemberRoleConsumers(registry, {
          cleanup: roleChangeCleanup({
            commandStore,
            reconcileResponsibleManagerEligibility: reconcile,
          }),
        }),
      'identity.member.role_changed',
      fixture,
    )

    expect(reconcile).toHaveBeenCalledWith(
      fixture.organizationId,
      fixture.adminB,
      fixture.adminA,
    )
    expect(
      await commandStore.pendingRoleChangeCleanup({
        organizationId: organizationId(fixture.organizationId),
        memberUserId: fixture.adminB,
      }),
    ).toBeNull()
  })
})

describe.sequential('removal through the use case (row 3)', () => {
  it('removes a manager with no other step before or after the commit', async () => {
    const fixture = await seed()
    const useCase = removeMember({
      identity: createBetterAuthIdentityAdapter(db),
      commandStore: store(),
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      userId: userId(fixture.adminA),
      organizationId: organizationId(fixture.organizationId),
    })

    await expect(useCase({ memberId: fixture.managerMemberId }, ctx)).resolves.toEqual({
      success: true,
    })
    expect(await managerState(fixture)).toEqual({
      members: 0,
      sessions: 0,
      activeGrants: 0,
      removalFacts: 1,
    })
  })
})
