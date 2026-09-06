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

export type IntegrationOrganizationExportPayload = Readonly<{
  version: 'integration-organization-export/v1'
  requestedAsOf: string
  snapshotBound: 'repeatable_read_within_15m_of_request'
  googleConnections: readonly ExportRecord[]
  importSagas: readonly ExportRecord[]
  importBatches: readonly ExportRecord[]
  importItemStateCounts: readonly ExportRecord[]
  disconnectCleanupAttempts: readonly ExportRecord[]
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
 * Where the exportable line is drawn for Integration.
 *
 * `CLASSIFICATIONS_BY_CONTEXT` allows this context exactly one disclosure class,
 * `content_free_lifecycle`, and that is the whole product decision: LIF-01
 * bullet 6 asks for "content-free Google lifecycle status" while bullet 7
 * excludes OAuth material, provider-controlled identifiers and live Performance
 * payloads. So the export answers "what is the state of this Organization's
 * Google connection and its imports", never "what did Google tell us".
 *
 * Withheld, and why each one would be a disclosure rather than a status:
 *
 * - `google_connections.encrypted_access_token` / `encrypted_refresh_token` /
 *   `token_expires_at` / `encryption_key_id` are the credential itself, its
 *   validity window and the key that opens it — bullet 7's first exclusion.
 * - `google_connections.google_subject` and `scopes` are the Google-controlled
 *   identity of the grant and the exact provider authority it carries. Neither
 *   is a fact about the tenant's own records.
 * - `gbp_import_request_items` is read only as **counts grouped by state**. Its
 *   rows carry `provider_account_suffix`, `provider_location_suffix` and
 *   `google_review_uri`: provider-controlled identifiers and a Google-owned
 *   destination URI. A per-item file would put a location id in the archive,
 *   which this context may never do.
 * - `google_oauth_exchange_attempts` is the crash boundary that briefly holds an
 *   application-encrypted provider token response.
 * - `credential_revoke_permits`, `authorization_execution_permits` and
 *   `capability_*` control rows are admission/permit internals.
 * - `google_disconnect_revoke_attempts.credential_binding` is a keyed digest of
 *   the exact token being revoked, and `cleanup_work_permit_id` points at the
 *   permit plane; the attempt's state, outcome and timings are exported without
 *   them.
 * - `gbp_import_sagas` / `gbp_import_requests` replay key versions and digests
 *   are keyed idempotency material, not lifecycle status.
 * - `google_import_discovery_records` are pre-confirmation provider candidate
 *   pages behind HMAC handles — raw Google-controlled content with a 24-hour
 *   bound, copied for one browser session and never a tenant record.
 * - Business Profile Performance reports are live-only and never persisted;
 *   there is nothing to read and re-fetching one would export a live provider
 *   payload.
 */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  { recordClass: 'google_oauth_credentials', reasonCode: 'security_secret_material' },
  {
    recordClass: 'google_provider_subject_and_scopes',
    reasonCode: 'provider_grant_identity',
  },
  {
    recordClass: 'google_oauth_exchange_attempts',
    reasonCode: 'security_secret_material',
  },
  {
    recordClass: 'google_disconnect_credential_binding',
    reasonCode: 'security_secret_material',
  },
  {
    recordClass: 'provider_execution_and_revoke_permits',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'google_import_replay_digests',
    reasonCode: 'content_free_control_plane',
  },
  {
    recordClass: 'google_provider_account_and_location_identifiers',
    reasonCode: 'provider_controlled_identifiers',
  },
  {
    recordClass: 'google_import_discovery_candidates',
    reasonCode: 'provider_controlled_content',
  },
  { recordClass: 'legacy_gbp_provider_cache', reasonCode: 'provider_controlled_content' },
  {
    recordClass: 'google_business_profile_performance_reports',
    reasonCode: 'live_provider_payload',
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
      throw new Error(`Integration export field is invalid: ${field}`)
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
  throw new Error(`Integration export field has an unsupported value: ${field}`)
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
 * Digit-only parts are zero-padded before the byte comparison, because raw byte
 * order would otherwise put authority generation 10 before 9.
 */
export function sortIntegrationExportRows(
  rows: readonly Record<string, unknown>[],
  sortKey: (record: ExportRecord) => readonly (ExportValue | undefined)[],
): readonly ExportRecord[] {
  return rows
    .map(toExportedRecord)
    .map((record) => ({
      record,
      key: sortKey(record)
        .map((part) => {
          if (part === null || part === undefined) return ''
          const text = String(part)
          return DIGITS_ONLY.test(text) ? text.padStart(19, '0') : text
        })
        .join(' '),
    }))
    .sort((left, right) => compareUtf8(left.key, right.key))
    .map(({ record }) => record)
}

async function readRows(
  snapshot: Parameters<Parameters<Database['transaction']>[0]>[0],
  query: SQL,
  sortKey: (record: ExportRecord) => readonly (ExportValue | undefined)[],
): Promise<readonly ExportRecord[]> {
  const result = await snapshot.execute(query)
  return sortIntegrationExportRows(result.rows as Record<string, unknown>[], sortKey)
}

function csvField(value: ExportValue | undefined): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? canonicalizeRfc8785(value) : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const CSV_COLUMNS = [
  'record_type',
  'record_id',
  'connection_id',
  'state',
  'reason',
  'item_count',
  'occurred_at',
  'updated_at',
  'record_json',
] as const

/**
 * The CSV is the human view of one flat lifecycle log. Every row still carries
 * its canonical `record_json`, because the JSON file is the lossless authority
 * and the two must never disagree about what was exported.
 */
function csvRow(recordType: string, record: ExportRecord): readonly string[] {
  const values: Readonly<Record<(typeof CSV_COLUMNS)[number], ExportValue | undefined>> =
    {
      record_type: recordType,
      record_id: record.id ?? record.import_job_id ?? '',
      connection_id: record.connection_id ?? '',
      state: record.status ?? record.state ?? '',
      reason: record.status_reason ?? record.outcome_code ?? record.action ?? '',
      item_count: record.item_count ?? record.total_count ?? '',
      occurred_at: record.created_at ?? record.activated_at ?? '',
      updated_at: record.updated_at ?? record.terminal_at ?? '',
      record_json: record,
    }
  return CSV_COLUMNS.map((column) => csvField(values[column]))
}

type IntegrationExportCollection =
  | 'googleConnections'
  | 'importSagas'
  | 'importBatches'
  | 'importItemStateCounts'
  | 'disconnectCleanupAttempts'

const CSV_COLLECTIONS: readonly (readonly [string, IntegrationExportCollection])[] =
  Object.freeze([
    ['google_connection', 'googleConnections'],
    ['import_saga', 'importSagas'],
    ['import_batch', 'importBatches'],
    ['import_item_state_count', 'importItemStateCounts'],
    ['disconnect_cleanup_attempt', 'disconnectCleanupAttempts'],
  ])

export function integrationExportRecordCount(
  payload: IntegrationOrganizationExportPayload,
): number {
  return CSV_COLLECTIONS.reduce((total, [, field]) => total + payload[field].length, 0)
}

/**
 * The two files this context contributes. Both are `content_free_lifecycle`:
 * the only disclosure class the contract permits Integration to stamp.
 */
export function buildIntegrationExportEntries(
  payload: IntegrationOrganizationExportPayload,
): readonly OrganizationExportEntry[] {
  const lines = [
    CSV_COLUMNS.join(','),
    ...CSV_COLLECTIONS.flatMap(([recordType, field]) =>
      payload[field].map((record) => csvRow(recordType, record).join(',')),
    ),
  ]
  return [
    {
      path: 'integration/google-lifecycle.csv',
      mediaType: 'text/csv',
      classification: 'content_free_lifecycle',
      bytes: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
    },
    {
      path: 'integration/google-lifecycle.json',
      mediaType: 'application/json',
      classification: 'content_free_lifecycle',
      bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8'),
    },
  ]
}

const UTC_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

async function readPayload(
  db: Database,
  organizationId: string,
  asOf: Date,
): Promise<IntegrationOrganizationExportPayload> {
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
        throw new Error('Integration export snapshot window is unavailable')
      }

      const googleConnections = await readRows(
        snapshot,
        sql`SELECT
              connection.id::text AS id,
              connection.status::text AS status,
              connection.visibility::text AS visibility,
              connection.credential_use_state::text AS credential_use_state,
              connection.lifecycle_version,
              connection.access_version,
              connection.credential_generation,
              connection.connected_by,
              connection.credential_authorized_by,
              connection.status_reason,
              to_char(connection.credential_authorized_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS credential_authorized_at,
              to_char(connection.last_successful_sync_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS last_successful_sync_at,
              to_char(connection.status_changed_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS status_changed_at,
              to_char(connection.cleanup_material_deadline_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS cleanup_material_deadline_at,
              to_char(connection.created_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS created_at,
              to_char(connection.updated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS updated_at
            FROM google_connections AS connection
            WHERE connection.organization_id = ${organizationId}`,
        (record) => [record.created_at, record.id],
      )

      const importSagas = await readRows(
        snapshot,
        sql`SELECT
              saga.id::text AS id,
              saga.request_id::text AS request_id,
              saga.initiated_by,
              saga.total_count,
              saga.batch_count,
              to_char(saga.created_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS created_at,
              to_char(saga.updated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS updated_at
            FROM gbp_import_sagas AS saga
            WHERE saga.organization_id = ${organizationId}`,
        (record) => [record.created_at, record.id],
      )

      const importBatches = await readRows(
        snapshot,
        sql`SELECT
              request.id::text AS id,
              request.saga_id::text AS saga_id,
              request.batch_ordinal,
              request.request_id::text AS request_id,
              request.initiated_by,
              request.status::text AS status,
              request.total_count,
              request.processed_count,
              request.pending_count,
              request.processing_count,
              request.imported_count,
              request.relinked_count,
              request.already_exists_count,
              request.failed_count,
              request.cancelled_count,
              to_char(request.first_terminal_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS first_terminal_at,
              to_char(request.purge_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS purge_at,
              to_char(request.created_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS created_at,
              to_char(request.updated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS updated_at
            FROM gbp_import_requests AS request
            WHERE request.organization_id = ${organizationId}`,
        (record) => [record.created_at, record.id],
      )

      // Per-item rows carry provider account/location suffixes and the
      // Google-owned review URI, so the archive gets the shape of the work —
      // how many items reached which state — and never the provider handles.
      const importItemStateCounts = await readRows(
        snapshot,
        sql`SELECT
              item.import_job_id::text AS import_job_id,
              item.status::text AS status,
              item.action::text AS action,
              item.outcome_code::text AS outcome_code,
              count(*)::int AS item_count,
              to_char(min(item.created_at) AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS first_created_at,
              to_char(max(item.updated_at) AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS last_updated_at
            FROM gbp_import_request_items AS item
            WHERE item.organization_id = ${organizationId}
            GROUP BY item.import_job_id, item.status, item.action, item.outcome_code`,
        (record) => [
          record.import_job_id,
          record.status,
          record.action,
          record.outcome_code,
        ],
      )

      const disconnectCleanupAttempts = await readRows(
        snapshot,
        sql`SELECT
              attempt.id::text AS id,
              attempt.connection_id::text AS connection_id,
              attempt.initiator_user_id,
              attempt.state::text AS state,
              attempt.outcome_code,
              attempt.expected_lifecycle_version,
              attempt.expected_access_version,
              attempt.expected_credential_generation,
              to_char(attempt.activated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS activated_at,
              to_char(attempt.cleanup_deadline_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS cleanup_deadline_at,
              to_char(attempt.dispatching_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS dispatching_at,
              to_char(attempt.terminal_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS terminal_at,
              to_char(attempt.created_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS created_at,
              to_char(attempt.updated_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP_FORMAT}) AS updated_at
            FROM google_disconnect_revoke_attempts AS attempt
            WHERE attempt.organization_id = ${organizationId}`,
        (record) => [record.activated_at, record.id],
      )

      return {
        version: 'integration-organization-export/v1',
        requestedAsOf: asOf.toISOString(),
        snapshotBound: 'repeatable_read_within_15m_of_request',
        googleConnections,
        importSagas,
        importBatches,
        importItemStateCounts,
        disconnectCleanupAttempts,
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      } as const
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Integration's Organization Export contribution (LIF-01 bullet 6,
 * "content-free Google lifecycle status").
 *
 * An Organization that never connected Google has no Google lifecycle at all:
 * that is the affirmative `no_data`, not an invented empty CSV. It is also not a
 * reason to reach for the provider planes this file deliberately refuses.
 */
export const createIntegrationOrganizationExportContributor = (
  db: Database,
): OrganizationExportContributor =>
  Object.freeze({
    context: 'integration' as const,
    async contribute({ organizationId, asOf }) {
      const payload = await readPayload(db, organizationId, asOf)
      if (integrationExportRecordCount(payload) === 0) {
        return {
          context: 'integration' as const,
          coverage: 'no_data' as const,
          omissionCodes: [],
          entries: [],
        }
      }
      return {
        context: 'integration' as const,
        coverage: 'complete' as const,
        omissionCodes: [],
        entries: buildIntegrationExportEntries(payload),
      }
    },
  })
