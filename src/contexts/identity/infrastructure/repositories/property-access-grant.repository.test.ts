// BQC-2.2 — PropertyAccessGrant persistence integration test (real PostgreSQL).
//
// Proves the grant table is authoritative-ready (phase BQC-2 §2.2):
//   - grant/revoke/list/hasActiveGrant semantics incl. expiry;
//   - DB-level tenant consistency: a grant whose organization_id does not
//     match the property's organization is rejected by the composite FK;
//   - one active grant per (org, property, user) — duplicates rejected,
//     re-grant after revoke allowed;
//   - every mutation bumps the global policy_version (cache invalidation
//     contract for the snapshot store).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  grantPropertyAccess,
  revokePropertyAccess,
  listActiveGrantsForUser,
  hasActiveGrant,
} from './property-access-grant.repository'
import { getPolicyVersion } from './policy-state.repository'

const db = getDb()
const ORG_A = 'org-grant-a'
const ORG_B = 'org-grant-b'
const USER_1 = 'user-grant-1'
const HOUR = 60 * 60 * 1000

let propA1: string
let propA2: string
let propA3: string
let propB1: string

async function insertProperty(org: string, slug: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${org}, ${slug}, ${slug}, 'UTC')
    RETURNING id
  `)
  return (rows.rows[0] as { id: string }).id
}

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM property_access_grant WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  )
  await db.execute(
    sql`DELETE FROM properties WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  )
  await db.execute(sql`DELETE FROM "user" WHERE id = ${USER_1}`)
  await db.execute(sql`DELETE FROM organization WHERE id IN (${ORG_A}, ${ORG_B})`)

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG_A}, 'Grant Org A', ${ORG_A}, now()), (${ORG_B}, 'Grant Org B', ${ORG_B}, now())
  `)
  await db.execute(
    sql`INSERT INTO "user" (id, name, email, "emailVerified") VALUES (${USER_1}, 'Grant User', 'user-grant-1@example.com', false)`,
  )

  propA1 = await insertProperty(ORG_A, 'grant-prop-a1')
  propA2 = await insertProperty(ORG_A, 'grant-prop-a2')
  propA3 = await insertProperty(ORG_A, 'grant-prop-a3')
  propB1 = await insertProperty(ORG_B, 'grant-prop-b1')
})

afterAll(async () => {
  await db.execute(
    sql`DELETE FROM property_access_grant WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  )
  await db.execute(
    sql`DELETE FROM properties WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  )
  await db.execute(sql`DELETE FROM "user" WHERE id = ${USER_1}`)
  await db.execute(sql`DELETE FROM organization WHERE id IN (${ORG_A}, ${ORG_B})`)
})

describe('PropertyAccessGrant persistence (BQC-2.2)', () => {
  it('grants and reads active access', async () => {
    const grant = await grantPropertyAccess(db, {
      organizationId: ORG_A,
      propertyId: propA1,
      userId: USER_1,
      source: 'operator',
      createdBy: 'op-test',
    })
    expect(grant.id).toBeTruthy()
    expect(grant.revokedAt).toBeNull()

    await expect(
      hasActiveGrant(db, {
        organizationId: ORG_A,
        propertyId: propA1,
        userId: USER_1,
        at: new Date(),
      }),
    ).resolves.toBe(true)

    const grants = await listActiveGrantsForUser(db, ORG_A, USER_1, new Date())
    expect(grants.map((g) => g.propertyId)).toContain(propA1)
  })

  it('rejects a cross-tenant grant (composite FK tenant consistency)', async () => {
    await expect(
      grantPropertyAccess(db, {
        organizationId: ORG_A,
        propertyId: propB1, // property belongs to ORG_B
        userId: USER_1,
        source: 'operator',
      }),
    ).rejects.toThrow()
  })

  it('rejects a duplicate active grant for the same (org, property, user)', async () => {
    await expect(
      grantPropertyAccess(db, {
        organizationId: ORG_A,
        propertyId: propA1,
        userId: USER_1,
        source: 'operator',
      }),
    ).rejects.toThrow()
  })

  it('revokes, then allows re-grant', async () => {
    const revoked = await revokePropertyAccess(db, {
      organizationId: ORG_A,
      propertyId: propA1,
      userId: USER_1,
      reason: 'test revoke',
    })
    expect(revoked).toBe(true)
    await expect(
      hasActiveGrant(db, {
        organizationId: ORG_A,
        propertyId: propA1,
        userId: USER_1,
        at: new Date(),
      }),
    ).resolves.toBe(false)

    const regrant = await grantPropertyAccess(db, {
      organizationId: ORG_A,
      propertyId: propA1,
      userId: USER_1,
      source: 'migration',
    })
    expect(regrant.id).toBeTruthy()
  })

  it('treats expired grants as inactive', async () => {
    await grantPropertyAccess(db, {
      organizationId: ORG_A,
      propertyId: propA2,
      userId: USER_1,
      source: 'invitation',
      expiresAt: new Date(Date.now() - HOUR), // already expired
    })
    await expect(
      hasActiveGrant(db, {
        organizationId: ORG_A,
        propertyId: propA2,
        userId: USER_1,
        at: new Date(),
      }),
    ).resolves.toBe(false)
  })

  it('bumps the global policy_version on grant and revoke', async () => {
    const before = await getPolicyVersion(db)
    await grantPropertyAccess(db, {
      organizationId: ORG_A,
      propertyId: propA3,
      userId: USER_1,
      source: 'operator',
    })
    const afterGrant = await getPolicyVersion(db)
    expect(afterGrant).toBeGreaterThan(before)

    await revokePropertyAccess(db, {
      organizationId: ORG_A,
      propertyId: propA3,
      userId: USER_1,
    })
    const afterRevoke = await getPolicyVersion(db)
    expect(afterRevoke).toBeGreaterThan(afterGrant)
  })
})
