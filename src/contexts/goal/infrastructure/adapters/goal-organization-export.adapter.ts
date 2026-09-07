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
  /** File stem under `goal/`; also the family name inside the JSON payload. */
  name: string
  collections: readonly ExportCollection[]
}>

/**
 * The same bounded snapshot Identity's reference contributor uses, so a stale
 * queued request fails closed in every context of one bundle rather than
 * mixing a fresh Goal snapshot into an otherwise expired archive.
 */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXPORT_PAYLOAD_VERSION = 'goal-organization-export/v1' as const
const SNAPSHOT_BOUND = 'repeatable_read_within_15m_of_request' as const

/**
 * GOA-01: a Goal subject is a Property, a Portal Group, or a Portal. Person-
 * and Team-scoped goals are prohibited, so the export refuses to widen even if
 * a future row were to appear — the archive must not be the place a prohibited
 * scope first becomes visible.
 */
const EXPORTABLE_SUBJECT_KINDS = sql`('property', 'portal_group', 'portal')`

const PROGRAM_COLUMNS = [
  'id',
  'property_id',
  'name',
  'description',
  'status',
  'status_reason',
  'current_version',
  'created_by',
  'created_at',
  'updated_at',
] as const

const PROGRAM_VERSION_COLUMNS = [
  'id',
  'program_id',
  'property_id',
  'version',
  'metric_definition_id',
  'metric_definition_version_id',
  'metric_key',
  'metric_minimum_sample',
  'target_value',
  'property_timezone',
  'effective_from',
  'effective_to',
  'change_reason',
  'created_by',
  'created_at',
] as const

const SUBJECT_ASSIGNMENT_COLUMNS = [
  'id',
  'program_id',
  'program_version_id',
  'property_id',
  'metric_key',
  'subject_kind',
  'property_subject_id',
  'portal_group_id',
  'portal_id',
  'effective_from',
  'effective_to',
  'created_by',
  'created_at',
] as const

const MONTHLY_RESULT_COLUMNS = [
  'id',
  'assignment_id',
  'program_id',
  'program_version_id',
  'property_id',
  'period_start',
  'period_end',
  'property_timezone',
  'status',
  'evaluation_state',
  'value',
  'sample_count',
  'achieved',
  'reason',
  'source_complete_through',
  'evaluation_watermark',
  'closed_at',
  'created_at',
  'updated_at',
] as const

const RESULT_REVISION_COLUMNS = [
  'id',
  'monthly_result_id',
  'property_id',
  'revision',
  'supersedes_revision_id',
  'evaluation_state',
  'value',
  'sample_count',
  'achieved',
  'reason',
  'source_complete_through',
  'evaluation_watermark',
  'change_reason',
  'created_by',
  'created_at',
] as const

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Goal export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value === undefined) throw new Error(`Goal export column is missing: ${field}`)
  throw new Error(`Goal export field has an unsupported value: ${field}`)
}

