// BQC-2.3 — grant-backed accessible-property lookup (real PostgreSQL).
//
// The money tests of the slice (phase BQC-2 §2.3 + ADR 0039):
//   - a staff_assignment WITHOUT a grant does NOT authorize (participation
//     is not an authorization input);
//   - a grant WITHOUT any staff_assignment DOES authorize (grants are the
//     only source);
//   - revoked/expired grants never authorize;
//   - the version-keyed cache invalidates on policy_version bump (grants
//     bump it in the same statement) — revocation is visible on the next call.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
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

let propStaffOnly: string
let propGrantOnly: string
let propBoth: string
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

async function insertStaffAssignment(property: string, user: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO staff_assignments (organization_id, user_id, property_id)
    VALUES (${ORG}, ${user}, ${property})
  `)
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM staff_assignments WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_A}, ${USER_B})`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)

  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Lookup Org', ${ORG}, now())`,
  )
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${USER_A}, 'Lookup A', 'user-lookup-a@example.com', false),
      (${USER_B}, 'Lookup B', 'user-lookup-b@example.com', false)
  `)

  propStaffOnly = await insertProperty('lookup-staff-only')
  propGrantOnly = await insertProperty('lookup-grant-only')
  propBoth = await insertProperty('lookup-both')
  propExpired = await insertProperty('lookup-expired')
  propRevoked = await insertProperty('lookup-revoked')

  // USER_A: staff assignment only (participation, no grant)
  await insertStaffAssignment(propStaffOnly, USER_A)
  // USER_B: grants only (no staff assignments at all)
  await grantPropertyAccess(db, {
    organizationId: ORG,
    propertyId: propGrantOnly,
    userId: USER_B,
    source: 'migration',
  })
  await grantPropertyAccess(db, {
    organizationId: ORG,
    propertyId: propBoth,
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
  await db.execute(sql`DELETE FROM staff_assignments WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_A}, ${USER_B})`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('grant-backed access lookup (BQC-2.3)', () => {
  it('staff_assignment WITHOUT a grant does NOT authorize', async () => {
    const lookup = createGrantAccessLookup(db)
    const ids = await lookup(ORG_ID, USER_A_ID)
    expect(ids).not.toContain(propertyId(propStaffOnly))
    expect(ids).toEqual([])
  })

  it('grants WITHOUT staff_assignment DO authorize; revoked/expired never do', async () => {
    const lookup = createGrantAccessLookup(db)
    const ids = await lookup(ORG_ID, USER_B_ID)
    expect(ids).toContain(propertyId(propGrantOnly))
    expect(ids).toContain(propertyId(propBoth))
    expect(ids).not.toContain(propertyId(propExpired))
    expect(ids).not.toContain(propertyId(propRevoked))
    expect(ids).toHaveLength(2)
  })

  it('cache invalidates on policy_version bump (next call sees the grant change)', async () => {
    const lookup = createGrantAccessLookup(db)
    const first = await lookup(ORG_ID, USER_A_ID)
    expect(first).toEqual([])

    // New grant bumps policy_version in the same statement — the cached empty
    // set is orphaned and the very next call sees the grant.
    await grantPropertyAccess(db, {
      organizationId: ORG,
      propertyId: propStaffOnly,
      userId: USER_A,
      source: 'operator',
    })
    const second = await lookup(ORG_ID, USER_A_ID)
    expect(second).toContain(propertyId(propStaffOnly))

    // Revocation bumps again — next call denies.
    await revokePropertyAccess(db, {
      organizationId: ORG,
      propertyId: propStaffOnly,
      userId: USER_A,
    })
    const third = await lookup(ORG_ID, USER_A_ID)
    expect(third).toEqual([])
  })
})
