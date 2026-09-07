// LIF-01 bullet 12 — the three legacy reconciliation inventories against real
// PostgreSQL. The unit tests prove the shape; this proves the SQL is valid
// against the live schema and, critically, that running the reports changes
// nothing. The evidence needed to fix a conflict must survive the report that
// found it.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import type { Database } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  readLegacyCustomRoleInventory,
  readLegacyGuestCompatibilityInventory,
  readLegacyMultiOrganizationInventory,
} from './legacy-reconciliation-inventories'

let lease: TestLease
let db: Database

const ORG_A = `org-recon-a-${randomUUID().slice(0, 8)}`
const ORG_B = `org-recon-b-${randomUUID().slice(0, 8)}`
const USER_ID = `user-recon-${randomUUID().slice(0, 8)}`
const USER_EMAIL = `${USER_ID}@example.test`
const CUSTOM_ROLE = `legacy-auditor-${randomUUID().slice(0, 6)}`
const PROPERTY_ID = randomUUID()
const PORTAL_ID = randomUUID()
const RATING_ID = randomUUID()
const AS_OF = new Date('2026-08-28T00:00:00.000Z')

async function seed(): Promise<void> {
  for (const organizationId of [ORG_A, ORG_B]) {
    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (${organizationId}, 'Reconciliation', ${organizationId}, NOW())
      ON CONFLICT (id) DO NOTHING
    `)
  }
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified")
    VALUES (${USER_ID}, 'Reconciliation User', ${USER_EMAIL}, true)
  `)
  // Two memberships for one user — the §3.1.4 conflict.
  await db.execute(sql`
    INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt")
    VALUES (${`${USER_ID}-a`}, ${USER_ID}, ${ORG_A}, ${CUSTOM_ROLE}, NOW()),
           (${`${USER_ID}-b`}, ${USER_ID}, ${ORG_B}, 'member', NOW())
  `)
  // A dormant custom role definition without an app-owned data-scope row.
  await db.execute(sql`
    INSERT INTO "organizationRole" (id, "organizationId", role, permission)
    VALUES (${`role-${USER_ID}`}, ${ORG_A}, ${CUSTOM_ROLE}, '{}')
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${PROPERTY_ID}, ${ORG_A}, 'Recon Property', ${ORG_A}, 'UTC', NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, created_at, updated_at)
    VALUES (${PORTAL_ID}, ${ORG_A}, ${PROPERTY_ID}, ${PROPERTY_ID}, 'Recon Portal', ${ORG_A}, NOW(), NOW())
  `)
  // A legacy rating whose session pseudonym has already been redacted — the
  // unreconcilable population the report exists to size.
  await db.execute(sql`
    INSERT INTO ratings (id, organization_id, portal_id, property_id, session_id, value, source)
    VALUES (${RATING_ID}, ${ORG_A}, ${PORTAL_ID}, ${PROPERTY_ID}, NULL, 4, 'qr')
  `)
}

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ratings WHERE id = ${RATING_ID}`)
  await db.execute(sql`DELETE FROM portals WHERE id = ${PORTAL_ID}`)
  await db.execute(sql`DELETE FROM properties WHERE id = ${PROPERTY_ID}`)
  await db.execute(sql`DELETE FROM "organizationRole" WHERE "organizationId" = ${ORG_A}`)
  await db.execute(sql`DELETE FROM "member" WHERE "userId" = ${USER_ID}`)
  await db.execute(sql`DELETE FROM "user" WHERE id = ${USER_ID}`)
  await deleteTestOrganizations(lease.pool, [ORG_A, ORG_B])
}

const countRows = async (table: string): Promise<number> => {
  const result = await db.execute(
    sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`,
  )
  return Number((result.rows[0] as { count: number }).count)
}

const findingCount = (
  report: Awaited<ReturnType<typeof readLegacyCustomRoleInventory>>,
  id: string,
): number => report.findings.find((finding) => finding.id === id)?.count ?? -1

beforeAll(async () => {
  lease = await acquireTestLease(getEnv().DATABASE_URL, 2)
  db = drizzle(lease.pool) as Database
  await seed()
})

afterAll(async () => {
  if (db) await cleanup()
  await lease.release()
})

describe('legacy reconciliation inventories against PostgreSQL', () => {
  it('sees the seeded custom-role holder and its unscoped definition', async () => {
    const report = await readLegacyCustomRoleInventory(db, AS_OF)

    expect(findingCount(report, 'members_holding_custom_role')).toBeGreaterThanOrEqual(1)
    expect(findingCount(report, 'custom_role_definitions')).toBeGreaterThanOrEqual(1)
    expect(
      findingCount(report, 'custom_role_definitions_without_policy'),
    ).toBeGreaterThanOrEqual(1)
    expect(report.blocksMigration).toBe(true)
    expect(report.blockingFindingIds).toContain('members_holding_custom_role')
  })

  it('sees the seeded multi-organization user', async () => {
    const report = await readLegacyMultiOrganizationInventory(db, AS_OF)

    expect(
      findingCount(report, 'users_with_multiple_memberships'),
    ).toBeGreaterThanOrEqual(1)
    expect(report.blocksMigration).toBe(true)
  })

  it('sizes the unreconcilable legacy Guest population', async () => {
    const report = await readLegacyGuestCompatibilityInventory(db, AS_OF)

    expect(findingCount(report, 'legacy_ratings')).toBeGreaterThanOrEqual(1)
    expect(
      findingCount(report, 'ratings_without_correlatable_session'),
    ).toBeGreaterThanOrEqual(1)
    // A redacted row cannot be correlated, so it must NOT be counted as a
    // still-reconcilable one; that would overstate what migration can fix.
    expect(findingCount(report, 'ratings_without_canonical_response')).toBe(0)
    expect(report.blocksMigration).toBe(false)
  })

  it('leaves every table it reads on untouched', async () => {
    const tables = [
      'member',
      'organizationRole',
      'organization_role_policy',
      'invitation',
      'ratings',
      'feedback',
      'scan_events',
      'guest_responses',
    ]
    const before = await Promise.all(tables.map(countRows))

    await readLegacyCustomRoleInventory(db, AS_OF)
    await readLegacyMultiOrganizationInventory(db, AS_OF)
    await readLegacyGuestCompatibilityInventory(db, AS_OF)

    const after = await Promise.all(tables.map(countRows))
    expect(after, 'a reconciliation report must not erase its own evidence').toEqual(
      before,
    )
  })

  it('fingerprints identically across two runs over unchanged data', async () => {
    const first = await readLegacyGuestCompatibilityInventory(db, AS_OF)
    const second = await readLegacyGuestCompatibilityInventory(
      db,
      new Date(AS_OF.getTime() + 3_600_000),
    )
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.asOf).not.toBe(first.asOf)
  })
})