/**
 * Projects exactly the declared columns, so a SELECT that stops producing a
 * declared alias fails here instead of emitting a CSV column that no longer
 * agrees with the JSON authority.
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
    path: `goal/${family.name}.csv`,
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(family: ExportFamily, asOf: Date): OrganizationExportEntry {
  return {
    path: `goal/${family.name}.json`,
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
    throw new Error('Goal export snapshot window is unavailable')
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

      // Canonical beta family: the Program, its immutable version intervals,
      // and the three governed measures (qualified scans, rating count,
      // rating average) they pin.
      const programs = await readRows(
        snapshot,
        sql`SELECT
              id,
              property_id,
              name,
              description,
              status,
              status_reason,
              current_version,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM goal_programs
            WHERE organization_id = ${organizationId}
            ORDER BY property_id, created_at, id`,
      )
      const programVersions = await readRows(
        snapshot,
        sql`SELECT
              id,
              program_id,
              property_id,
              version,
              metric_definition_id,
              metric_definition_version_id,
              metric_key,
              metric_minimum_sample,
              target_value,
              property_timezone,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              change_reason,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM goal_program_versions
            WHERE organization_id = ${organizationId}
            ORDER BY program_id, version`,
      )

      // Both Portal Group and Portal subjects are exported: a Portal may be
      // ungrouped, so exporting only the group scope would silently drop every
      // goal an ungrouped Portal carries.
      const subjectAssignments = await readRows(
        snapshot,
        sql`SELECT
              id,
              program_id,
              program_version_id,
              property_id,
              metric_key,
              subject_kind,
              property_subject_id,
              portal_group_id,
              portal_id,
              to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_from,
              to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_to,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM goal_subject_assignments
            WHERE organization_id = ${organizationId}
              AND subject_kind IN ${EXPORTABLE_SUBJECT_KINDS}
            ORDER BY program_id, program_version_id, effective_from, id`,
      )

      const monthlyResults = await readRows(
        snapshot,
        sql`SELECT
              id,
              assignment_id,
              program_id,
              program_version_id,
              property_id,
              to_char(period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_start,
              to_char(period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS period_end,
              property_timezone,
              status,
              evaluation_state,
              value,
              sample_count,
              achieved,
              reason,
              to_char(source_complete_through AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_complete_through,
              to_char(evaluation_watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluation_watermark,
              to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM goal_monthly_results
            WHERE organization_id = ${organizationId}
            ORDER BY program_id, assignment_id, period_start, id`,
      )
      const resultRevisions = await readRows(
        snapshot,
        sql`SELECT
              id,
              monthly_result_id,
              property_id,
              revision,
              supersedes_revision_id,
              evaluation_state,
              value,
              sample_count,
              achieved,
              reason,
              to_char(source_complete_through AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_complete_through,
              to_char(evaluation_watermark AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluation_watermark,
              change_reason,
              created_by,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM goal_result_revisions
            WHERE organization_id = ${organizationId}
            ORDER BY monthly_result_id, revision`,
      )

      // Declared in ascending path order so the emitted entries already agree
      // with the archive's UTF-8 byte ordering.
      return [
        {
          name: 'programs',
          collections: [
            {
              recordType: 'goal_program',
              columns: PROGRAM_COLUMNS,
              records: projectRows(programs, PROGRAM_COLUMNS),
            },
            {
              recordType: 'goal_program_version',
              columns: PROGRAM_VERSION_COLUMNS,
              records: projectRows(programVersions, PROGRAM_VERSION_COLUMNS),
            },
          ],
        },
        {
          name: 'results',
          collections: [
            {
              recordType: 'goal_monthly_result',
              columns: MONTHLY_RESULT_COLUMNS,
              records: projectRows(monthlyResults, MONTHLY_RESULT_COLUMNS),
            },
            {
              recordType: 'goal_result_revision',
              columns: RESULT_REVISION_COLUMNS,
              records: projectRows(resultRevisions, RESULT_REVISION_COLUMNS),
            },
          ],
        },
        {
          name: 'subject-assignments',
          collections: [
            {
              recordType: 'goal_subject_assignment',
              columns: SUBJECT_ASSIGNMENT_COLUMNS,
              records: projectRows(subjectAssignments, SUBJECT_ASSIGNMENT_COLUMNS),
            },
          ],
        },
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Goal's Organization Export contribution.
 *
 * Exports each Goal Program and its immutable version intervals, Property,
 * Portal Group, and Portal subject assignments, and every monthly result with
 * its revision chain.
 *
 * It reads no metric table: a Goal result carries its own value, sample count,
 * state, and completeness evidence, while Metric stays the single owner of
 * metric rows.
 */
export const createGoalOrganizationExportAdapter = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'goal' as const,
    async contribute({ organizationId, asOf }) {
      const families = await readFamilies(db, organizationId, asOf)
      const populated = families.filter((family) =>
        family.collections.some((collection) => collection.records.length > 0),
      )
      if (populated.length === 0) {
        // An affirmative "this Organization configured no goal", never an
        // invented empty CSV.
        return {
          context: 'goal' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'goal' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: populated.flatMap((family) => [
          csvEntry(family),
          jsonEntry(family, asOf),
        ]),
      }
    },
  })
