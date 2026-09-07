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

/**
 * The same bounded snapshot Identity's reference contributor uses, so a stale
 * queued request fails closed in every context of one bundle rather than
 * mixing a fresh Dashboard snapshot into an otherwise expired archive.
 */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

const EXPORT_PAYLOAD_VERSION = 'dashboard-organization-export/v1' as const
const SNAPSHOT_BOUND = 'repeatable_read_within_15m_of_request' as const

/**
 * LIF-01 bullet 7 and the honesty rule, decided per record class.
 *
 * Dashboard is a read surface: its fleet overview, KPI, portal-analytics, and
 * attention projections are governed reads over rows Metric, Review, Guest,
 * and Inbox already own and already export. Re-emitting them under a second
 * `dashboard/` path would duplicate the archive and invent a second authority
 * for the same fact, so the only rows exported here are the ones Dashboard
 * durably owns: the monotonic onboarding milestones.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'metric_and_review_read_projections',
    reasonCode: 'owned_and_exported_by_the_source_context',
  },
  {
    recordClass: 'attention_and_fleet_overview_derivations',
    reasonCode: 'derived_read_surface_without_durable_rows',
  },
])

const MILESTONE_COLUMNS = ['step', 'first_completed_at', 'created_at'] as const

function normalizeScalar(value: unknown, field: string): ExportScalar {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Dashboard export field is invalid: ${field}`)
    }
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (value === undefined) throw new Error(`Dashboard export column is missing: ${field}`)
  throw new Error(`Dashboard export field has an unsupported value: ${field}`)
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

function csvEntry(records: readonly ExportRecord[]): OrganizationExportEntry {
  const header = ['record_type', ...MILESTONE_COLUMNS]
  const lines = [
    header.join(','),
    ...records.map((record) =>
      header
        .map((column) =>
          csvField(
            column === 'record_type' ? 'setup_checklist_milestone' : record[column],
          ),
        )
        .join(','),
    ),
  ]
  return {
    path: 'dashboard/setup-checklist.csv',
    mediaType: 'text/csv',
    classification: 'tenant_visible',
    bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
  }
}

function jsonEntry(
  records: readonly ExportRecord[],
  asOf: Date,
): OrganizationExportEntry {
  return {
    path: 'dashboard/setup-checklist.json',
    mediaType: 'application/json',
    classification: 'tenant_visible',
    bytes: Buffer.from(
      `${canonicalizeRfc8785({
        version: EXPORT_PAYLOAD_VERSION,
        family: 'setup-checklist',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: SNAPSHOT_BOUND,
        records: { setup_checklist_milestone: records },
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
    throw new Error('Dashboard export snapshot window is unavailable')
  }
}

async function readMilestones(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<readonly ExportRecord[]> {
  return db.transaction(
    async (snapshot) => {
      await assertBoundedSnapshot(snapshot, asOf)
      // `organization_id` is the export scope, not a record field — repeating
      // the requested tenant in every row adds no fact.
      const rows = await readRows(
        snapshot,
        sql`SELECT
              step,
              to_char(first_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_completed_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM setup_checklist_milestones
            WHERE organization_id = ${organizationId}
            ORDER BY step`,
      )
      return projectRows(rows, MILESTONE_COLUMNS)
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Dashboard's Organization Export contribution.
 *
 * Dashboard owns exactly one durable tenant-visible table — the content-free
 * onboarding milestones behind the Setup Checklist — so that is all it
 * contributes. An Organization that never completed a milestone gets an
 * affirmative `no_data`: an empty CSV would claim a checklist exists, and
 * copying Metric's rows under a `dashboard/` path would fabricate a second
 * authority for numbers Metric already exports.
 */
export const createDashboardOrganizationExportAdapter = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'dashboard' as const,
    async contribute({ organizationId, asOf }) {
      const records = await readMilestones(db, organizationId, asOf)
      if (records.length === 0) {
        return {
          context: 'dashboard' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'dashboard' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: [csvEntry(records), jsonEntry(records, asOf)],
      }
    },
  })
