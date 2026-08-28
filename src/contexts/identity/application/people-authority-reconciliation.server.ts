import { createHash } from 'node:crypto'

export const PEOPLE_AUTHORITY_RECONCILIATION_VERSION =
  'repkey-people-authority-reconciliation-2' as const

export type PeopleAuthorityReconciliationOutcome =
  'exact' | 'mappable' | 'conflict' | 'orphan' | 'unsafe'

export type PeopleAuthorityReconciliationSource =
  | 'legacy_staff_assignment'
  | 'legacy_property_access_grant'
  | 'property_access_grant'
  | 'organization_membership'
  | 'staff_participant'
  | 'staff_participation'
  | 'staff_user_link'
  | 'portal_responsibility'
  | 'team_membership'
  | 'portal_responsible_manager'
  | 'property_responsible_manager'
  | 'guest_qualified_scan'
  | 'guest_response'
  | 'metric_reading'
  | 'metric_correction'

export type PeopleAuthorityReconciliationDimension =
  | 'participant_mapping'
  | 'staff_attribution_mapping'
  | 'access_mapping'
  | 'membership_eligibility'
  | 'participant_integrity'
  | 'participation_integrity'
  | 'login_link_integrity'
  | 'compatibility_user_shadow'
  | 'staff_attribution_integrity'
  | 'manager_eligibility'
  | 'team_quarantine'
  | 'retained_history'
  | 'event_time_staff_attribution'

export type PeopleAuthorityReconciliationRow = Readonly<{
  source: PeopleAuthorityReconciliationSource
  sourceId: string
  dimension: PeopleAuthorityReconciliationDimension
  outcome: PeopleAuthorityReconciliationOutcome
  organizationId: string
  propertyId: string | null
  portalId: string | null
  userId: string | null
  reasonCode: string
  relatedIds: readonly string[]
}>

export type PeopleAuthorityReconciliationCounts = Readonly<
  Record<PeopleAuthorityReconciliationOutcome, number> & { total: number }
>

export type PeopleAuthorityReconciliationReport = Readonly<{
  schemaVersion: typeof PEOPLE_AUTHORITY_RECONCILIATION_VERSION
  asOf: string
  scope: Readonly<{
    kind: 'global' | 'organizations'
    organizationIds: readonly string[]
  }>
  counts: PeopleAuthorityReconciliationCounts
  rows: readonly PeopleAuthorityReconciliationRow[]
  fingerprintSha256: string
}>

const compareRows = (
  left: PeopleAuthorityReconciliationRow,
  right: PeopleAuthorityReconciliationRow,
): number => {
  const leftKey = [left.organizationId, left.source, left.sourceId, left.dimension].join(
    '\u0000',
  )
  const rightKey = [
    right.organizationId,
    right.source,
    right.sourceId,
    right.dimension,
  ].join('\u0000')
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

const rowKey = (row: PeopleAuthorityReconciliationRow): string =>
  [row.organizationId, row.source, row.sourceId, row.dimension].join('\u0000')

const stableRows = (
  rows: readonly PeopleAuthorityReconciliationRow[],
): readonly PeopleAuthorityReconciliationRow[] => {
  const normalized = rows
    .map((row) => ({
      ...row,
      relatedIds: [...new Set(row.relatedIds)].sort(),
    }))
    .sort(compareRows)
  const seen = new Set<string>()
  for (const row of normalized) {
    const key = rowKey(row)
    if (seen.has(key)) {
      throw new Error(`duplicate reconciliation row: ${key}`)
    }
    seen.add(key)
  }
  return normalized
}

const countRows = (
  rows: readonly PeopleAuthorityReconciliationRow[],
): PeopleAuthorityReconciliationCounts => {
  const counts = { exact: 0, mappable: 0, conflict: 0, orphan: 0, unsafe: 0 }
  for (const row of rows) counts[row.outcome] += 1
  return { ...counts, total: rows.length }
}

export function buildPeopleAuthorityReconciliationReport(
  input: Readonly<{
    asOf: Date
    organizationIds?: readonly string[]
    rows: readonly PeopleAuthorityReconciliationRow[]
  }>,
): PeopleAuthorityReconciliationReport {
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort()
  const scope =
    organizationIds.length === 0
      ? ({ kind: 'global', organizationIds } as const)
      : ({ kind: 'organizations', organizationIds } as const)
  const rows = stableRows(input.rows)
  const payload = {
    schemaVersion: PEOPLE_AUTHORITY_RECONCILIATION_VERSION,
    asOf: input.asOf.toISOString(),
    scope,
    counts: countRows(rows),
    rows,
  }
  const fingerprintSha256 = createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex')
  return { ...payload, fingerprintSha256 }
}

export function canonicalPeopleAuthorityReconciliationReport(
  report: PeopleAuthorityReconciliationReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`
}
