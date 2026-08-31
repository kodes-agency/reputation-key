// Leaderboard/Recognition's Organization Export contribution — a beta-dark
// context that still has to answer.
//
// `leaderboard.use` is `legacy_blocked`: competitive ranking is rejected beta
// behaviour and will not return. The retained rows are a different question.
// A Property-local Recognition activation records who acknowledged it, under
// which jurisdiction and notice; a board snapshot and its entries record what
// was computed for that tenant's own Portal Groups. Those are the tenant's
// records, and LIF-01 work item 6 puts "governed metrics/results/Recognition"
// inside the export. So this contributor answers 'complete' when rows exist and
// 'no_data' when they do not, and never 'omitted'.
//
// This module reads. It constructs no repository, registers no consumer or
// schedule, and is not referenced by `buildLeaderboardContext`, which stays the
// inert boundary the legacy-recognition surface pin requires. The composition
// root constructs this adapter directly, as Identity's own contributor is.

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

type LeaderboardOrganizationExportPayload = Readonly<{
  version: 'leaderboard-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  capabilityPosture: 'legacy_blocked_leaderboard_use'
  activations: readonly ExportRecord[]
  activationGroups: readonly ExportRecord[]
  boardSnapshots: readonly ExportRecord[]
  boardEntries: readonly ExportRecord[]
  reconciliationEvents: readonly ExportRecord[]
  legacySnapshots: readonly ExportRecord[]
  legacyEntries: readonly ExportRecord[]
  excludedRecordClasses: readonly ExcludedRecordClass[]
}>

