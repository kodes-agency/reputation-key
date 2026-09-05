// BQC-2.3 — grant-backed accessible-property lookup (real PostgreSQL).
//
// The money tests of the slice (phase BQC-2 §2.3 + ADR 0039):
//   - a Property without a grant does not authorize;
//   - active grants authorize independently of any Staff state;
//   - revoked/expired grants never authorize;
//   - the version-keyed cache invalidates on policy_version bump (grants
//     bump it in the same statement) — revocation is visible on the next call.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, userId, propertyId } from '#/shared/domain/ids'
import { createGrantAccessLookup } from '../adapters/grant-access-lookup.adapter'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './property-access-grant.repository'

const db = getDb()
const ORG = 'org-lookup'
const USER_A = 'user-lookup-a'
const USER_B = 'user-lookup-b'

let propNoGrant: string
let propMigrationGrant: string
let propOperatorGrant: string
let propExpired: string
let propRevoked: string

const ORG_ID = organizationId(ORG)
const USER_A_ID = userId(USER_A)
const USER_B_ID = userId(USER_B)

async function insertProperty(slug: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${ORG}, ${slug}, ${slug}, 'UTC')
    RETURNING id
  `)
  return (rows.rows[0] as { id: string }).id
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_A}, ${USER_B})`)
  await deleteTestOrganizations(db, [ORG])

  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Lookup Org', ${ORG}, now())`,
  )
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${USER_A}, 'Lookup A', 'user-lookup-a@example.com', false),
      (${USER_B}, 'Lookup B', 'user-lookup-b@example.com', false)
  `)

  propNoGrant = await insertProperty('lookup-no-grant')
  propMigrationGrant = await insertProperty('lookup-migration-grant')
  propOperatorGrant = await insertProperty('lookup-operator-grant')
  propExpired = await insertProperty('lookup-expired')
  propRevoked = await insertProperty('lookup-revoked')

  // USER_A starts without access; USER_B receives two active grants.
  await grantPropertyAccess(db, {
    organizationId: ORG,
    propertyId: propMigrationGrant,
    userId: USER_B,
    source: 'migration',
  })
  await grantPropertyAccess(db, {
    organizationId: ORG,
    propertyId: propOperatorGrant,
    userId: USER_B,
    source: 'operator',
  })
  await grantPropertyAccess(db, {
    organizationId: ORG,
    propertyId: propExpired,
    userId: USER_B,
    source: 'operator',
    expiresAt: new Date(Date.now() - 60_000),
  })
  await grantPropertyAccess(db, {
    organizationId: ORG,
    propertyId: propRevoked,
    userId: USER_B,
    source: 'operator',
  })
  await revokePropertyAccess(db, {
    organizationId: ORG,
    propertyId: propRevoked,
    userId: USER_B,
  })
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_A}, ${USER_B})`)
  await deleteTestOrganizations(db, [ORG])
})

describe('grant-backed access lookup (BQC-2.3)', () => {
  it('a Property without a grant does not authorize', async () => {
    const lookup = createGrantAccessLookup(db, () => new Date())
    const ids = await lookup(ORG_ID, USER_A_ID)
    expect(ids).toEqual([])
  })

  it('active grants authorize; revoked and expired grants do not', async () => {
    const lookup = createGrantAccessLookup(db, () => new Date())
    const ids = await lookup(ORG_ID, USER_B_ID)
    expect(ids).toContain(propertyId(propMigrationGrant))
    expect(ids).toContain(propertyId(propOperatorGrant))
    expect(ids).not.toContain(propertyId(propExpired))
    expect(ids).not.toContain(propertyId(propRevoked))
    expect(ids).toHaveLength(2)
  })

  it('cache invalidates on policy_version bump (next call sees the grant change)', async () => {
    const lookup = createGrantAccessLookup(db, () => new Date())
    const first = await lookup(ORG_ID, USER_A_ID)
    expect(first).toEqual([])

    // New grant bumps policy_version in the same statement — the cached empty
    // set is orphaned and the very next call sees the grant.
    await grantPropertyAccess(db, {
      organizationId: ORG,
      propertyId: propNoGrant,
      userId: USER_A,
      source: 'operator',
    })
    const second = await lookup(ORG_ID, USER_A_ID)
    expect(second).toContain(propertyId(propNoGrant))

    // Revocation bumps again — next call denies.
    await revokePropertyAccess(db, {
      organizationId: ORG,
      propertyId: propNoGrant,
      userId: USER_A,
    })
    const third = await lookup(ORG_ID, USER_A_ID)
    expect(third).toEqual([])
  })
})
