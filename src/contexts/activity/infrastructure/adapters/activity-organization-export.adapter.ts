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
import {
  REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
  SYSTEM_USER_ID,
} from '../../domain/constructors'

type ExportValue =
  | string
  | number
  | boolean
  | null
  | readonly ExportValue[]
  | Readonly<{ [key: string]: ExportValue }>

type ExportRecord = Readonly<Record<string, ExportValue>>

export type ActivityOrganizationExportPayload = Readonly<{
  version: 'activity-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  recentActivity: readonly ExportRecord[]
  excludedRecordClasses: readonly Readonly<{
    recordClass: string
    reasonCode: string
  }>[]
}>

/**
 * Same bounded read-only snapshot the Identity contributor uses. Every
 * contribution in one bundle must describe the same instant, so a request that
 * has been queued too long fails closed instead of silently exporting a
 * different `asOf` than the manifest claims.
 */
const MAX_SNAPSHOT_LAG_MS = 15 * 60 * 1000

/**
 * Where the tenant-visible line is drawn for Activity.
 *
 * LIF-01 bullet 6 asks for **Recent Activity**, and bullet 7 restricts
 * **Operational Action History**. Those two were deliberately separated in this
 * context (see CONTEXT.md: Operational Action History "is not
 * `recent_activity_entries`, is never exposed as the product feed"), so the
 * export reads `recent_activity_entries` and nothing else:
 *
 * - `operational_action_history_records`, `_heads` and `_legal_holds` are the
 *   restricted history bullet 7 names outright. Exporting them here would
 *   re-merge the split and would also bypass the AccountAdmin authority verdict
 *   that its own list/export use cases require.
 * - `recent_activity_replay_facts` is the rebuild control plane: source event
 *   identity, versions and dispositions, not a fact about the tenant.
 * - `recent_activity_actor_label_redactions` is a content-free privacy fence.
 *   It is *read* below to honour redaction, but it is never exported: the fence
 *   would otherwise re-identify the very actor it anonymized.
 * - `activity_vocabulary_reconciliation` idempotency receipts are operator
 *   governance records with authorization evidence references.
 * - `audit_logs` is the legacy unattributed archive CONTEXT.md refuses to treat
 *   as canonical history; its provenance cannot be inferred, so it cannot be
 *   honestly classified as tenant-visible.
 *
 * `recent_activity_entries.event_id` is withheld for the same reason as the
 * replay authority: it is the durable outbox/consumer correlation key that makes
 * projection idempotent, not tenant content.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'operational_action_history',
    reasonCode: 'restricted_operational_action_history',
  },
  {
    recordClass: 'recent_activity_replay_facts',
    reasonCode: 'projection_rebuild_control_plane',
  },
  {
    recordClass: 'recent_activity_actor_label_redactions',
    reasonCode: 'privacy_fence_control_plane',
  },
  {
    recordClass: 'activity_vocabulary_reconciliation_receipts',
    reasonCode: 'operator_governance_receipts',
  },
  { recordClass: 'legacy_audit_logs', reasonCode: 'unattributed_legacy_archive' },
  {
    recordClass: 'recent_activity_source_event_correlation_ids',
    reasonCode: 'durable_projection_correlation',
  },
])

/**
 * The exact actor shape this context already writes when an actor is anonymized
 * — `withRedactedRecentActivityActor` and the privacy store apply these same
 * three replacements. The export honours the fence rather than deriving its own
 * redaction rule; the unit test beside this file pins the two together.
 */
const REDACTED_ACTOR = Object.freeze({
  actor_id: SYSTEM_USER_ID as string,
  actor_name: REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
  actor_avatar_url: null,
  actor_role: 'Staff',
})

/** UTF-8 byte order — never host-locale collation. */
function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function normalizeValue(value: unknown, field: string): ExportValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`Activity export field is invalid: ${field}`)
    return value
  }
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (Array.isArray(value)) {
    return (value as readonly unknown[]).map((item, index) =>
      normalizeValue(item, `${field}[${index}]`),
    )
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, normalizeValue(item, `${field}.${key}`)]),
    )
  }
  throw new Error(`Activity export field has an unsupported value: ${field}`)
}

