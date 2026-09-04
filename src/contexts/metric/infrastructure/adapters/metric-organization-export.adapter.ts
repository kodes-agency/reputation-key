import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
// Cross-context adapter implementation: CONTEXT.md "Dependency rules" lets an
// `infrastructure/adapters/**` file import the foreign `application/ports/**`
// contract it implements, and nothing else from Identity.
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

type ExportFamily = Readonly<{
  /** File stem under `metric/`; also the family name inside the JSON payload. */
  name: string
  collections: readonly ExportCollection[]
}>

/**
 * The same bounded snapshot Identity's reference contributor uses. Every
 * contributor in one bundle receives the same `asOf`, so a stale queued
 * request has to fail closed everywhere rather than mixing a fresh Metric
 * snapshot into an otherwise expired archive.
 */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXPORT_PAYLOAD_VERSION = 'metric-organization-export/v1' as const
const SNAPSHOT_BOUND = 'repeatable_read_within_15m_of_request' as const

/**
 * LIF-01 bullet 7, decided per record class. Every line here is a deliberate
 * refusal, not an oversight, so the reviewer can check the reason rather than
 * re-derive the omission from the SQL.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'metric_definition_catalogue',
    reasonCode: 'platform_governance_catalogue_not_tenant_data',
  },
  {
    recordClass: 'metric_quarantine',
    reasonCode: 'integrity_and_abuse_review_internal',
  },
  {
    recordClass: 'readings_of_non_export_permitted_definition_versions',
    reasonCode: 'metric_definition_version_consumer_not_permitted',
  },
  {
    recordClass: 'source_event_and_run_correlation_identifiers',
    reasonCode: 'content_free_control_plane',
  },
])

/**
 * The governed export gate. A reading leaves Metric only when its own
 * definition version names `export` in `permitted_consumers`, so widening the
 * archive requires a reviewed registry change rather than an adapter edit.
 * This is also what keeps the Public Reputation family (`property.review`,
 * `google_property_derivative`) out of `metric/readings.*`: LIF-01 bullet 7
 * excludes Google-controlled review material, and the tenant-meaningful part
 * of it is exported separately as the RepKey-derived reputation projection.
 */
const EXPORT_PERMITTED_CONSUMER = sql`'["export"]'::jsonb`

const READING_COLUMNS = [
  'id',
  'property_id',
  'portal_id',
  'group_id',
  'metric_key',
  'definition_version_id',
  'definition_version',
  'unit',
  'value_precision',
  'source_policy',
  'recorded_exact_value',
  'effective_exact_value',
  'correction_state',
  'correction_head_id',
  'numerator',
  'denominator',
  'sample_count',
  'attribution_quality',
  'data_quality',
  'retention_class',
  'property_local_date',
  'event_at',
  'recorded_at',
  'attributed_staff_participant_id',
  'attributed_staff_participation_id',
  'attribution_responsibility_id',
  'staff_attribution_effective_from',
  'staff_attribution_effective_to',
] as const

const PORTAL_LIFETIME_COLUMNS = [
  'property_id',
  'portal_id',
  'qualified_scan_count',
  'private_rating_count',
  'private_rating_sum',
  'private_rating_1_count',
  'private_rating_2_count',
  'private_rating_3_count',
  'private_rating_4_count',
  'private_rating_5_count',
  'private_feedback_count',
  'google_review_selection_count',
  'secondary_link_selection_count',
  'sealed_qualified_scan_count',
  'sealed_private_rating_count',
  'sealed_private_rating_sum',
  'sealed_private_rating_1_count',
  'sealed_private_rating_2_count',
  'sealed_private_rating_3_count',
  'sealed_private_rating_4_count',
  'sealed_private_rating_5_count',
  'sealed_private_feedback_count',
  'sealed_google_review_selection_count',
  'sealed_secondary_link_selection_count',
  'sealed_through_local_date',
  'projection_revision',
  'last_rebuilt_at',
  'last_sealed_at',
] as const

const CURRENT_GOOGLE_REPUTATION_COLUMNS = [
  'property_id',
  'source_epoch',
  'review_count',
  'average_rating',
  'evaluated_at',
  'updated_at',
] as const

const CORRECTION_COLUMNS = [
  'id',
  'reading_id',
  'kind',
  'reason',
  'actor_type',
  'actor_id',
  'exact_delta',
  'replacement_value',
  'is_correction_head',
  'supersedes_correction_id',
  'event_at',
  'recorded_at',
] as const

const WATERMARK_COLUMNS = [
  'consumer_name',
  'source_name',
  'property_id',
  'definition_version_id',
  'last_event_at',
  'updated_at',
] as const

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Metric export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value === undefined) throw new Error(`Metric export column is missing: ${field}`)
  throw new Error(`Metric export field has an unsupported value: ${field}`)
}

/**
 * Projects exactly the declared columns. A SELECT that stops producing a
 * declared alias fails here instead of silently emitting a CSV column that no
 * longer agrees with the JSON authority.
 */
function projectRows(
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): readonly ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [
        column,
        normalizeScalar(column in row ? row[column] : undefined, column),
      ]),
    ),
  )
}

