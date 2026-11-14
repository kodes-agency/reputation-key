// Real-PostgreSQL fixtures for the Identity members use-case tests.
//
// Seeds and reads the better-auth organization, user, member and invitation
// rows, the live Properties and Property access grants, and the outbox facts a
// command committed, so a use case runs against the atomic identity command
// store the application ships. Rows are removed after each test by the
// Organizations and users the test seeded.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { getDb, type Database } from '#/shared/db/index'
import { getEnv } from '#/shared/config/env'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { IdentityCommandStore } from '#/contexts/identity/application/ports/identity-command-store.port'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

export type StoredInvitation = Readonly<{
  id: string
  organizationId: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  propertyIds: string | null
  inviterId: string | null
  createdAt: Date
}>

export type StoredMember = Readonly<{
  id: string
  organizationId: string
  userId: string
  email: string
  role: string
  createdAt: Date
}>

export type StoredUser = Readonly<{
  id: string
  email: string
  emailVerified: boolean
}>

export type StoredPropertyGrant = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  source: string
  createdBy: string | null
}>

/** A committed outbox fact: its type tag and the stored, identifier-only payload. */
export type CommittedFact = Readonly<{
  tag: string
  payload: Readonly<Record<string, unknown>>
}>

export type IdentityMembersDb = Readonly<{
  db: () => Database
  store: () => IdentityCommandStore
  seedOrganization: (organizationId: string) => Promise<void>
  seedUser: (row: StoredUser) => Promise<void>
  seedMember: (row: StoredMember) => Promise<void>
  seedInvitation: (row: StoredInvitation) => Promise<void>
  /** A live Property of an Organization; an acceptance grants only these. */
  seedProperty: (organizationId: string, propertyId: string) => Promise<void>
  invitationById: (id: string) => Promise<StoredInvitation | null>
  memberById: (id: string) => Promise<StoredMember | null>
  allInvitations: () => Promise<ReadonlyArray<StoredInvitation>>
  allMembers: () => Promise<ReadonlyArray<StoredMember>>
  allPropertyGrants: () => Promise<ReadonlyArray<StoredPropertyGrant>>
  /** Seeded users whose email is verified. */
  verifiedUserIds: () => Promise<ReadonlyArray<string>>
  facts: () => Promise<ReadonlyArray<CommittedFact>>
  factsByTag: (tag: string) => Promise<ReadonlyArray<CommittedFact>>
}>

type InvitationRow = {
  id: string
  organizationId: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  propertyIds: string | null
  inviterId: string | null
  createdAt: Date
}

/**
 * Open a lease on the test database for the file and clean up what each test
 * seeded. Call once at the top of a test file.
 */
