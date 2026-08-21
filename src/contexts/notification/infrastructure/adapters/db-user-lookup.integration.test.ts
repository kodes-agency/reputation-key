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

// Ids are namespaced to this FILE rather than the conventional 1111…/2222…/3333…
// set. Integration tests share one database with the local e2e stack, and
// `scripts/seed-e2e-user.ts` already owns `33333333-3333-4333-8333-333333333333`
// as `p3` of `e2e-locked-org-b`. Claiming it here turned `seedProperty`'s
// `ON CONFLICT (id) DO NOTHING` into a silent no-op, and the grant insert then
// failed `property_access_grant_tenant_fk` — it REFERENCES
// properties(organization_id, id), which no seeded row could ever satisfy — on
// every machine that had run the e2e seed. CI only passed because its container
// is fresh.
const ORG_A = organizationId('b7000000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7000000-0000-4000-8000-000000000002')
const PROPERTY_ID = 'b7000000-0000-4000-8000-000000000010'
const OTHER_PROPERTY_ID = 'b7000000-0000-4000-8000-000000000011'
const GRANTED_USER = 'user-lookup-granted'
const LEGACY_USER = 'user-lookup-legacy'
const REVOKED_USER = 'user-lookup-revoked'
const OTHER_PROPERTY_USER = 'user-lookup-other-property'

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
    // The member id must include the organization: one user legitimately holds
    // membership in several organizations, and a user-only id made the second
    // insert a no-op instead of a second membership.
    [`member-${orgId}-${id}`, orgId, id],
  )
}

// `ON CONFLICT (id) DO NOTHING` on its own hides the failure mode that broke
// this file: an id already owned by another organization silently stays owned by
// it, and the mismatch only resurfaces as an opaque tenant-FK violation several
// statements later. Assert the ownership the caller asked for instead.
async function seedProperty(id: string, orgId: string): Promise<void> {
  const pool = getPool()
  const inserted = await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, lifecycle_state)
     VALUES ($1, $2, 'Test Property', $3, 'Europe/Sofia', 'active')
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    // `slug` must derive from the WHOLE id: this file's fixture ids share a
    // prefix, so a truncated slug collides between them.
    [id, orgId, `p-${id.replace(/-/g, '')}`],
  )
  if (inserted.rowCount === 1) return
  const existing = await pool.query<{ organization_id: string }>(
    `SELECT organization_id FROM properties WHERE id = $1`,
    [id],
  )
  const owner = existing.rows[0]?.organization_id
  if (owner !== orgId) {
    throw new Error(
      `property ${id} belongs to organization ${owner ?? '<absent>'}, not ${orgId}: ` +
        `this file must use an id namespace nothing else seeds`,
    )
  }
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
    await seedProperty(PROPERTY_ID, ORG_A)
    await seedProperty(OTHER_PROPERTY_ID, ORG_A)
    for (const id of [GRANTED_USER, LEGACY_USER, REVOKED_USER, OTHER_PROPERTY_USER]) {
      await seedUser(id, ORG_A)
    }
    await grant(GRANTED_USER, PROPERTY_ID)
    await grant(REVOKED_USER, PROPERTY_ID, { revoked: true })
    await grant(OTHER_PROPERTY_USER, OTHER_PROPERTY_ID)
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
    // Membership in BOTH organizations is what makes this assertion load-bearing:
    // with the user absent from ORG_B, the final membership filter alone returns
    // nothing and a grant lookup that forgot its organization predicate would
    // still look correct. A consultant who belongs to both organizations must
    // still not receive ORG_B notifications for an ORG_A property.
    await seedUser(GRANTED_USER, ORG_A)
    await seedUser(GRANTED_USER, ORG_B)
    await grant(GRANTED_USER, PROPERTY_ID)

    await expect(
      lookupFor(db).findAssignedManagers(
        ORG_B,
        brandPropertyId(PROPERTY_ID) as unknown as string,
      ),
    ).resolves.toEqual([])
  })
})
