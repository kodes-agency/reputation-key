// BQC-2.3 — staff→grant reconciliation (real PostgreSQL).
//
// Phase BQC-2 §2.3/§5: reconcile legacy staff assignments to PROPOSED grants
// with a reviewable report — never a blind conversion. The report separates
// clean rows from anomalies (org-mismatch between assignment and property,
// assignments pointing at missing properties); --apply only converts clean
// rows, skips existing grants, and is idempotent.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  buildReconcileReport,
  applyReconciliation,
} from './reconcile-staff-grants.repository'

const db = getDb()
const ORG_A = 'org-recon-a'
const ORG_B = 'org-recon-b'
const USER_1 = 'user-recon-1'
const USER_2 = 'user-recon-2'

let propA: string
let propA2: string
let propB: string
let propDeleted: string

async function insertProperty(org: string, slug: string): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${org}, ${slug}, ${slug}, 'UTC')
    RETURNING id
  `)
  return (rows.rows[0] as { id: string }).id
}

async function insertAssignment(
  org: string,
  user: string,
  property: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO staff_assignments (organization_id, user_id, property_id)
    VALUES (${org}, ${user}, ${property})
  `)
}

beforeAll(async () => {
  for (const org of [ORG_A, ORG_B]) {
    await db.execute(sql`DELETE FROM staff_assignments WHERE organization_id = ${org}`)
    await db.execute(
      sql`DELETE FROM property_access_grant WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${org}`)
  }
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_1}, ${USER_2})`)

  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt") VALUES
      (${ORG_A}, 'Recon A', ${ORG_A}, now()), (${ORG_B}, 'Recon B', ${ORG_B}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${USER_1}, 'Recon One', 'user-recon-1@example.com', false),
      (${USER_2}, 'Recon Two', 'user-recon-2@example.com', false)
  `)

  propA = await insertProperty(ORG_A, 'recon-prop-a')
  propA2 = await insertProperty(ORG_A, 'recon-prop-a2')
  propB = await insertProperty(ORG_B, 'recon-prop-b')
  propDeleted = await insertProperty(ORG_A, 'recon-prop-deleted')
  await db.execute(
    sql`UPDATE properties SET deleted_at = now() WHERE id = ${propDeleted}`,
  )

  // Clean rows: 3 assignments, 3 distinct (user, property) pairs.
  // (Same-user-same-property duplicates exist in the wild via distinct
  // team/portal rows; the pair Map dedupes them by construction.)
  await insertAssignment(ORG_A, USER_1, propA)
  await insertAssignment(ORG_A, USER_2, propA2)
  await insertAssignment(ORG_A, USER_2, propA)
  // Anomaly: assignment org ≠ property org
  await insertAssignment(ORG_A, USER_1, propB)
  // Anomaly: assignment points at soft-deleted property
  await insertAssignment(ORG_A, USER_2, propDeleted)

  // Pre-existing grant → skipped by apply
  const { grantPropertyAccess } = await import('./property-access-grant.repository')
  await grantPropertyAccess(db, {
    organizationId: ORG_A,
    propertyId: propA,
    userId: USER_1,
    source: 'operator',
  })
})

afterAll(async () => {
  for (const org of [ORG_A, ORG_B]) {
    await db.execute(sql`DELETE FROM staff_assignments WHERE organization_id = ${org}`)
    await db.execute(
      sql`DELETE FROM property_access_grant WHERE organization_id = ${org}`,
    )
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
    await db.execute(sql`DELETE FROM organization WHERE id = ${org}`)
  }
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${USER_1}, ${USER_2})`)
})

describe('staff→grant reconciliation (BQC-2.3)', () => {
  const SCOPE = { organizationIds: [ORG_A, ORG_B] }

  it('reports clean pairs, skips, and anomalies separately', async () => {
    const report = await buildReconcileReport(db, SCOPE)
    const orgA = report.organizations.find((o) => o.organizationId === ORG_A)
    expect(orgA).toBeTruthy()
    // 3 distinct clean pairs; 1 already granted; 2 to create
    expect(orgA!.distinctPairs).toBe(3)
    expect(orgA!.alreadyGranted).toBe(1)
    expect(orgA!.toCreate).toBe(2)
    // Anomalies reported, never counted for conversion
    expect(orgA!.anomalies).toBe(2)
    expect(report.anomalyRows).toHaveLength(2)
    const kinds = report.anomalyRows.map((a) => a.kind).sort()
    expect(kinds).toEqual(['org_mismatch', 'property_inactive'])
  })

  it('apply converts only clean rows and is idempotent', async () => {
    const report = await buildReconcileReport(db, SCOPE)
    const first = await applyReconciliation(db, report, {
      createdBy: 'reconcile-test',
      scope: SCOPE,
    })
    expect(first.created).toBe(2)

    const grants = await db.execute(
      sql`SELECT property_id, user_id, source FROM property_access_grant
          WHERE organization_id = ${ORG_A} AND revoked_at IS NULL`,
    )
    expect(grants.rows).toHaveLength(3) // 1 pre-existing + 2 created
    for (const row of grants.rows) {
      expect(['operator', 'migration']).toContain(row.source)
    }

    // Anomalies were NOT converted
    const anomalyGrants = await db.execute(
      sql`SELECT 1 FROM property_access_grant WHERE property_id IN (${propB}, ${propDeleted})`,
    )
    expect(anomalyGrants.rows).toHaveLength(0)

    // Second run creates nothing
    const second = await applyReconciliation(db, await buildReconcileReport(db, SCOPE), {
      createdBy: 'reconcile-test',
      scope: SCOPE,
    })
    expect(second.created).toBe(0)
  })
})
