import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import { csvCell } from '#/shared/security/csv-cell'
import type { OrganizationExportEntry } from '../../application/ports/organization-export-contributor.port'

export type ExportScalar = string | number | boolean | null
export type ExportRecord = Readonly<Record<string, ExportScalar>>

export type ExportCollection = Readonly<{
  recordType: string
  columns: readonly string[]
  records: readonly ExportRecord[]
}>

export type ExcludedRecordClass = Readonly<{ recordClass: string; reasonCode: string }>

export type StaffOrganizationExportPayload = Readonly<{
  version: 'staff-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  participants: readonly ExportRecord[]
  participantUserLinks: readonly ExportRecord[]
  participations: readonly ExportRecord[]
  portalResponsibilities: readonly ExportRecord[]
  portalGroupMemberships: readonly ExportRecord[]
  onboardings: readonly ExportRecord[]
  propertySettings: readonly ExportRecord[]
  excludedRecordClasses: readonly ExcludedRecordClass[]
}>

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Staff export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Staff export field has an unsupported value: ${field}`)
}

export function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

/**
 * One CSV per file group. The header is the ordered union of the declared
 * columns of every collection in that group, so a record that has no value for
 * a sibling collection's column renders an empty cell rather than shifting the
 * row. Column order is declared, never derived from a driver row's key order.
 */
export function csvEntry(
  path: string,
  collections: readonly ExportCollection[],
): OrganizationExportEntry {
  const columns = [...new Set(collections.flatMap(({ columns }) => columns))]
  const lines = [
    ['record_type', ...columns].join(','),
    ...collections.flatMap(({ recordType, records }) =>
      records.map((record) =>
        [csvCell(recordType), ...columns.map((column) => csvCell(record[column]))].join(
          ',',
        ),
      ),
    ),
  ]
  return {
    path,
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

export function jsonEntry(path: string, value: unknown): OrganizationExportEntry {
  return {
    path,
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(value)}\n`, 'utf8'),
  }
}
