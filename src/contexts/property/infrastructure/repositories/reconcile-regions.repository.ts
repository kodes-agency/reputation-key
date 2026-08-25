// BQC-4.1 — property region reconciliation (operator tool, real PostgreSQL).
//
// Phase BQC-4 §3/§4.1 + ADR 0048: backfill every non-deleted property's
// processing region from durable, property-owned country data with a reviewable
// report — never a blind conversion (mirrors BQC-2.3 staff→grant
// reconciliation). The report classifies each property; --apply converts
// ONLY `resolvable` rows, bumps routing_policy_version in the same
// statement, and is idempotent.
//
// Classifications (operator-review rows are NEVER auto-converted):
//   resolved   — region set and consistent with the stored country
//   resolvable — unresolved + property-level country present (apply converts)
//   missing    — no property-level country (stays unresolved; operator action)
//   conflict   — resolved region disagrees with the stored country
//   ambiguous  — stored country is not covered by the signed catalogue
import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { resolveRegion } from '#/shared/domain/processing-profile'
import { dataCellById } from '#/shared/domain/data-cell-catalogue'

export type RegionClassification =
  'resolved' | 'resolvable' | 'missing' | 'conflict' | 'ambiguous'

export type RegionReconcileRow = Readonly<{
  propertyId: string
  organizationId: string
  countryCode: string | null
  countrySource: string | null
  processingRegion: string | null
  dataCellId: string | null
  classification: RegionClassification
  /** Content-free explanation for operators (region/country codes only). */
  detail: string
}>

export type RegionReconcileOrgRow = Readonly<{
  organizationId: string
  properties: number
  resolved: number
  resolvable: number
  missing: number
  conflicts: number
  ambiguous: number
}>

export type RegionReconcileReport = Readonly<{
  organizations: ReadonlyArray<RegionReconcileOrgRow>
  /** Every scanned property with its classification. */
  rows: ReadonlyArray<RegionReconcileRow>
  /** missing + conflict + ambiguous — need operator review, never applied. */
  reviewRows: ReadonlyArray<RegionReconcileRow>
  generatedAt: Date
}>

/** Optional scope — reconcile a single pilot org first; omit for all orgs. */
export type RegionReconcileScope = Readonly<{ organizationId?: string }>

type PropertyScanRow = Readonly<{
  id: string
  organization_id: string
  country_code: string | null
  country_source: string | null
  processing_region: string | null
  data_cell_id: string | null
}>

async function loadProperties(
  db: Database,
  scope?: RegionReconcileScope,
): Promise<ReadonlyArray<PropertyScanRow>> {
  const orgFilter = scope?.organizationId
    ? sql`AND p.organization_id = ${scope.organizationId}`
    : sql``
  const rows = await db.execute(sql`
    SELECT p.id, p.organization_id, p.country_code, p.country_source,
           p.processing_region, p.data_cell_id
    FROM properties p
    WHERE p.deleted_at IS NULL
    ${orgFilter}
  `)
  return rows.rows as unknown as ReadonlyArray<PropertyScanRow>
}

