// Badge's Organization Export contribution — a beta-dark Recognition context
// that still has to answer.
//
// `badge.use` is `legacy_blocked`: the legacy Badge program is not the accepted
// recognition model and will never be reactivated. That is a product verdict
// about behaviour. The rows an Organization already accumulated — which badges
// it enabled, and which awards were recorded against its own Properties and
// Portal Groups — are tenant-visible history, and LIF-01 work item 6 names
// "governed metrics/results/Recognition" as export content. A dark capability
// is therefore a reason to emit nothing NEW, not a reason to omit what exists.
//
// This module reads. It constructs no repository, registers no consumer, and is
// not referenced by `buildBadgeContext`, which stays the inert boundary the
// legacy-recognition surface pin requires. The composition root constructs this
// adapter directly, exactly as Identity's own contributor is constructed.

import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
// Cross-context adapter implementing a foreign port — src/contexts/CONTEXT.md
// "Dependency rules" permits infrastructure/adapters/** to reach application/ports/**.
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportScalar = string | number | boolean | null
type ExportRecord = Readonly<Record<string, ExportScalar>>

type ExportCollection = Readonly<{
  recordType: string
  columns: readonly string[]
  records: readonly ExportRecord[]
}>

type ExcludedRecordClass = Readonly<{ recordClass: string; reasonCode: string }>

