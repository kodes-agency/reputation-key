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

export type NotificationOrganizationExportPayload = Readonly<{
  version: 'notification-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  notifications: readonly ExportRecord[]
  preferences: readonly ExportRecord[]
  userSettings: readonly ExportRecord[]
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
 * Where the tenant-visible line is drawn for Notification.
 *
 * The product surface a manager can actually see is the notification record
 * itself plus the delivery settings they chose: `notifications` (the Bell feed,
 * including its rendered title/body and read state), `notification_preferences`
 * (their per-Property category/channel policy) and `notification_user_settings`
 * (locale/timezone). Everything else this context owns is delivery machinery,
 * which LIF-01 bullet 7 excludes as queues/outbox/receipts/rate limits:
 *
 * - `notification_email_queue` is the send queue. Its provider message id,
 *   provider state, acceptance/delivery/bounce timestamps, suppression reason,
 *   retry counters and idempotency key are provider acceptance internals and
 *   delivery receipts, and its immediate-acceptance health index exists purely
 *   for operational health. None of that is tenant-visible product data.
 * - `notification_digest_batches` / `notification_digest_batch_members` are the
 *   immutable provider-idempotency batches behind one email attempt — outbox
 *   and receipt material by construction (content digests, provider keys,
 *   unsubscribe key versions).
 * - `notification_unsubscribe_scopes` is what a delivered message's one-click
 *   link stands for: delivery-queue material, exported as its preference
 *   effect when the link is used. `notification_email_suppressions` belongs to
 *   no Organization.
 *
 * `notifications.event_id` is withheld for the same reason: it is the durable
 * outbox/consumer correlation key that makes delivery idempotent, not a fact
 * about the tenant. The notification's own resource_type/resource_id — the link
 * the manager clicks — is exported instead.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  {
    recordClass: 'notification_email_delivery_queue',
    reasonCode: 'delivery_queue_and_provider_receipts',
  },
  {
    recordClass: 'notification_digest_batches_and_members',
    reasonCode: 'delivery_batch_and_provider_idempotency',
  },
  {
    recordClass: 'notification_provider_acceptance_and_health_signals',
    reasonCode: 'operational_delivery_health',
  },
  {
    recordClass: 'notification_source_event_correlation_ids',
    reasonCode: 'durable_delivery_correlation',
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
    if (!Number.isFinite(value))
      throw new Error(`Notification export field is invalid: ${field}`)
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
  throw new Error(`Notification export field has an unsupported value: ${field}`)
}

function normalizeRows(rows: readonly Record<string, unknown>[]): ExportRecord[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([field, value]) => [field, normalizeValue(value, field)]),
    ),
  )
}

/**
 * `created_at` is a fixed-width UTC string and `id` is unique, so this key is a
 * total order that does not depend on the order PostgreSQL happened to return.
 * Ordering lives here rather than in an `ORDER BY` so the one comparison that
 * decides the exported bytes is byte-order, and is testable without a database.
 */
function sortKey(record: ExportRecord): string {
  return `${String(record.created_at ?? '')}\u0000${String(record.id ?? '')}`
}

function sortRecords(records: readonly ExportRecord[]): readonly ExportRecord[] {
  return [...records].sort((left, right) => compareUtf8(sortKey(left), sortKey(right)))
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
): Promise<readonly ExportRecord[]> {
  const result = await snapshot.execute(query)
  return normalizeRows(result.rows as Record<string, unknown>[])
}

function csvField(value: ExportValue | undefined): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? canonicalizeRfc8785(value) : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csvEntry(
  path: string,
  columns: readonly string[],
  records: readonly ExportRecord[],
): OrganizationExportEntry {
  const lines = [
    columns.join(','),
    ...records.map((record) =>
      columns.map((column) => csvField(record[column])).join(','),
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

const NOTIFICATION_COLUMNS = [
  'id',
  'user_id',
  'property_id',
  'type',
  'category',
  'priority',
  'status',
  'resource_type',
  'resource_id',
  'title',
  'body',
  'payload',
  'coalesced_count',
  'coalesced_latest_at',
  'read_at',
  'created_at',
  'updated_at',
] as const

const PREFERENCE_COLUMNS = [
  'id',
  'user_id',
  'property_id',
  'category',
  'channel',
  'enabled',
  'cadence',
  'urgent_bypass_enabled',
  'quiet_hours_start',
  'quiet_hours_end',
  'created_at',
  'updated_at',
] as const

const USER_SETTINGS_COLUMNS = [
  'id',
  'user_id',
  'locale',
  'timezone',
  'created_at',
  'updated_at',
] as const

/**
 * The six files this context contributes. CSV is the human view of each record
 * class; the single JSON payload is the lossless authority and also carries the
 * deliberate-exclusion record so the archive states what was withheld.
 */
export function buildNotificationExportEntries(
  payload: NotificationOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const notifications = sortRecords(payload.notifications)
  const preferences = sortRecords(payload.preferences)
  const userSettings = sortRecords(payload.userSettings)
  const header = {
    version: payload.version,
    requestedAsOf: payload.requestedAsOf,
    snapshotBound: payload.snapshotBound,
  } as const
  return [
    csvEntry('notification/notifications.csv', NOTIFICATION_COLUMNS, notifications),
    jsonEntry('notification/notifications.json', {
      ...header,
      notifications,
      excludedRecordClasses: payload.excludedRecordClasses,
    }),
    csvEntry('notification/preferences.csv', PREFERENCE_COLUMNS, preferences),
    jsonEntry('notification/preferences.json', { ...header, preferences }),
    csvEntry('notification/user-settings.csv', USER_SETTINGS_COLUMNS, userSettings),
    jsonEntry('notification/user-settings.json', { ...header, userSettings }),
  ]
}

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<NotificationOrganizationExportPayload> {
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
        throw new Error('Notification export snapshot window is unavailable')
      }

      const notifications = await readRows(
        snapshot,
        sql`SELECT
              id::text AS id,
              user_id,
              property_id::text AS property_id,
              type,
              category,
              priority,
              status,
              resource_type,
              resource_id,
              title,
              body,
              payload,
              coalesced_count,
              to_char(coalesced_latest_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS coalesced_latest_at,
              to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS read_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM notifications
            WHERE organization_id = ${organizationId}`,
      )
      const preferences = await readRows(
        snapshot,
        sql`SELECT
              id::text AS id,
              user_id,
              property_id::text AS property_id,
              category,
              channel,
              enabled,
              cadence,
              urgent_bypass_enabled,
              quiet_hours_start::text AS quiet_hours_start,
              quiet_hours_end::text AS quiet_hours_end,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM notification_preferences
            WHERE organization_id = ${organizationId}`,
      )
      const userSettings = await readRows(
        snapshot,
        sql`SELECT
              id::text AS id,
              user_id,
              locale,
              timezone,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
            FROM notification_user_settings
            WHERE organization_id = ${organizationId}`,
      )

      return {
        version: 'notification-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        notifications,
        preferences,
        userSettings,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      } as const
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Notification's Organization Export contribution (LIF-01 bullet 6).
 *
 * An Organization that never received a notification and never changed a
 * delivery setting has nothing tenant-visible here, so the contribution is the
 * affirmative `no_data` rather than an invented empty CSV.
 */
export const createNotificationOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'notification' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      const isEmpty =
        payload.notifications.length === 0 &&
        payload.preferences.length === 0 &&
        payload.userSettings.length === 0
      if (isEmpty) {
        return {
          context: 'notification' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'notification' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildNotificationExportEntries(payload),
      }
    },
  })