function classify(r: PropertyScanRow): RegionReconcileRow {
  const base = {
    propertyId: r.id,
    organizationId: r.organization_id,
    countryCode: r.country_code,
    countrySource: r.country_source,
    processingRegion: r.processing_region,
    dataCellId: r.data_cell_id,
  }
  const region =
    r.processing_region && r.processing_region !== 'unresolved'
      ? r.processing_region
      : null
  const country = r.country_code?.trim().toUpperCase() || null
  const derived = country ? resolveRegion(country) : 'unresolved'

  if (r.data_cell_id) {
    if (
      !dataCellById(r.data_cell_id) ||
      region !== r.data_cell_id ||
      (country !== null && derived !== r.data_cell_id)
    ) {
      return {
        ...base,
        classification: 'conflict',
        detail: `canonical Data Cell ${r.data_cell_id} conflicts with legacy region ${region ?? 'unresolved'} or stored country ${country ?? 'missing'}`,
      }
    }
    return {
      ...base,
      classification: 'resolved',
      detail: 'canonical Data Cell set and consistent with stored country',
    }
  }

  if (region) {
    if (!dataCellById(region) || (country && derived !== region)) {
      return {
        ...base,
        classification: 'conflict',
        detail: `resolved region ${region} disagrees with stored country ${country}`,
      }
    }
    return {
      ...base,
      classification: 'resolvable',
      detail: `legacy region ${region} is valid; canonical Data Cell assignment is missing`,
    }
  }
  if (!country) {
    return {
      ...base,
      classification: 'missing',
      detail: 'no property-level country',
    }
  }
  if (derived === 'unresolved') {
    return {
      ...base,
      classification: 'ambiguous',
      detail: `country ${country} is not covered by the signed Data Cell catalogue`,
    }
  }
  return {
    ...base,
    classification: 'resolvable',
    detail: `country ${country} resolves to Data Cell ${derived}`,
  }
}

export async function buildRegionReconcileReport(
  db: Database,
  scope?: RegionReconcileScope,
): Promise<RegionReconcileReport> {
  const rows = (await loadProperties(db, scope)).map(classify)

  const byOrg = new Map<
    string,
    {
      properties: number
      resolved: number
      resolvable: number
      missing: number
      conflicts: number
      ambiguous: number
    }
  >()
  for (const row of rows) {
    const entry = byOrg.get(row.organizationId) ?? {
      properties: 0,
      resolved: 0,
      resolvable: 0,
      missing: 0,
      conflicts: 0,
      ambiguous: 0,
    }
    entry.properties += 1
    if (row.classification === 'resolved') entry.resolved += 1
    if (row.classification === 'resolvable') entry.resolvable += 1
    if (row.classification === 'missing') entry.missing += 1
    if (row.classification === 'conflict') entry.conflicts += 1
    if (row.classification === 'ambiguous') entry.ambiguous += 1
    byOrg.set(row.organizationId, entry)
  }

  const organizations: RegionReconcileOrgRow[] = [...byOrg.entries()]
    .map(([organizationId, counts]) => ({ organizationId, ...counts }))
    .sort((a, b) => a.organizationId.localeCompare(b.organizationId))

  const reviewRows = rows.filter(
    (r) =>
      r.classification === 'missing' ||
      r.classification === 'conflict' ||
      r.classification === 'ambiguous',
  )

  return { organizations, rows, reviewRows, generatedAt: new Date() }
}

export async function applyRegionReconciliation(
  db: Database,
  report: RegionReconcileReport,
  options: Readonly<{ scope?: RegionReconcileScope }> = {},
): Promise<Readonly<{ applied: number }>> {
  const rows = (await loadProperties(db, options.scope)).map(classify)
  void report // rows are recomputed at apply time — never trust a stale report

  let applied = 0
  for (const row of rows) {
    if (row.classification !== 'resolvable' || row.countryCode == null) continue
    const region = resolveRegion(row.countryCode.trim().toUpperCase())
    // One UPDATE per property (ADR 0048): resolve the region with
    // country_default provenance (mirrors resolvePropertyRouting), stamp the
    // resolution time, and bump routing_policy_version in the same statement.
    // The WHERE guard keeps it idempotent and never clobbers a concurrent
    // manual correction (region resolved elsewhere, or country changed).
    const updated = await db.execute(sql`
      UPDATE properties
      SET processing_region = ${region},
          data_cell_id = ${region},
          processing_region_source = 'country_default',
          processing_region_resolved_at = now(),
          routing_policy_version = routing_policy_version + 1,
          updated_at = now()
      WHERE id = ${row.propertyId}
        AND deleted_at IS NULL
        AND data_cell_id IS NULL
        AND (processing_region IS NULL OR processing_region = 'unresolved' OR processing_region = ${region})
        AND country_code = ${row.countryCode}
      RETURNING id
    `)
    applied += updated.rows.length
  }
  return { applied }
}
