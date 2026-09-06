// LIF-01 bullet 6: the Property context's own Organization Export slice.
//
// This is a cross-context adapter implementation, so it may import the
// contributor port it implements and nothing else from Identity (see
// src/contexts/CONTEXT.md "Dependency rules" and the port header).

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type PropertyOrganizationExportPayload = Readonly<{
  version: 'property-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  properties: readonly ExportRecord[]
  responsibleManagers: readonly ExportRecord[]
  excludedRecordClasses: readonly Readonly<{
    recordClass: string
    reasonCode: string
  }>[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

/**
 * Every deliberate Property-context exclusion, named so a reviewer can audit
 * the decision instead of inferring it from the absence of a column.
 *
 * - The Google account/location/review-URI columns are provider-controlled
 *   identifiers. LIF-01 bullet 7 excludes Google-controlled identifiers copied
 *   merely for export, so the archive keeps only the content-free binding and
 *   destination *state* that tells a tenant whether their Property is
 *   connected.
 * - Property policy, capability, and access-grant rows genuinely belong to the
 *   tenant, but Identity already exports them; a second copy would let the two
 *   drift inside one archive.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'google_account_location_and_review_destination_identifiers',
    reasonCode: 'google_controlled_identifier',
  },
  {
    recordClass: 'property_operation_receipts',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'property_policy_capability_and_access_grants',
    reasonCode: 'exported_by_identity_contributor',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Property export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Property export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeScalar(value, field)]),
    ),
  )
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

/** UTF-8 byte order, never the database or host locale collation. */
function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

/**
 * Ordering happens here rather than in SQL because `ORDER BY` on a text column
 * follows the database collation, which is a host-configuration input. The last
 * key is always a surrogate id so the order is total.
 */
function sortRecords(
  rows: readonly ExportRecord[],
  keys: readonly string[],
): ExportRecord[] {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareText(String(left[key] ?? ''), String(right[key] ?? ''))
      if (result !== 0) return result
    }
    return 0
  })
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvSummary(type: string, record: ExportRecord): readonly ExportScalar[] {
  return [
    type,
    record.id ?? '',
    record.property_id ?? record.id ?? '',
    record.user_id ?? '',
    record.name ?? '',
    record.lifecycle_state ?? record.state ?? 'recorded',
    record.created_at ?? record.effective_from ?? '',
    record.updated_at ?? record.effective_to ?? '',
    canonicalizeRfc8785(record),
  ]
}

const CSV_HEADER = [
  'record_type',
  'record_id',
  'property_id',
  'user_id',
  'label',
  'state',
  'created_at',
  'updated_at',
  'record_json',
]

function csvEntry(payload: PropertyOrganizationExportPayload): OrganizationExportEntry {
  const collections: readonly [string, readonly ExportRecord[]][] = [
    ['property', payload.properties],
    ['property_responsible_manager', payload.responsibleManagers],
  ]
  const lines = [
    CSV_HEADER.join(','),
    ...collections.flatMap(([type, records]) =>
      records.map((record) => csvSummary(type, record).map(csvField).join(',')),
    ),
  ]
  return {
    path: 'property/properties.csv',
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(payload: PropertyOrganizationExportPayload): OrganizationExportEntry {
  return {
    path: 'property/properties.json',
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
  }
}

const TS = `AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

/** Renders a timestamptz as a fixed-width UTC ISO string, free of any session
 * `TimeZone` or `DateStyle` setting the connection happens to carry. */
const utc = (column: string) => sql.raw(`to_char(${column} ${TS})`)

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<PropertyOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Property export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Property export snapshot window is unavailable')
      }

      // Soft-deleted Properties stay in the archive: an archived Property is
      // still the tenant's record, and hiding it would make the export
      // disagree with the lifecycle evidence Identity exports beside it.
      const properties = await readRows(
        snapshot,
        sql`SELECT
              id::text AS id,
              name,
              slug,
              timezone,
              default_reply_language,
              address,
              country_code,
              country_source,
              timezone_source,
              ${utc('timezone_resolved_at')} AS timezone_resolved_at,
              profile_version,
              profile_source,
              ${utc('profile_confirmed_at')} AS profile_confirmed_at,
              profile_confirmed_by,
              google_binding_state,
              google_review_destination_state,
              source_epoch,
              responsible_manager_revision,
              ${utc('responsibility_needed_since')} AS responsibility_needed_since,
              lifecycle_state,
              lifecycle_reason,
              ${utc('lifecycle_state_changed_at')} AS lifecycle_state_changed_at,
              lifecycle_initiated_by,
              ${utc('purge_scheduled_for')} AS purge_scheduled_for,
              ${utc('created_at')} AS created_at,
              ${utc('updated_at')} AS updated_at,
              ${utc('deleted_at')} AS deleted_at
            FROM properties
            WHERE organization_id = ${organizationId}`,
      )
      const responsibleManagers = await readRows(
        snapshot,
        sql`SELECT
              manager.id::text AS id,
              manager.property_id::text AS property_id,
              manager.user_id,
              ${utc('manager.effective_from')} AS effective_from,
              ${utc('manager.effective_to')} AS effective_to,
              manager.created_by,
              manager.end_reason
            FROM property_responsible_managers AS manager
            WHERE manager.organization_id = ${organizationId}`,
      )

      return {
        version: 'property-organization-export/v1' as const,
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request' as const,
        properties: sortRecords(properties, ['id']),
        responsibleManagers: sortRecords(responsibleManagers, [
          'property_id',
          'effective_from',
          'id',
        ]),
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Property-owned Organization Export contribution.
 *
 * Exports the tenant-visible Property profile, lifecycle status, and workflow
 * responsibility assignments. Identity owns the Organization,
 * member, access-grant, policy, and capability slice, so nothing here repeats
 * it. An Organization with no Property rows answers `no_data` rather than
 * shipping a header-only CSV.
 */
export const createPropertyOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor => {
  return Object.freeze({
    context: 'property' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (payload.properties.length === 0 && payload.responsibleManagers.length === 0) {
        return {
          context: 'property' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'property' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: [csvEntry(payload), jsonEntry(payload)],
      }
    },
  })
}
