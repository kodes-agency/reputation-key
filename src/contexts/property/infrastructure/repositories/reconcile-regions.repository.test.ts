// BQC-4.1 — property region reconciliation (real PostgreSQL).
//
// Phase BQC-4 §3/§4.1 + ADR 0054 as amended by ADR 0057: reconcile every
// active Property's processing
// region from durable, property-owned country data with a reviewable report —
// never a blind conversion. The report classifies each non-deleted property:
//   resolved   — region set and consistent with the stored country
//   resolvable — unresolved + property-level country present (apply converts)
//   missing    — no property-level country (stays unresolved; operator action)
//   conflict   — resolved region disagrees with the stored country
//                (NEVER auto-converted)
//   ambiguous  — country is absent from the signed catalogue (NEVER inferred)
// --apply converts only `resolvable` rows and is idempotent.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  buildRegionReconcileReport,
  applyRegionReconciliation,
} from './reconcile-regions.repository'

const db = getDb()
const ORG = 'org-region-recon'
const OTHER_ORG = 'org-region-recon-other'
const CLOCK = () => new Date('2026-08-28T00:00:00.000Z')

let propResolvableUs: string
let propResolvableEurope: string
let propMissing: string
let propConflictStored: string
let propResolvableJapan: string
let propResolved: string
let propDeleted: string

async function insertProperty(
  slug: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const rows = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${ORG}, ${slug}, ${slug}, 'UTC')
    RETURNING id
  `)
  const id = (rows.rows[0] as { id: string }).id
  if (extras.countryCode !== undefined) {
    await db.execute(
      sql`UPDATE properties SET country_code = ${extras.countryCode}, country_source = ${extras.countrySource ?? 'google_address'} WHERE id = ${id}`,
    )
  }
  if (extras.processingRegion !== undefined) {
    await db.execute(
      sql`UPDATE properties
          SET processing_region = ${extras.processingRegion},
              data_cell_id = CASE
                WHEN ${extras.processingRegion} IN ('us', 'europe', 'global')
                THEN ${extras.processingRegion}
                ELSE NULL
              END,
              processing_region_resolved_at = now()
          WHERE id = ${id}`,
    )
  }
  return id
}

async function regionRow(id: string) {
  const rows = await db.execute(sql`
    SELECT processing_region, data_cell_id, processing_region_source, routing_policy_version,
           processing_region_resolved_at
    FROM properties WHERE id = ${id}
  `)
  return rows.rows[0] as {
    processing_region: string
    data_cell_id: string | null
    processing_region_source: string
    routing_policy_version: number
    processing_region_resolved_at: Date | null
  }
}

beforeAll(async () => {
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt") VALUES
      (${ORG}, 'Region Recon', ${ORG}, now()),
      (${OTHER_ORG}, 'Region Recon Other', ${OTHER_ORG}, now())
  `)

  // resolvable: unresolved + US country (apply → us)
  propResolvableUs = await insertProperty('recon-us', {
    countryCode: 'US',
  })
  // resolvable: unresolved + DE country (apply → the single beta cell)
  propResolvableEurope = await insertProperty('recon-de', {
    countryCode: 'DE',
  })
  // missing: no country anywhere
  propMissing = await insertProperty('recon-missing')
  // conflict: a stale future-cell assignment disagrees with current policy
  propConflictStored = await insertProperty('recon-conflict-stored', {
    countryCode: 'DE',
    processingRegion: 'europe',
  })
  // Every other supported country is also a deterministic US assignment.
  propResolvableJapan = await insertProperty('recon-japan', {
    countryCode: 'JP',
  })
  // resolved: region set and consistent
  propResolved = await insertProperty('recon-resolved', {
    countryCode: 'US',
    processingRegion: 'us',
  })
  // soft-deleted: excluded from the report entirely
  propDeleted = await insertProperty('recon-deleted', { countryCode: 'US' })
  await db.execute(
    sql`UPDATE properties SET deleted_at = now() WHERE id = ${propDeleted}`,
  )
})