export function setupIdentityMembersDb(
  createStore: (db: Database, idGen: () => string) => IdentityCommandStore,
): IdentityMembersDb {
  let lease: TestLease
  let db: Database
  const organizations = new Set<string>()
  const users = new Set<string>()

  const pool = () => lease.pool

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL, 3)
    db = getDb()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  afterEach(async () => {
    const orgIds = [...organizations]
    const userIds = [...users]
    organizations.clear()
    users.clear()
    await cleanup(pool(), orgIds, userIds)
  })

  afterAll(async () => {
    clearEventSchemas()
    await lease?.release()
  })

  const seedOrganization = async (organizationId: string) => {
    organizations.add(organizationId)
    await pool().query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [organizationId, `Identity Members ${organizationId}`, `im-${organizationId}`],
    )
  }

  const seedUser = async (row: StoredUser) => {
    users.add(row.id)
    await pool().query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, $3, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET email = $2, "emailVerified" = $3`,
      [row.id, row.email, row.emailVerified],
    )
  }

  const seedUserIfAbsent = async (id: string, email: string) => {
    users.add(id)
    await pool().query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, false, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [id, email],
    )
  }

  const toInvitation = (row: InvitationRow): StoredInvitation => ({ ...row })

  const toMember = (row: {
    id: string
    organizationId: string
    userId: string
    email: string | null
    role: string
    createdAt: Date
  }): StoredMember => ({ ...row, email: row.email ?? '' })

  const memberSelect = `SELECT m.id, m."organizationId", m."userId", u.email, m.role, m."createdAt"
       FROM member m LEFT JOIN "user" u ON u.id = m."userId"`

  const tracked = () => [...organizations]

  return {
    db: () => db,
    store: () => createStore(db, randomUUID),
    seedOrganization,
    seedUser,
    seedMember: async (row) => {
      await seedOrganization(row.organizationId)
      await seedUserIfAbsent(row.userId, row.email)
      // A fixture may restate a member under a role the last-owner backstop
      // would refuse to write in production.
      await withLastOwnerGuardDisabled(pool(), async (client) => {
        await client.query(
          `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET role = $4`,
          [row.id, row.organizationId, row.userId, row.role, row.createdAt],
        )
      })
    },
    seedInvitation: async (row) => {
      await seedOrganization(row.organizationId)
      if (row.inviterId !== null) {
        await seedUserIfAbsent(row.inviterId, `${row.inviterId}@inviter.test`)
      }
      await pool().query(
        `INSERT INTO invitation
           (id, "organizationId", email, role, status, "expiresAt", "propertyIds",
            "inviterId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE
           SET status = $5, "expiresAt" = $6, role = $4, "propertyIds" = $7`,
        [
          row.id,
          row.organizationId,
          row.email,
          row.role,
          row.status,
          row.expiresAt,
          row.propertyIds,
          row.inviterId,
          row.createdAt,
        ],
      )
    },
    seedProperty: async (organizationId, propertyId) => {
      await seedOrganization(organizationId)
      await pool().query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1, $2, $3, $3, 'UTC')
         ON CONFLICT (id) DO NOTHING`,
        [propertyId, organizationId, `im-${propertyId}`],
      )
    },
    invitationById: async (id) => {
      const { rows } = await pool().query<InvitationRow>(
        `SELECT id, "organizationId", email, role, status, "expiresAt", "propertyIds",
                "inviterId", "createdAt"
           FROM invitation WHERE id = $1`,
        [id],
      )
      return rows[0] ? toInvitation(rows[0]) : null
    },
    memberById: async (id) => {
      const { rows } = await pool().query(`${memberSelect} WHERE m.id = $1`, [id])
      return rows[0] ? toMember(rows[0]) : null
    },
    allInvitations: async () => {
      const { rows } = await pool().query<InvitationRow>(
        `SELECT id, "organizationId", email, role, status, "expiresAt", "propertyIds",
                "inviterId", "createdAt"
           FROM invitation WHERE "organizationId" = ANY($1) ORDER BY "createdAt", id`,
        [tracked()],
      )
      return rows.map(toInvitation)
    },
    allMembers: async () => {
      const { rows } = await pool().query(
        `${memberSelect} WHERE m."organizationId" = ANY($1) ORDER BY m."createdAt", m.id`,
        [tracked()],
      )
      return rows.map(toMember)
    },
    allPropertyGrants: async () => {
      const { rows } = await pool().query<{
        organization_id: string
        property_id: string
        user_id: string
        source: string
        created_by: string | null
      }>(
        `SELECT organization_id, property_id::text AS property_id, user_id, source, created_by
           FROM property_access_grant
          WHERE organization_id = ANY($1) AND revoked_at IS NULL
          ORDER BY created_at, property_id`,
        [tracked()],
      )
      return rows.map((row) => ({
        organizationId: row.organization_id,
        propertyId: row.property_id,
        userId: row.user_id,
        source: row.source,
        createdBy: row.created_by,
      }))
    },
    verifiedUserIds: async () => {
      const { rows } = await pool().query<{ id: string }>(
        `SELECT id FROM "user" WHERE id = ANY($1) AND "emailVerified" ORDER BY id`,
        [[...users]],
      )
      return rows.map((row) => row.id)
    },
    facts: () => readFacts(pool(), tracked()),
    factsByTag: async (tag) =>
      (await readFacts(pool(), tracked())).filter((fact) => fact.tag === tag),
  }
}

async function readFacts(
  pool: TestLease['pool'],
  organizationIds: readonly string[],
): Promise<ReadonlyArray<CommittedFact>> {
  const { rows } = await pool.query<{
    event_type: string
    payload: Record<string, unknown>
  }>(
    `SELECT event_type, payload FROM outbox_events
      WHERE organization_id = ANY($1) ORDER BY created_at, id`,
    [organizationIds],
  )
  return rows.map((row) => ({ tag: row.event_type, payload: row.payload }))
}

async function cleanup(
  pool: TestLease['pool'],
  organizationIds: readonly string[],
  userIds: readonly string[],
): Promise<void> {
  if (organizationIds.length === 0 && userIds.length === 0) return
  await withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query(`DELETE FROM outbox_events WHERE organization_id = ANY($1)`, [
      organizationIds,
    ])
    await client.query(
      `DELETE FROM property_access_grant WHERE organization_id = ANY($1)`,
      [organizationIds],
    )
    await client.query(`DELETE FROM properties WHERE organization_id = ANY($1)`, [
      organizationIds,
    ])
    await client.query(`DELETE FROM invitation WHERE "organizationId" = ANY($1)`, [
      organizationIds,
    ])
    await client.query(`DELETE FROM member WHERE "organizationId" = ANY($1)`, [
      organizationIds,
    ])
    await deleteTestOrganizations(client, organizationIds)
    await client.query(`DELETE FROM "user" WHERE id = ANY($1)`, [userIds])
  })
}