/**
 * One projected entry, with the redaction fence applied. `actor_label_redacted`
 * is the join marker, not an exported field: keeping it would republish which
 * subject the fence covers.
 */
export function toExportedEntry(row: Record<string, unknown>): ExportRecord {
  const { actor_label_redacted: redacted, ...rest } = row
  const normalized = Object.fromEntries(
    Object.entries(rest).map(([field, value]) => [field, normalizeValue(value, field)]),
  )
  return redacted === true ? { ...normalized, ...REDACTED_ACTOR } : normalized
}

/**
 * `created_at` is a fixed-width UTC string and `id` is unique, so this key is a
 * total order that does not depend on the order PostgreSQL happened to return.
 * Ordering lives here rather than in an `ORDER BY` so the one comparison that
 * decides the exported bytes is byte-order, and is testable without a database.
 */
function sortKey(record: ExportRecord): string {
  return `${String(record.created_at ?? '')} ${String(record.id ?? '')}`
}

function sortRecords(records: readonly ExportRecord[]): readonly ExportRecord[] {
  return [...records].sort((left, right) => compareUtf8(sortKey(left), sortKey(right)))
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<readonly ExportRecord[]> {
  const result = await snapshot.execute(query)
  return (result.rows as Record<string, unknown>[]).map(toExportedEntry)
}

function csvField(value: ExportValue | undefined): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? canonicalizeRfc8785(value) : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const RECENT_ACTIVITY_COLUMNS = [
  'id',
  'created_at',
  'actor_id',
  'actor_name',
  'actor_avatar_url',
  'actor_role',
  'action',
  'resource_type',
  'resource_id',
  'property_id',
  'payload',
  'source',
] as const

/**
 * The two files this context contributes. CSV is the human view of the feed;
 * the JSON payload is the lossless authority and carries the
 * deliberate-exclusion record so the archive states what was withheld.
 */
export function buildActivityExportEntries(
  payload: ActivityOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const recentActivity = sortRecords(payload.recentActivity)
  const lines = [
    RECENT_ACTIVITY_COLUMNS.join(','),
    ...recentActivity.map((record) =>
      RECENT_ACTIVITY_COLUMNS.map((column) => csvField(record[column])).join(','),
    ),
  ]
  return [
    {
      path: 'activity/recent-activity.csv',
      mediaType: 'text/csv',
      classification: 'tenant_visible',
      bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
    },
    {
      path: 'activity/recent-activity.json',
      mediaType: 'application/json',
      classification: 'tenant_visible',
      bytes: Buffer.from(
        `${canonicalizeRfc8785({ ...payload, recentActivity })}\n`,
        'utf8',
      ),
    },
  ]
}

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<ActivityOrganizationExportPayload> {
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
        throw new Error('Activity export snapshot window is unavailable')
      }

      const recentActivity = await readRows(
        snapshot,
        sql`SELECT
              entry.id::text AS id,
              entry.actor_id,
              entry.actor_name,
              entry.actor_avatar_url,
              entry.actor_role,
              entry.action,
              entry.resource_type,
              entry.resource_id,
              entry.property_id,
              entry.payload,
              entry.source,
              to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              (fence.actor_subject_id IS NOT NULL) AS actor_label_redacted
            FROM recent_activity_entries AS entry
            LEFT JOIN recent_activity_actor_label_redactions AS fence
              ON fence.organization_id = entry.organization_id
             AND fence.actor_subject_id = entry.actor_id
            WHERE entry.organization_id = ${organizationId}`,
      )

      return {
        version: 'activity-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        recentActivity,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      } as const
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Activity's Organization Export contribution (LIF-01 bullet 6, "Recent
 * Activity").
 *
 * Recent Activity is a bounded 90-day projection, so an Organization whose feed
 * has expired or never materialized has nothing tenant-visible here: that is the
 * affirmative `no_data`, not an invented empty CSV, and it is emphatically not a
 * licence to fall back to the restricted Operational Action History.
 */
export const createActivityOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'activity' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (payload.recentActivity.length === 0) {
        return {
          context: 'activity' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'activity' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildActivityExportEntries(payload),
      }
    },
  })
