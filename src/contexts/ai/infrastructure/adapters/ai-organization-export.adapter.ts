import { sql, type SQL } from 'drizzle-orm'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
// Cross-context adapter contract: src/contexts/CONTEXT.md "Dependency rules"
// lets a foreign infrastructure/adapters/** module import the Identity port it
// implements, and nothing else from Identity.
import type {
  OrganizationExportContributor,
  OrganizationExportEntry,
} from '#/contexts/identity/application/ports/organization-export-contributor.port'

type ExportValue =
  | string
  | number
  | boolean
  | null
  | readonly ExportValue[]
  | Readonly<{ [key: string]: ExportValue }>

type ExportRecord = Readonly<Record<string, ExportValue>>

export type AiOrganizationExportCollection =
  'review_analyses' | 'property_daily_aggregates' | 'property_trend_outcomes'

export type AiOrganizationExportPayload = Readonly<{
  version: 'ai-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  reviewAnalyses: readonly ExportRecord[]
  propertyDailyAggregates: readonly ExportRecord[]
  propertyTrendOutcomes: readonly ExportRecord[]
  excludedRecordClasses: readonly Readonly<{
    recordClass: string
    reasonCode: string
  }>[]
}>

/** One emitted JSON file: the lossless authority for exactly one collection. */
export type AiOrganizationExportDocument = Readonly<{
  version: 'ai-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  collection: AiOrganizationExportCollection
  records: readonly ExportRecord[]
  excludedRecordClasses: AiOrganizationExportPayload['excludedRecordClasses']
}>

/**
 * Same bounded read-only snapshot the Identity contributor uses. Every
 * contribution in one bundle must describe the same instant, so a request that
 * has been queued too long fails closed instead of silently exporting a
 * different `asOf` than the manifest claims.
 */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

