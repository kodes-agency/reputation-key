// Property-scoped notification recipients must come from the authoritative
// `property_access_grant` model. Reading only the legacy `staff_assignments`
// table resolved zero recipients once the invitation lifecycle stopped writing
// it, which silently dropped every property-scoped notification.

import { beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId as brandPropertyId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createDbUserLookupAdapter } from './db-user-lookup.adapter'
import { createPropertyGrantHolderLookup } from '#/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter'

const ORG_A = organizationId('11111111-1111-4111-8111-111111111111')
const ORG_B = organizationId('22222222-2222-4222-8222-222222222222')
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333'
const GRANTED_USER = 'user-granted'
const LEGACY_USER = 'user-legacy'
const REVOKED_USER = 'user-revoked'
const OTHER_PROPERTY_USER = 'user-other-property'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['property_access_grant', 'staff_assignments', 'properties'],
})

const TEST_USERS = [GRANTED_USER, LEGACY_USER, REVOKED_USER, OTHER_PROPERTY_USER]

async function resetMembers(): Promise<void> {
  // `member` is keyed by camelCase better-auth columns, so it cannot go through
  // the shared organization_id truncation helper.
  await getPool().query(`DELETE FROM member WHERE "userId" = ANY($1)`, [TEST_USERS])
}

async function seedUser(id: string, orgId: string): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, id, `${id}@example.test`],
  )
  await pool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
     VALUES ($1, $2, $3, 'admin', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [`member-${id}`, orgId, id],
  )
}

async function seedProperty(id: string, orgId: string): Promise<void> {
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, lifecycle_state)
     VALUES ($1, $2, 'Test Property', $3, 'Europe/Sofia', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [id, orgId, `p-${id.slice(0, 8)}`],
  )
}

async function grant(
  userId: string,
  property: string,
  overrides: Readonly<{ revoked?: boolean; expiresAt?: string }> = {},
): Promise<void> {
  await getPool().query(
    `INSERT INTO property_access_grant
       (organization_id, property_id, user_id, source, created_by, revoked_at, expires_at)
     VALUES ($1, $2::uuid, $3, 'operator', 'test',
             CASE WHEN $4 THEN NOW() ELSE NULL END, $5)`,
    [ORG_A, property, userId, overrides.revoked ?? false, overrides.expiresAt ?? null],
  )
}

describe('createDbUserLookupAdapter.findAssignedManagers', () => {
  beforeEach(resetMembers)

  // Exactly the production wiring: the identity-owned grant-holder lookup is
  // what bootstrap and composition inject.
  const lookupFor = (db: Database) =>
    createDbUserLookupAdapter(db, createPropertyGrantHolderLookup(db))

  it('resolves active grant holders, unions legacy assignments, and excludes revoked or out-of-scope access', async () => {
    const pool = getPool()
    const db = drizzle(pool) as unknown as Database
    const otherProperty = '44444444-4444-4444-8444-444444444444'
    await seedProperty(PROPERTY_ID, ORG_A)
    await seedProperty(otherProperty, ORG_A)
    for (const id of [GRANTED_USER, LEGACY_USER, REVOKED_USER, OTHER_PROPERTY_USER]) {
      await seedUser(id, ORG_A)
    }
    await grant(GRANTED_USER, PROPERTY_ID)
    await grant(REVOKED_USER, PROPERTY_ID, { revoked: true })
    await grant(OTHER_PROPERTY_USER, otherProperty)
    await pool.query(
      `INSERT INTO staff_assignments (id, organization_id, property_id, user_id, created_at)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3, NOW())`,
      [ORG_A, PROPERTY_ID, LEGACY_USER],
    )

    const recipients = await lookupFor(db).findAssignedManagers(
      ORG_A,
      brandPropertyId(PROPERTY_ID) as unknown as string,
    )

    expect([...recipients].sort()).toEqual([GRANTED_USER, LEGACY_USER].sort())
  })

  it('does not leak recipients across organizations', async () => {
    const pool = getPool()
    const db = drizzle(pool) as unknown as Database
    await seedProperty(PROPERTY_ID, ORG_A)
    await seedUser(GRANTED_USER, ORG_A)
    await grant(GRANTED_USER, PROPERTY_ID)

    await expect(
      lookupFor(db).findAssignedManagers(
        ORG_B,
        brandPropertyId(PROPERTY_ID) as unknown as string,
      ),
    ).resolves.toEqual([])
  })
})