afterAll(async () => {
  for (const org of [ORG, OTHER_ORG]) {
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${org}`)
  }
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
})

describe('region reconciliation report (BQC-4.1)', () => {
  const SCOPE = { organizationId: ORG }

  it('classifies every non-deleted property', async () => {
    const report = await buildRegionReconcileReport(db, CLOCK, SCOPE)
    const byId = new Map(report.rows.map((r) => [r.propertyId, r]))

    expect(byId.get(propResolvableUs)?.classification).toBe('resolvable')
    expect(byId.get(propResolvableEurope)?.classification).toBe('resolvable')
    expect(byId.get(propMissing)?.classification).toBe('missing')
    expect(byId.get(propConflictStored)?.classification).toBe('conflict')
    expect(byId.get(propResolvableJapan)?.classification).toBe('resolvable')
    expect(byId.get(propResolved)?.classification).toBe('resolved')
    // soft-deleted properties are never reported
    expect(byId.has(propDeleted)).toBe(false)
  })

  it('aggregates per-organization counts', async () => {
    const report = await buildRegionReconcileReport(db, CLOCK, SCOPE)
    const org = report.organizations.find((o) => o.organizationId === ORG)
    expect(org).toEqual({
      organizationId: ORG,
      properties: 6,
      resolved: 1,
      resolvable: 3,
      missing: 1,
      conflicts: 1,
      ambiguous: 0,
    })
  })

  it('separates operator-review rows (missing/conflict/ambiguous)', async () => {
    const report = await buildRegionReconcileReport(db, CLOCK, SCOPE)
    const reviewIds = report.reviewRows.map((r) => r.propertyId).sort()
    expect(reviewIds).toEqual([propMissing, propConflictStored].sort())
    for (const row of report.reviewRows) {
      expect(row.detail.length).toBeGreaterThan(0)
    }
  })

  it('scopes to a single organization', async () => {
    const report = await buildRegionReconcileReport(db, CLOCK, {
      organizationId: OTHER_ORG,
    })
    expect(report.rows).toHaveLength(0)
    expect(report.organizations).toHaveLength(0)
  })
})

describe('region reconciliation apply (BQC-4.1)', () => {
  const SCOPE = { organizationId: ORG }

  it('applies only resolvable rows and is idempotent', async () => {
    const report = await buildRegionReconcileReport(db, CLOCK, SCOPE)
    const first = await applyRegionReconciliation(db, report, { scope: SCOPE })
    expect(first.applied).toBe(3)

    const us = await regionRow(propResolvableUs)
    expect(us.processing_region).toBe('us')
    expect(us.data_cell_id).toBe('us')
    expect(us.processing_region_source).toBe('country_default')
    expect(us.routing_policy_version).toBe(3)
    expect(us.processing_region_resolved_at).not.toBeNull()

    const europe = await regionRow(propResolvableEurope)
    expect(europe.processing_region).toBe('us')
    expect(europe.data_cell_id).toBe('us')
    expect(europe.routing_policy_version).toBe(3)

    const japan = await regionRow(propResolvableJapan)
    expect(japan.processing_region).toBe('us')
    expect(japan.data_cell_id).toBe('us')

    // Operator-review rows are NEVER auto-converted
    expect((await regionRow(propMissing)).processing_region).toBe('unresolved')
    expect((await regionRow(propMissing)).routing_policy_version).toBe(1)
    expect((await regionRow(propConflictStored)).processing_region).toBe('europe')
    expect((await regionRow(propConflictStored)).routing_policy_version).toBe(1)
    // Already-resolved rows are untouched
    expect((await regionRow(propResolved)).routing_policy_version).toBe(1)

    // Second run resolves nothing new
    const second = await applyRegionReconciliation(
      db,
      await buildRegionReconcileReport(db, CLOCK, SCOPE),
      { scope: SCOPE },
    )
    expect(second.applied).toBe(0)
  })
})