type Snapshot = Parameters<Parameters<Database['transaction']>[0]>[0]

async function readRows(
  snapshot: Snapshot,
  query: SQL,
): Promise<Record<string, unknown>[]> {
  const result = await snapshot.execute(query)
  return result.rows as Record<string, unknown>[]
}

function csvField(value: ExportScalar | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvEntry(family: ExportFamily): OrganizationExportEntry {
  const header = family.collections.reduce<readonly string[]>(
    (columns, collection) => [
      ...columns,
      ...collection.columns.filter((column) => !columns.includes(column)),
    ],
    ['record_type'],
  )
  const lines = [
    header.join(','),
    ...family.collections.flatMap((collection) =>
      collection.records.map((record) =>
        header
          .map((column) =>
            csvField(column === 'record_type' ? collection.recordType : record[column]),
          )
          .join(','),
      ),
    ),
  ]
  return {
    path: `metric/${family.name}.csv`,
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(family: ExportFamily, asOf: Date): OrganizationExportEntry {
  return {
    path: `metric/${family.name}.json`,
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(
      `${canonicalizeRfc8785({
        version: EXPORT_PAYLOAD_VERSION,
        family: family.name,
        requestedAsOf: asOf.toISOString(),
        snapshotBound: SNAPSHOT_BOUND,
        records: Object.fromEntries(
          family.collections.map((collection) => [
            collection.recordType,
            collection.records,
          ]),
        ),
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      })}\n`,
      'utf8',
    ),
  }
}

async function assertBoundedSnapshot(snapshot: Snapshot, asOf: Date): Promise<void> {
  const rows = await readRows(
    snapshot,
    sql`SELECT transaction_timestamp() AS snapshot_at`,
  )
  const snapshotAt = rows[0]?.snapshot_at
  const snapshotTime =
    snapshotAt instanceof Date
      ? snapshotAt.getTime()
      : typeof snapshotAt === 'string'
        ? new Date(snapshotAt).getTime()
        : Number.NaN
  const requestTime = asOf.getTime()
  if (
    Number.isNaN(snapshotTime) ||
    Number.isNaN(requestTime) ||
    snapshotTime < requestTime ||
    snapshotTime - requestTime > MAX_SNAPSHOT_LAG_MS
  ) {
    throw new Error('Metric export snapshot window is unavailable')
  }
}

async function readFamilies(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<readonly ExportFamily[]> {
  return db.transaction(
    async (snapshot) => {
      await assertBoundedSnapshot(snapshot, asOf)

      // `source_event_id` is deliberately absent: it is the ingestion
      // correlation key of the producing outbox event, not a tenant fact.
      const readings = await readRows(
        snapshot,
        sql`SELECT
              reading.id,
              reading.property_id,
              reading.portal_id,
              reading.group_id,
              reading.metric_key,
              reading.definition_version_id,
              version.version AS definition_version,
              version.unit,
              version.precision AS value_precision,
              reading.source_policy,
              reading.exact_value AS recorded_exact_value,
              CASE
                WHEN tip.kind = 'retract' THEN NULL
                WHEN tip.kind = 'replace' THEN tip.replacement_value
                WHEN tip.kind = 'adjust' THEN reading.exact_value + tip.exact_delta
                ELSE reading.exact_value
              END AS effective_exact_value,
              COALESCE(tip.kind, 'none') AS correction_state,
              tip.id AS correction_head_id,
              reading.numerator,
              reading.denominator,
              reading.sample_count,
              reading.attribution_quality,
              reading.data_quality,
              reading.retention_class,
              reading.property_local_date,
              to_char(reading.event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_at,
              to_char(reading.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
              reading.attributed_staff_participant_id,
              reading.attributed_staff_participation_id,
              reading.attribution_responsibility_id,
              to_char(reading.staff_attribution_effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS staff_attribution_effective_from,
              to_char(reading.staff_attribution_effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS staff_attribution_effective_to
            FROM metric_readings AS reading
            INNER JOIN metric_definition_versions AS version
              ON version.id = reading.definition_version_id
            LEFT JOIN LATERAL (
              SELECT head.id, head.kind, head.replacement_value, head.exact_delta
              FROM metric_corrections AS head
              WHERE head.reading_id = reading.id
                AND NOT EXISTS (
                  SELECT 1 FROM metric_corrections AS successor
                  WHERE successor.supersedes_correction_id = head.id
                )
              ORDER BY head.recorded_at DESC, head.id DESC
              LIMIT 1
            ) AS tip ON true
            WHERE reading.organization_id = ${organizationId}
              AND version.permitted_consumers @> ${EXPORT_PERMITTED_CONSUMER}
            ORDER BY reading.metric_key, reading.event_at, reading.id`,
      )

      const portalLifetime = await readRows(
        snapshot,
        sql`SELECT
              property_id,
              portal_id,
              qualified_scan_count,
              private_rating_count,
              private_rating_sum,
              private_rating_1_count,
              private_rating_2_count,
              private_rating_3_count,
              private_rating_4_count,
              private_rating_5_count,
              private_feedback_count,
              google_review_selection_count,
              secondary_link_selection_count,
              sealed_qualified_scan_count,
              sealed_private_rating_count,
              sealed_private_rating_sum,
              sealed_private_rating_1_count,
              sealed_private_rating_2_count,
              sealed_private_rating_3_count,
              sealed_private_rating_4_count,
              sealed_private_rating_5_count,
              sealed_private_feedback_count,
              sealed_google_review_selection_count,
              sealed_secondary_link_selection_count,
              sealed_through_local_date,
              projection_revision,
              to_char(last_rebuilt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_rebuilt_at,
              to_char(last_sealed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_sealed_at
            FROM portal_metric_lifetime_aggregates
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, portal_id`,
      )

      // RepKey's own derived reputation projection: a count and an average,
      // never provider review text or a Google review identifier. The internal
      // sync run/event ids that fence the projection stay behind.
      const currentGoogleReputation = await readRows(
        snapshot,
        sql`SELECT
              property_id,
              source_epoch,
              review_count,
              average_rating,
              to_char(evaluated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluated_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM metric_current_google_reputation_snapshots
            WHERE organization_id = ${organizationId}
            ORDER BY property_id`,
      )

      const corrections = await readRows(
        snapshot,
        sql`SELECT
              correction.id,
              correction.reading_id,
              correction.kind,
              correction.reason,
              correction.actor_type,
              correction.actor_id,
              correction.exact_delta,
              correction.replacement_value,
              NOT EXISTS (
                SELECT 1 FROM metric_corrections AS successor
                WHERE successor.supersedes_correction_id = correction.id
              ) AS is_correction_head,
              correction.supersedes_correction_id,
              to_char(correction.event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_at,
              to_char(correction.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at
            FROM metric_corrections AS correction
            INNER JOIN metric_readings AS reading ON reading.id = correction.reading_id
            INNER JOIN metric_definition_versions AS version
              ON version.id = reading.definition_version_id
            WHERE reading.organization_id = ${organizationId}
              AND version.permitted_consumers @> ${EXPORT_PERMITTED_CONSUMER}
            ORDER BY correction.reading_id, correction.recorded_at, correction.id`,
      )

      // Freshness only. `last_source_event_id` is the consumer's internal
      // resume key and never leaves the control plane.
      const watermarks = await readRows(
        snapshot,
        sql`SELECT
              consumer_name,
              source_name,
              property_id,
              definition_version_id,
              to_char(last_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_event_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM metric_source_watermarks
            WHERE organization_id = ${organizationId}
            ORDER BY consumer_name, source_name, property_id, definition_version_id`,
      )

      // Declared in ascending path order so the emitted entries already agree
      // with the archive's UTF-8 byte ordering.
      return [
        {
          name: 'corrections',
          collections: [
            {
              recordType: 'metric_correction',
              columns: CORRECTION_COLUMNS,
              records: projectRows(corrections, CORRECTION_COLUMNS),
            },
          ],
        },
        {
          name: 'current-google-reputation',
          collections: [
            {
              recordType: 'current_google_reputation_snapshot',
              columns: CURRENT_GOOGLE_REPUTATION_COLUMNS,
              records: projectRows(
                currentGoogleReputation,
                CURRENT_GOOGLE_REPUTATION_COLUMNS,
              ),
            },
          ],
        },
        {
          name: 'portal-lifetime',
          collections: [
            {
              recordType: 'portal_metric_lifetime_aggregate',
              columns: PORTAL_LIFETIME_COLUMNS,
              records: projectRows(portalLifetime, PORTAL_LIFETIME_COLUMNS),
            },
          ],
        },
        {
          name: 'readings',
          collections: [
            {
              recordType: 'metric_reading',
              columns: READING_COLUMNS,
              records: projectRows(readings, READING_COLUMNS),
            },
          ],
        },
        {
          name: 'watermarks',
          collections: [
            {
              recordType: 'metric_source_watermark',
              columns: WATERMARK_COLUMNS,
              records: projectRows(watermarks, WATERMARK_COLUMNS),
            },
          ],
        },
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Metric's Organization Export contribution.
 *
 * Exports the governed read-only contract: metric results whose definition
 * version permits the `export` consumer, the anonymous Portal-lifetime
 * aggregate, the derived current-on-Google reputation projection, the
 * correction history that makes a corrected result auditable, and the source
 * freshness watermarks behind "Data through…".
 *
 * It does not touch the maintenance surface (quarantine and repair), which is
 * internal integrity state rather than part of the governed export contract.
 */
export const createMetricOrganizationExportAdapter = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'metric' as const,
    async contribute({ organizationId, asOf }) {
      const families = await readFamilies(db, organizationId, asOf)
      const populated = families.filter((family) =>
        family.collections.some((collection) => collection.records.length > 0),
      )
      if (populated.length === 0) {
        // An affirmative "this Organization has no governed metric result",
        // never an invented empty CSV.
        return {
          context: 'metric' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'metric' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: populated.flatMap((family) => [
          csvEntry(family),
          jsonEntry(family, asOf),
        ]),
      }
    },
  })