const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXCLUDED_RECORD_CLASSES: readonly ExcludedRecordClass[] = Object.freeze([
  {
    recordClass: 'metric_definition_and_reading_authority',
    reasonCode: 'exported_by_metric_contributor',
  },
  {
    recordClass: 'badge_enablement_and_award_rows',
    reasonCode: 'exported_by_badge_contributor',
  },
  {
    // leaderboard_snapshots predates tenant-scoped columns and carries only a
    // property_id. Leaderboard is a dark context and the acceptance matrix
    // forbids it reading the Property table, so a legacy snapshot is scoped
    // through its own organization-scoped entries. A snapshot that has no entry
    // for this Organization cannot be attributed to it and is not exported —
    // guessing tenancy would be worse than declaring the gap.
    recordClass: 'legacy_ranking_snapshots_without_tenant_scoped_entries',
    reasonCode: 'not_attributable_to_organization',
  },
])

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Leaderboard export field is invalid: ${field}`)
    }
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  throw new Error(`Leaderboard export field has an unsupported value: ${field}`)
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

const ACTIVATION_COLUMNS = [
  'id',
  'property_id',
  'capability_policy_version',
  'jurisdiction',
  'notice_status',
  'consultation_status',
  'metric_definition_version_id',
  'aggregation',
  'period_kind',
  'minimum_exposure',
  'minimum_sample',
  'freshness_seconds',
  'minimum_completeness',
  'audience',
  'acknowledged_by',
  'acknowledged_at',
  'effective_from',
  'effective_to',
  'status',
  'deactivation_reason',
  'employment_decision_eligible',
  'created_at',
] as const

const ACTIVATION_GROUP_COLUMNS = [
  'id',
  'property_id',
  'activation_id',
  'portal_group_id',
  'created_at',
] as const

const BOARD_SNAPSHOT_COLUMNS = [
  'id',
  'property_id',
  'activation_id',
  'metric_definition_id',
  'metric_definition_version_id',
  'aggregation',
  'period_kind',
  'period_start',
  'period_end',
  'timezone',
  'minimum_exposure',
  'minimum_sample',
  'freshness_seconds',
  'minimum_completeness',
  'source_watermark',
  'status',
  'eligibility_reason',
  'correction_generation',
  'employment_decision_eligible',
  'reconciled_at',
  'created_at',
] as const

const BOARD_ENTRY_COLUMNS = [
  'id',
  'property_id',
  'snapshot_id',
  'portal_group_id',
  'value',
  'numerator',
  'denominator',
  'sample_count',
  'exposure_count',
  'completeness',
  'rank',
  'tie_group',
  'eligibility_reason',
  'status',
  'source_watermark',
  'correction_generation',
  'employment_decision_eligible',
  'reconciled_at',
  'created_at',
] as const

const RECONCILIATION_EVENT_COLUMNS = [
  'id',
  'property_id',
  'metric_definition_version_id',
  'source_event_id',
  'correction_reference',
  'source_watermark',
  'processed_at',
] as const

const LEGACY_SNAPSHOT_COLUMNS = [
  'id',
  'property_id',
  'period',
  'scope',
  'metric_key',
  'score_key',
  'last_updated_at',
  'created_at',
] as const

const LEGACY_ENTRY_COLUMNS = [
  'id',
  'snapshot_id',
  'property_id',
  'rank',
  'target_type',
  'target_id',
  'score',
  'metric_value',
  'normalized_score',
  'updated_at',
  'created_at',
] as const

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<LeaderboardOrganizationExportPayload> {
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await readRows(
        snapshot,
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = snapshotRows[0]?.snapshot_at
      if (typeof snapshotAt !== 'string') {
        throw new Error('Leaderboard export snapshot clock is unavailable')
      }
      const snapshotTime = new Date(snapshotAt).getTime()
      const requestTime = asOf.getTime()
      if (
        Number.isNaN(requestTime) ||
        snapshotTime < requestTime ||
        snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
      ) {
        throw new Error('Leaderboard export snapshot window is unavailable')
      }

      // The activation is the consent record: who acknowledged Recognition for
      // a Property, under which jurisdiction, notice and consultation status.
      // It is the row a tenant most needs when auditing why a board existed.
      const activations = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              capability_policy_version,
              jurisdiction,
              notice_status,
              consultation_status,
              metric_definition_version_id,
              aggregation,
              period_kind,
              minimum_exposure,
              minimum_sample,
              freshness_seconds,
              minimum_completeness::text AS minimum_completeness,
              audience,
              acknowledged_by,
              to_char(acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              status,
              deactivation_reason,
              employment_decision_eligible,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM recognition_activations
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, effective_from, id`,
      )
      const activationGroups = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              activation_id,
              portal_group_id,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM recognition_activation_groups
            WHERE organization_id = ${organizationId}
            ORDER BY activation_id, portal_group_id, id`,
      )
      const boardSnapshots = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              activation_id,
              metric_definition_id,
              metric_definition_version_id,
              aggregation,
              period_kind,
              to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_start,
              to_char(period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_end,
              timezone,
              minimum_exposure,
              minimum_sample,
              freshness_seconds,
              minimum_completeness::text AS minimum_completeness,
              to_char(source_watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_watermark,
              status,
              eligibility_reason,
              correction_generation,
              employment_decision_eligible,
              to_char(reconciled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reconciled_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM recognition_board_snapshots
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, period_end, id`,
      )
      const boardEntries = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              snapshot_id,
              portal_group_id,
              value::text AS value,
              numerator::text AS numerator,
              denominator::text AS denominator,
              sample_count,
              exposure_count,
              completeness::text AS completeness,
              rank,
              tie_group,
              eligibility_reason,
              status,
              to_char(source_watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_watermark,
              correction_generation,
              employment_decision_eligible,
              to_char(reconciled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reconciled_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM recognition_board_entries
            WHERE organization_id = ${organizationId}
            ORDER BY snapshot_id, portal_group_id, id`,
      )
      // Content-free correction provenance: which source fact moved a board and
      // when. It carries identifiers and timestamps only — no guest, review, or
      // manager content — and it is what makes a corrected board explainable.
      const reconciliationEvents = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              metric_definition_version_id,
              source_event_id,
              correction_reference,
              to_char(source_watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_watermark,
              to_char(processed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS processed_at
            FROM recognition_reconciliation_events
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, source_watermark, id`,
      )
      const legacyEntries = await readRows(
        snapshot,
        sql`SELECT
              id,
              snapshot_id,
              property_id,
              rank,
              target_type,
              target_id,
              score,
              metric_value,
              normalized_score,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM leaderboard_entries
            WHERE organization_id = ${organizationId}
            ORDER BY snapshot_id, rank, id`,
      )
      const legacySnapshots = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              period,
              scope,
              metric_key,
              score_key,
              to_char(last_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_updated_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM leaderboard_snapshots
            WHERE id IN (
              SELECT snapshot_id
              FROM leaderboard_entries
              WHERE organization_id = ${organizationId}
            )
            ORDER BY id`,
      )

      return {
        version: 'leaderboard-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        capabilityPosture: 'legacy_blocked_leaderboard_use',
        activations,
        activationGroups,
        boardSnapshots,
        boardEntries,
        reconciliationEvents,
        legacySnapshots,
        legacyEntries,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

function buildEntries(
  payload: LeaderboardOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const groups: readonly Readonly<{
    slug: string
    collections: readonly ExportCollection[]
    json: unknown
  }>[] = [
    {
      slug: 'recognition-activations',
      collections: [
        {
          recordType: 'recognition_activation',
          columns: ACTIVATION_COLUMNS,
          records: payload.activations,
        },
        {
          recordType: 'recognition_activation_group',
          columns: ACTIVATION_GROUP_COLUMNS,
          records: payload.activationGroups,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        activations: payload.activations,
        activationGroups: payload.activationGroups,
        excludedRecordClasses: payload.excludedRecordClasses,
      },
    },
    {
      slug: 'board-snapshots',
      collections: [
        {
          recordType: 'recognition_board_snapshot',
          columns: BOARD_SNAPSHOT_COLUMNS,
          records: payload.boardSnapshots,
        },
        {
          recordType: 'recognition_board_entry',
          columns: BOARD_ENTRY_COLUMNS,
          records: payload.boardEntries,
        },
        {
          recordType: 'recognition_reconciliation_event',
          columns: RECONCILIATION_EVENT_COLUMNS,
          records: payload.reconciliationEvents,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        boardSnapshots: payload.boardSnapshots,
        boardEntries: payload.boardEntries,
        reconciliationEvents: payload.reconciliationEvents,
      },
    },
    {
      slug: 'entries',
      collections: [
        {
          recordType: 'legacy_leaderboard_snapshot',
          columns: LEGACY_SNAPSHOT_COLUMNS,
          records: payload.legacySnapshots,
        },
        {
          recordType: 'legacy_leaderboard_entry',
          columns: LEGACY_ENTRY_COLUMNS,
          records: payload.legacyEntries,
        },
      ],
      json: {
        version: payload.version,
        requestedAsOf: payload.requestedAsOf,
        capabilityPosture: payload.capabilityPosture,
        legacySnapshots: payload.legacySnapshots,
        legacyEntries: payload.legacyEntries,
      },
    },
  ]

  return groups.flatMap(({ slug, collections, json }) => [
    csvEntry(`leaderboard/${slug}.csv`, collections),
    jsonEntry(`leaderboard/${slug}.json`, json),
  ])
}

function countRecords(payload: LeaderboardOrganizationExportPayload): number {
  return (
    payload.activations.length +
    payload.activationGroups.length +
    payload.boardSnapshots.length +
    payload.boardEntries.length +
    payload.reconciliationEvents.length +
    payload.legacySnapshots.length +
    payload.legacyEntries.length
  )
}

/**
 * Leaderboard-owned Organization Export contribution.
 *
 * Returns 'complete' when retained Recognition or legacy ranking rows exist and
 * the affirmative 'no_data' when they do not. It never returns 'omitted': the
 * blocked capability suppresses new ranking behaviour, not the tenant's record
 * of what was already computed for it.
 */
export const createLeaderboardOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'leaderboard' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (countRecords(payload) === 0) {
        return {
          context: 'leaderboard' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'leaderboard' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildEntries(payload),
      }
    },
  })