/**
 * Where the exportable line is drawn for AI.
 *
 * `CLASSIFICATIONS_BY_CONTEXT` allows this context exactly one disclosure class,
 * `retained_ai_derivative`. LIF-01 bullet 6 asks for "currently retained
 * permitted AI derivatives"; bullet 7 excludes prompts, transient inference and
 * provider internals. So the export carries the three durable derivative classes
 * this context owns — Review Analysis, the Property daily aggregate, and the
 * deterministic Property Trend outcome — and nothing about how they were made.
 *
 * The word *currently* is doing the work. CONTEXT.md's data-and-retention rule
 * is that a retired generation is hidden immediately by the current Identity
 * authorization read fence, while physical erasure follows within 24 hours on a
 * separate worker. An export that read rows straight out of the tables would
 * therefore resurrect derivatives the product already stopped serving, in the
 * one window where nobody is watching. Every query below is fenced by the same
 * predicates the serving read uses, so a disabled, revoked, re-enabled,
 * source-epoch-rolled, profile-retired or content-expired generation is absent
 * from the archive before the erasure worker ever runs.
 *
 * Withheld, and why:
 *
 * - `ai_operations`, monthly cost windows, and execution-control history are
 *   content-free inference/control records, not merchant-facing derivatives.
 * - The enrollment head and aggregate reconciliation ledgers are work
 *   authorities, not facts about the Organization.
 * - Reply Draft provider output is session-ephemeral and never persisted here.
 *   Only an explicitly adopted draft exists, and it is Review-owned content that
 *   Review's own contributor exports as manager-authored.
 * - Google Review source content stays owned and exported by Review. This
 *   context joins `reviews` only to evaluate the source-content lifecycle fence;
 *   no review text, rating, reviewer or provider identifier is selected.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'ai_operations_and_attempts',
    reasonCode: 'prompt_and_inference_internals',
  },
  {
    recordClass: 'ai_admission_permits_quota_and_cost',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'ai_provider_deployment_and_routing_profiles',
    reasonCode: 'provider_internals',
  },
  {
    recordClass: 'ai_governance_and_execution_controls',
    reasonCode: 'operator_control_plane',
  },
  {
    recordClass: 'ai_review_analysis_enrollment_and_backfill_authorities',
    reasonCode: 'content_free_work_scheduling',
  },
  {
    recordClass: 'ai_authorization_lifecycle_and_erasure_evidence',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'ai_aggregate_contribution_ledgers_and_cursors',
    reasonCode: 'content_free_reconciliation_ledger',
  },
  {
    recordClass: 'ai_reply_draft_provider_output',
    reasonCode: 'session_ephemeral_output',
  },
  {
    recordClass: 'google_review_source_content',
    reasonCode: 'owned_and_exported_by_review',
  },
])

/** UTF-8 byte order — never host-locale collation. */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalizeValue(value: unknown, field: string): ExportValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`AI export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeValue(item, `${field}[${index}]`))
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, normalizeValue(item, `${field}.${key}`)]),
    )
  }
  throw new Error(`AI export field has an unsupported value: ${field}`)
}

function toExportedRecord(row: Record<string, unknown>): ExportRecord {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [field, normalizeValue(value, field)]),
  )
}

const DIGITS_ONLY = /^\d+$/u

/**
 * Ordering is decided in Node over the exported record itself, not by the
 * database, so a host with a different `lc_collate` cannot reorder the archive.
 * Digit-only parts are zero-padded before the byte comparison: `analysis_sequence`
 * and the aggregate revisions are PostgreSQL `bigint`s, which the driver hands
 * back as strings, and raw byte order would otherwise put sequence 10 before 9.
 */
function sortKeyText(parts: readonly (ExportValue | undefined)[]): string {
  return parts
    .map((part) => {
      if (part === null || part === undefined) return ''
      const text = String(part)
      return DIGITS_ONLY.test(text) ? text.padStart(19, '0') : text
    })
    .join(' ')
}

export function sortAiExportRows(
  rows: readonly Record<string, unknown>[],
  sortKey: (record: ExportRecord) => readonly (ExportValue | undefined)[],
): readonly ExportRecord[] {
  return rows
    .map(toExportedRecord)
    .map((record) => ({ record, key: sortKeyText(sortKey(record)) }))
    .sort((left, right) => compareUtf8(left.key, right.key))
    .map(({ record }) => record)
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
  sortKey: (record: ExportRecord) => readonly (ExportValue | undefined)[],
): Promise<readonly ExportRecord[]> {
  const result = await snapshot.execute(query)
  return sortAiExportRows(result.rows as Record<string, unknown>[], sortKey)
}

function csvField(value: ExportValue | undefined): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? canonicalizeRfc8785(value) : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const REVIEW_ANALYSIS_COLUMNS = [
  'property_id',
  'review_id',
  'source_epoch',
  'source_revision',
  'analysis_sequence',
  'review_analysis_epoch',
  'property_profile_version',
  'analysis_profile_version',
  'authorization_lineage_id',
  'status',
  'unavailable_reason',
  'sentiment',
  'primary_category',
  'attention',
  'generated_at',
  'expires_at',
] as const

// `location_count` is the "location" review *category* tally, not a Google
// location identifier; no provider identifier reaches this file.
const PROPERTY_DAILY_AGGREGATE_COLUMNS = [
  'property_id',
  'local_date',
  'source_epoch',
  'review_analysis_epoch',
  'property_profile_version',
  'calendar_profile_version',
  'aggregate_revision',
  'terminal_analysis_sequence',
  'review_count',
  'rating_sum',
  'positive_count',
  'neutral_count',
  'negative_count',
  'mixed_count',
  'service_count',
  'staff_count',
  'quality_count',
  'value_count',
  'cleanliness_count',
  'wait_time_count',
  'atmosphere_count',
  'location_count',
  'accessibility_count',
  'other_count',
  'urgent_count',
  'high_count',
  'medium_count',
  'low_count',
  'updated_at',
] as const

const PROPERTY_TREND_OUTCOME_COLUMNS = [
  'schedule_id',
  'property_id',
  'due_local_date',
  'disposition',
  'signal_key',
  'direction',
  'confidence_basis_points',
  'supporting_review_count',
  'headline',
  'summary',
  'sentences',
  'selected_signal_ids',
  'definition_version',
  'definition_digest',
  'render_profile_version',
  'render_profile_digest',
  'evidence',
  'source_epoch',
  'review_analysis_epoch',
  'property_trends_epoch',
  'property_profile_version',
  'recorded_at',
  'expires_at',
] as const

type AiExportFile = Readonly<{
  collection: AiOrganizationExportCollection
  stem: string
  columns: readonly string[]
  select: (payload: AiOrganizationExportPayload) => readonly ExportRecord[]
}>

const EXPORT_FILES: readonly AiExportFile[] = Object.freeze([
  {
    collection: 'review_analyses',
    stem: 'review-analyses',
    columns: REVIEW_ANALYSIS_COLUMNS,
    select: (payload) => payload.reviewAnalyses,
  },
  {
    collection: 'property_daily_aggregates',
    stem: 'property-daily-aggregates',
    columns: PROPERTY_DAILY_AGGREGATE_COLUMNS,
    select: (payload) => payload.propertyDailyAggregates,
  },
  {
    collection: 'property_trend_outcomes',
    stem: 'property-trend-outcomes',
    columns: PROPERTY_TREND_OUTCOME_COLUMNS,
    select: (payload) => payload.propertyTrendOutcomes,
  },
])

export function aiExportRecordCount(payload: AiOrganizationExportPayload): number {
  return EXPORT_FILES.reduce((total, file) => total + file.select(payload).length, 0)
}

/**
 * Six files: one CSV human view and one lossless JSON authority per retained
 * derivative class. Every entry is `retained_ai_derivative`, the only
 * disclosure class the contract permits this context to stamp.
 */
export function buildAiExportEntries(
  payload: AiOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  return EXPORT_FILES.flatMap((file): readonly OrganizationExportEntry[] => {
    const records = file.select(payload)
    const lines = [
      file.columns.join(','),
      ...records.map((record) =>
        file.columns.map((column) => csvField(record[column])).join(','),
      ),
    ]
    const document: AiOrganizationExportDocument = {
      version: payload.version,
      requestedAsOf: payload.requestedAsOf,
      snapshotBound: payload.snapshotBound,
      collection: file.collection,
      records,
      excludedRecordClasses: payload.excludedRecordClasses,
    }
    return [
      {
        path: `ai/${file.stem}.csv`,
        mediaType: 'text/csv',
        classification: 'retained_ai_derivative',
        bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
      },
      {
        path: `ai/${file.stem}.json`,
        mediaType: 'application/json',
        classification: 'retained_ai_derivative',
        bytes: Buffer.from(`${canonicalizeRfc8785(document)}\n`, 'utf8'),
      },
    ]
  })
}

const UTC_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<AiOrganizationExportPayload> {
  const asOfIso = asOf.toISOString()
  return db.transaction(
    async (snapshot) => {
      const snapshotRows = await snapshot.execute(
        sql`SELECT transaction_timestamp() AS snapshot_at`,
      )
      const snapshotAt = (snapshotRows.rows[0] as { snapshot_at?: unknown } | undefined)
        ?.snapshot_at
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
        throw new Error('AI export snapshot window is unavailable')
      }

      // The serving fence, restated: the merchant authorization must be enabled
      // and still carry `review_analysis`; the analysis must sit on that
      // authorization's own lineage, epoch and source epoch and at or after its
      // start sequence; the analysis, the review and the processing profile must
      // agree on the source epoch, revision and sequence; the source content must
      // not have expired; the profile must still be active; and the derivative's
      // own retention must not have lapsed.
      const reviewAnalyses = await readRows(
        snapshot,
        sql`SELECT
              analysis.property_id::text AS property_id,
              analysis.review_id::text AS review_id,
              analysis.source_epoch,
              analysis.source_revision,
              analysis.analysis_sequence,
              analysis.review_analysis_epoch,
              analysis.property_profile_version,
              analysis.analysis_profile_version,
              analysis.authorization_lineage_id::text AS authorization_lineage_id,
              analysis.status,
              analysis.unavailable_reason,
              analysis.sentiment,
              analysis.primary_category,
              analysis.attention,
              to_char(analysis.generated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS generated_at,
              to_char(analysis.expires_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS expires_at
            FROM ai_review_analyses AS analysis
            INNER JOIN merchant_ai_enablement AS merchant
              ON merchant.organization_id = analysis.organization_id
             AND merchant.property_id = analysis.property_id
            INNER JOIN ai_property_processing_profiles AS profile
              ON profile.organization_id = analysis.organization_id
             AND profile.property_id = analysis.property_id
            INNER JOIN reviews AS review
              ON review.organization_id = analysis.organization_id
             AND review.property_id = analysis.property_id
             AND review.id = analysis.review_id
            WHERE analysis.organization_id = ${organizationId}
              AND merchant.state = 'enabled'
              AND merchant.capabilities @> ARRAY['review_analysis']::text[]
              AND analysis.authorization_lineage_id = merchant.authorization_lineage_id
              AND analysis.review_analysis_epoch = merchant.review_analysis_epoch
              AND analysis.source_epoch = merchant.authorized_source_epoch
              AND analysis.analysis_sequence >= merchant.analysis_start_sequence
              AND profile.lifecycle_state = 'active'
              AND profile.profile_version = analysis.property_profile_version
              AND profile.source_epoch = analysis.source_epoch
              AND review.source_epoch = analysis.source_epoch
              AND review.source_revision = analysis.source_revision
              AND review.analysis_sequence = analysis.analysis_sequence
              AND review.content_expires_at > ${asOfIso}::timestamptz
              AND analysis.expires_at > ${asOfIso}::timestamptz`,
        (record) => [
          record.property_id,
          record.review_id,
          record.source_epoch,
          record.source_revision,
          record.analysis_sequence,
        ],
      )

      const propertyDailyAggregates = await readRows(
        snapshot,
        sql`SELECT
              aggregate.property_id::text AS property_id,
              aggregate.local_date::text AS local_date,
              aggregate.source_epoch,
              aggregate.review_analysis_epoch,
              aggregate.property_profile_version,
              aggregate.calendar_profile_version,
              aggregate.aggregate_revision,
              aggregate.terminal_analysis_sequence,
              aggregate.review_count,
              aggregate.rating_sum,
              aggregate.positive_count,
              aggregate.neutral_count,
              aggregate.negative_count,
              aggregate.mixed_count,
              aggregate.service_count,
              aggregate.staff_count,
              aggregate.quality_count,
              aggregate.value_count,
              aggregate.cleanliness_count,
              aggregate.wait_time_count,
              aggregate.atmosphere_count,
              aggregate.location_count,
              aggregate.accessibility_count,
              aggregate.other_count,
              aggregate.urgent_count,
              aggregate.high_count,
              aggregate.medium_count,
              aggregate.low_count,
              to_char(aggregate.updated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS updated_at
            FROM ai_property_daily_aggregates AS aggregate
            INNER JOIN merchant_ai_enablement AS merchant
              ON merchant.organization_id = aggregate.organization_id
             AND merchant.property_id = aggregate.property_id
            INNER JOIN ai_property_processing_profiles AS profile
              ON profile.organization_id = aggregate.organization_id
             AND profile.property_id = aggregate.property_id
            WHERE aggregate.organization_id = ${organizationId}
              AND merchant.state = 'enabled'
              AND merchant.capabilities @> ARRAY['review_analysis']::text[]
              AND aggregate.review_analysis_epoch = merchant.review_analysis_epoch
              AND aggregate.source_epoch = merchant.authorized_source_epoch
              AND profile.lifecycle_state = 'active'
              AND profile.profile_version = aggregate.property_profile_version
              AND profile.source_epoch = aggregate.source_epoch`,
        (record) => [record.property_id, record.local_date, record.aggregate_revision],
      )

      // Property Trends additionally require the `property_trends` capability
      // and the schedule's own trends epoch, so revoking only that capability
      // withdraws the trend files while Review Analysis stays exportable.
      const propertyTrendOutcomes = await readRows(
        snapshot,
        sql`SELECT
              outcome.schedule_id::text AS schedule_id,
              outcome.property_id::text AS property_id,
              schedule.due_local_date::text AS due_local_date,
              outcome.disposition,
              outcome.signal_key,
              outcome.direction,
              outcome.confidence_basis_points,
              outcome.supporting_review_count,
              outcome.headline,
              outcome.summary,
              outcome.sentences,
              outcome.selected_signal_ids,
              outcome.definition_version,
              outcome.definition_digest,
              outcome.render_profile_version,
              outcome.render_profile_digest,
              outcome.evidence,
              schedule.source_epoch,
              schedule.review_analysis_epoch,
              schedule.property_trends_epoch,
              schedule.property_profile_version,
              to_char(outcome.recorded_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS recorded_at,
              to_char(outcome.expires_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS expires_at
            FROM ai_property_trend_outcomes AS outcome
            INNER JOIN ai_property_trend_schedules AS schedule
              ON schedule.id = outcome.schedule_id
            INNER JOIN merchant_ai_enablement AS merchant
              ON merchant.organization_id = outcome.organization_id
             AND merchant.property_id = outcome.property_id
            INNER JOIN ai_property_processing_profiles AS profile
              ON profile.organization_id = outcome.organization_id
             AND profile.property_id = outcome.property_id
            WHERE outcome.organization_id = ${organizationId}
              AND merchant.state = 'enabled'
              AND merchant.capabilities @> ARRAY['property_trends']::text[]
              AND schedule.review_analysis_epoch = merchant.review_analysis_epoch
              AND schedule.property_trends_epoch = merchant.property_trends_epoch
              AND schedule.source_epoch = merchant.authorized_source_epoch
              AND profile.lifecycle_state = 'active'
              AND profile.profile_version = schedule.property_profile_version
              AND profile.source_epoch = schedule.source_epoch
              AND (
                outcome.expires_at IS NULL
                OR outcome.expires_at > ${asOfIso}::timestamptz
              )`,
        (record) => [record.property_id, record.due_local_date, record.schedule_id],
      )

      return {
        version: 'ai-organization-export/v1',
        requestedAsOf: asOfIso,
        snapshotBound: 'repeatable_read_within_15m_of_request',
        reviewAnalyses,
        propertyDailyAggregates,
        propertyTrendOutcomes,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      } as const
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * AI's Organization Export contribution (LIF-01 bullet 6, "currently retained
 * permitted AI derivatives").
 *
 * An Organization that never authorized AI, or whose authorization has been
 * disabled or revoked, has no currently retained derivative: that is the
 * affirmative `no_data`, not an invented empty CSV and not a licence to read
 * around the fence.
 */
export const createAiOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'ai' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (aiExportRecordCount(payload) === 0) {
        return {
          context: 'ai' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'ai' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildAiExportEntries(payload),
      }
    },
  })