type BadgeOrganizationExportPayload = Readonly<{
  version: 'badge-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  capabilityPosture: 'legacy_blocked_badge_use'
  enablements: readonly ExportRecord[]
  legacyAwards: readonly ExportRecord[]
  governedAwards: readonly ExportRecord[]
  governedAwardStatusFacts: readonly ExportRecord[]
  excludedRecordClasses: readonly ExcludedRecordClass[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXCLUDED_RECORD_CLASSES: readonly ExcludedRecordClass[] = Object.freeze([
  {
    // badge_definitions and badge_definition_versions are a single global
    // RepKey-owned catalogue with no organization column. They are product
    // configuration, not tenant data, and copying them into one tenant's
    // archive would misrepresent who authored them. The enablement and award
    // rows keep their definition identifiers so the archive stays joinable.
    recordClass: 'global_badge_definition_catalogue',
    reasonCode: 'not_organization_scoped',
  },
  {
    recordClass: 'recognition_activation_and_board_rows',
    reasonCode: 'exported_by_leaderboard_contributor',
  },
  {
    recordClass: 'metric_definition_and_reading_authority',
    reasonCode: 'exported_by_metric_contributor',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Badge export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Badge export field has an unsupported value: ${field}`)
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

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvEntry(
  path: string,
  collections: readonly ExportCollection[],
): OrganizationExportEntry {
  const columns = [...new Set(collections.flatMap(({ columns }) => columns))]
  const lines = [
    ['record_type', ...columns].join(','),
    ...collections.flatMap(({ recordType, records }) =>
      records.map((record) =>
        [csvField(recordType), ...columns.map((column) => csvField(record[column]))].join(
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

function jsonEntry(path: string, value: unknown): OrganizationExportEntry {
  return {
    path,
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${canonicalizeRfc8785(value)}\n`, 'utf8'),
  }
}

const ENABLEMENT_COLUMNS = [
  'id',
  'badge_definition_id',
  'enabled',
  'created_at',
  'updated_at',
] as const

const LEGACY_AWARD_COLUMNS = [
  'id',
  'property_id',
  'portal_id',
  'portal_group_id',
  'badge_definition_id',
  'criteria_version',
  'target_type',
  'target_id',
  'unique_key',
  'awarded_at',
  'created_at',
] as const

const GOVERNED_AWARD_COLUMNS = [
  'id',
  'property_id',
  'portal_group_id',
  'definition_version_id',
  'metric_definition_version_id',
  'source_snapshot_id',
  'source_fact_id',
  'source_watermark',
  'period_start',
  'period_end',
  'timezone',
  'sample_count',
  'exposure_count',
  'completeness',
  'eligibility_reason',
  'definition_snapshot',
  'employment_decision_eligible',
  'awarded_at',
  'created_at',
] as const

const GOVERNED_AWARD_STATUS_COLUMNS = [
  'id',
  'property_id',
  'award_id',
  'status',
  'correction_reference',
  'replacement_award_id',
  'reason',
  'occurred_at',
  'created_at',
] as const

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<BadgeOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Badge export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Badge export snapshot window is unavailable')
      }

      const enablements = await readRows(
        snapshot,
        sql`SELECT
              id,
              badge_definition_id,
              enabled,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM organization_badge_enablements
            WHERE organization_id = ${organizationId}
            ORDER BY badge_definition_id, id`,
      )
      const legacyAwards = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              portal_id,
              portal_group_id,
              badge_definition_id,
              criteria_version,
              target_type,
              target_id,
              unique_key,
              to_char(awarded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS awarded_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM badge_awards
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, awarded_at, id`,
      )
      // The governed group award carries its own definition snapshot, so the
      // archive stays readable without the global catalogue this contributor
      // deliberately does not export.
      const governedAwards = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              portal_group_id,
              definition_version_id,
              metric_definition_version_id,
              source_snapshot_id,
              source_fact_id,
              to_char(source_watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_watermark,
              to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_start,
              to_char(period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_end,
              timezone,
              sample_count,
              exposure_count,
              completeness::text AS completeness,
              eligibility_reason,
              definition_snapshot::text AS definition_snapshot,
              employment_decision_eligible,
              to_char(awarded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS awarded_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM recognition_awards
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, period_end, id`,
      )
      // Awards are append-only; a correction is a status fact. Both sides are
      // exported so a reader can see the corrected outcome, not just the
      // original claim.
      const governedAwardStatusFacts = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              award_id,
              status,
              correction_reference,
              replacement_award_id,
              reason,
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM recognition_award_status_facts
            WHERE organization_id = ${organizationId}
            ORDER BY award_id, occurred_at, id`,
      )

      return {
        version: 'badge-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        capabilityPosture: 'legacy_blocked_badge_use',
        enablements,
        legacyAwards,
        governedAwards,
        governedAwardStatusFacts,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

function buildEntries(
  payload: BadgeOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const groups: readonly Readonly<{
    slug: string
    collections: readonly ExportCollection[]
    json: unknown
  }>[] = [
    {
      slug: 'enablements',
      collections: [
        {
          recordType: 'organization_badge_enablement',
          columns: ENABLEMENT_COLUMNS,
          records: payload.enablements,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        enablements: payload.enablements,
        excludedRecordClasses: payload.excludedRecordClasses,
      },
    },
    {
      slug: 'awards',
      collections: [
        {
          recordType: 'legacy_badge_award',
          columns: LEGACY_AWARD_COLUMNS,
          records: payload.legacyAwards,
        },
        {
          recordType: 'governed_recognition_award',
          columns: GOVERNED_AWARD_COLUMNS,
          records: payload.governedAwards,
        },
        {
          recordType: 'governed_recognition_award_status_fact',
          columns: GOVERNED_AWARD_STATUS_COLUMNS,
          records: payload.governedAwardStatusFacts,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        legacyAwards: payload.legacyAwards,
        governedAwards: payload.governedAwards,
        governedAwardStatusFacts: payload.governedAwardStatusFacts,
      },
    },
  ]

  return groups.flatMap(({ slug, collections, json }) => [
    csvEntry(`badge/${slug}.csv`, collections),
    jsonEntry(`badge/${slug}.json`, json),
  ])
}

function countRecords(payload: BadgeOrganizationExportPayload): number {
  return (
    payload.enablements.length +
    payload.legacyAwards.length +
    payload.governedAwards.length +
    payload.governedAwardStatusFacts.length
  )
}

/**
 * Badge-owned Organization Export contribution.
 *
 * Returns 'complete' when retained Recognition history exists and the
 * affirmative 'no_data' when it does not. It never returns 'omitted': a dark
 * capability withholds future behaviour, not the tenant's own past records.
 */
export const createBadgeOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'badge' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (countRecords(payload) === 0) {
        return {
          context: 'badge' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'badge' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildEntries(payload),
      }
    },
  })
