// SQL behind the Google rights executor (src/shared/ops/rights): what an
// Organization's Google connection and imports hold, the allowlisted export
// payload, and the closure scrub. Every statement is scoped to one
// organization_id. Credentials, the Google subject, email and scopes, provider
// account and location identifiers, replay digests and discovery candidates
// are never selected for export.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'

const EXPORT_VERSION = 'integration-rights-export/v1'

const UTC = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

/** Record classes the export never contains, with the reason each is withheld. */
const EXCLUDED_RECORD_CLASSES = Object.freeze([
  { recordClass: 'google_oauth_credentials', reasonCode: 'security_secret_material' },
  {
    recordClass: 'google_provider_subject_and_scopes',
    reasonCode: 'provider_grant_identity',
  },
  {
    recordClass: 'google_oauth_exchange_receipts',
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
])

type Row = Readonly<Record<string, unknown>>

/** Tables whose rows for the Organization are deleted at closure, children first. */
const PURGE_DELETE_TABLES = Object.freeze([
  'gbp_import_request_items',
  'gbp_import_requests',
  'gbp_import_sagas',
  'google_import_discovery_records',
] as const)

const BLOCKER_CODES = Object.freeze([
  'live_connections',
  'in_flight_import_items',
  'pending_revoke_attempts',
  'pending_exchange_attempts',
  'live_discovery_handles',
] as const)

function count(row: Row | undefined, field: string): number {
  const value = row?.[field]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value)
  throw new Error(`Google rights count is unavailable: ${field}`)
}

async function organizationExists(tx: Tx, organizationId: string): Promise<boolean> {
  const result = await tx.execute(
    sql`SELECT 1 AS present FROM organization WHERE id = ${organizationId}`,
  )
  return result.rows.length > 0
}

async function footprint(tx: Tx, organizationId: string) {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM google_connections
        WHERE organization_id = ${organizationId}) AS connections,
      (SELECT count(*)::int FROM gbp_import_requests
        WHERE organization_id = ${organizationId}) AS imports
  `)
  const row = result.rows[0] as Row | undefined
  return { connections: count(row, 'connections'), imports: count(row, 'imports') }
}

async function blockers(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<ReadonlyArray<Readonly<{ code: string; count: number }>>> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM google_connections
        WHERE organization_id = ${organizationId}
          AND (
            credential_use_state <> 'none'
            OR google_subject IS NOT NULL
            OR status NOT IN ('disconnected', 'failed')
          )) AS live_connections,
      (SELECT count(*)::int FROM gbp_import_request_items
        WHERE organization_id = ${organizationId}
          AND status IN ('pending', 'processing')) AS in_flight_import_items,
      (SELECT count(*)::int FROM idempotency_receipts
        WHERE scope = 'google_disconnect_revoke'
          AND payload->>'organizationId' = ${organizationId}
          AND payload->>'terminalAt' IS NULL) AS pending_revoke_attempts,
      (SELECT count(*)::int FROM idempotency_receipts
        WHERE scope = 'google_oauth_exchange'
          AND payload->>'organizationId' = ${organizationId}
          AND payload->>'terminalAt' IS NULL) AS pending_exchange_attempts,
      (SELECT count(*)::int FROM google_import_discovery_records
        WHERE organization_id = ${organizationId}
          AND expires_at > ${now}) AS live_discovery_handles
  `)
  const row = result.rows[0] as Row | undefined
  return BLOCKER_CODES.map((code) => ({ code, count: count(row, code) })).filter(
    (blocker) => blocker.count > 0,
  )
}

function blockerError(found: ReadonlyArray<Readonly<{ code: string; count: number }>>) {
  const list = found.map((blocker) => `${blocker.code}=${blocker.count}`).join(',')
  const hint = found.some((blocker) => blocker.code === 'live_connections')
    ? '; an Organization admin must Disconnect Google in Settings, Integrations first'
    : ''
  return `Google integration is not ready to close (${list})${hint}`
}

export async function readGoogleRightsExport(db: Database, organizationId: string) {
  return db.transaction(
    async (tx) => {
      const rows = async (query: ReturnType<typeof sql>) =>
        (await tx.execute(query)).rows as Row[]
      return {
        version: EXPORT_VERSION,
        organizationId,
        googleConnections: await rows(sql`
          SELECT
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
            to_char(connection.credential_authorized_at AT TIME ZONE 'UTC', ${UTC}) AS credential_authorized_at,
            to_char(connection.last_successful_sync_at AT TIME ZONE 'UTC', ${UTC}) AS last_successful_sync_at,
            to_char(connection.status_changed_at AT TIME ZONE 'UTC', ${UTC}) AS status_changed_at,
            to_char(connection.created_at AT TIME ZONE 'UTC', ${UTC}) AS created_at,
            to_char(connection.updated_at AT TIME ZONE 'UTC', ${UTC}) AS updated_at
          FROM google_connections AS connection
          WHERE connection.organization_id = ${organizationId}
          ORDER BY connection.created_at, connection.id`),
        importSagas: await rows(sql`
          SELECT
            saga.id::text AS id,
            saga.request_id::text AS request_id,
            saga.initiated_by,
            saga.total_count,
            saga.batch_count,
            to_char(saga.created_at AT TIME ZONE 'UTC', ${UTC}) AS created_at,
            to_char(saga.updated_at AT TIME ZONE 'UTC', ${UTC}) AS updated_at
          FROM gbp_import_sagas AS saga
          WHERE saga.organization_id = ${organizationId}
          ORDER BY saga.created_at, saga.id`),
        importBatches: await rows(sql`
          SELECT
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
            to_char(request.first_terminal_at AT TIME ZONE 'UTC', ${UTC}) AS first_terminal_at,
            to_char(request.created_at AT TIME ZONE 'UTC', ${UTC}) AS created_at,
            to_char(request.updated_at AT TIME ZONE 'UTC', ${UTC}) AS updated_at
          FROM gbp_import_requests AS request
          WHERE request.organization_id = ${organizationId}
          ORDER BY request.created_at, request.id`),
        importItemStateCounts: await rows(sql`
          SELECT
            item.import_job_id::text AS import_job_id,
            item.status::text AS status,
            item.action::text AS action,
            item.outcome_code::text AS outcome_code,
            count(*)::int AS item_count
          FROM gbp_import_request_items AS item
          WHERE item.organization_id = ${organizationId}
          GROUP BY item.import_job_id, item.status, item.action, item.outcome_code
          ORDER BY item.import_job_id, item.status, item.action, item.outcome_code`),
        disconnectCleanupAttempts: await rows(sql`
          SELECT
            receipt.key AS id,
            receipt.payload->>'connectionId' AS connection_id,
            receipt.payload->>'initiatorUserId' AS initiator_user_id,
            receipt.payload->>'state' AS state,
            receipt.payload->>'outcomeCode' AS outcome_code,
            to_char((receipt.payload->>'activatedAt')::timestamptz AT TIME ZONE 'UTC', ${UTC}) AS activated_at,
            to_char((receipt.payload->>'terminalAt')::timestamptz AT TIME ZONE 'UTC', ${UTC}) AS terminal_at
          FROM idempotency_receipts AS receipt
          WHERE receipt.scope = 'google_disconnect_revoke'
            AND receipt.payload->>'organizationId' = ${organizationId}
          ORDER BY receipt.key`),
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

async function purge(tx: Tx, organizationId: string, now: Date) {
  let deleted = 0
  for (const table of PURGE_DELETE_TABLES) {
    const result = await tx.execute(
      sql`DELETE FROM ${sql.identifier(table)}
          WHERE organization_id = ${organizationId}
          RETURNING 1`,
    )
    deleted += result.rows.length
  }
  const receipts = await tx.execute(sql`
    DELETE FROM idempotency_receipts
    WHERE scope IN ('google_oauth_exchange', 'gbp_import_item_retry', 'google_import_discovery')
      AND payload->>'organizationId' = ${organizationId}
    RETURNING key
  `)
  const connections = await tx.execute(sql`
    UPDATE google_connections
    SET connected_by = 'purged',
        credential_authorized_by = NULL,
        credential_authorized_at = NULL,
        last_successful_sync_at = NULL,
        status = 'disconnected',
        status_reason = 'organization_purged',
        credential_use_state = 'none',
        encrypted_access_token = 'redacted',
        encrypted_refresh_token = 'redacted',
        google_subject = NULL,
        google_account_email = NULL,
        scopes = ARRAY[]::text[],
        cleanup_material_deadline_at = NULL,
        status_changed_at = ${now},
        updated_at = ${now}
    WHERE organization_id = ${organizationId}
      AND (
        connected_by <> 'purged'
        OR credential_authorized_by IS NOT NULL
        OR last_successful_sync_at IS NOT NULL
        OR google_subject IS NOT NULL
        OR status_reason IS DISTINCT FROM 'organization_purged'
      )
    RETURNING id
  `)
  const attempts = await tx.execute(sql`
    UPDATE idempotency_receipts
    SET payload = payload || jsonb_build_object(
          'credentialBinding', NULL,
          'initiatorUserId', 'purged',
          'updatedAt', ${now.toISOString()}::timestamptz
        )
    WHERE scope = 'google_disconnect_revoke'
      AND payload->>'organizationId' = ${organizationId}
      AND (
        payload->>'credentialBinding' IS NOT NULL
        OR payload->>'initiatorUserId' <> 'purged'
      )
    RETURNING key
  `)
  const permits = await tx.execute(sql`
    UPDATE authorization_execution_permits
    SET initiator_user_id = NULL,
        correlation_id = NULL
    WHERE organization_id = ${organizationId}
      AND (initiator_user_id IS NOT NULL OR correlation_id IS NOT NULL)
    RETURNING id
  `)
  return {
    deleted: deleted + receipts.rows.length,
    scrubbed: connections.rows.length + attempts.rows.length + permits.rows.length,
  }
}

export type GoogleClosureOutcome =
  | Readonly<{ ok: true; deleted: number; scrubbed: number }>
  | Readonly<{ ok: false; error: string }>

/** Counts and blocker codes only. */
export async function readGoogleRightsReport(
  db: Database,
  organizationId: string,
  now: Date,
): Promise<ReadonlyArray<string>> {
  return db.transaction(
    async (tx) => {
      if (!(await organizationExists(tx, organizationId)))
        return ['organization not found']
      const held = await footprint(tx, organizationId)
      const found = await blockers(tx, organizationId, now)
      return [
        `connections=${held.connections} import_batches=${held.imports}`,
        found.length === 0
          ? 'closure blockers: none'
          : `closure blockers: ${found.map((b) => `${b.code}=${b.count}`).join(',')}`,
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

export async function closeGoogleIntegration(
  db: Database,
  organizationId: string,
  now: Date,
): Promise<GoogleClosureOutcome> {
  return db.transaction(async (tx): Promise<GoogleClosureOutcome> => {
    if (!(await organizationExists(tx, organizationId))) {
      return { ok: false, error: 'organization not found' }
    }
    // Lock the tenant's connections so a reconnect cannot land between the
    // readiness check and the scrub.
    await tx.execute(sql`
      SELECT id FROM google_connections
      WHERE organization_id = ${organizationId}
      ORDER BY id
      FOR UPDATE
    `)
    const found = await blockers(tx, organizationId, now)
    if (found.length > 0) return { ok: false, error: blockerError(found) }
    return { ok: true, ...(await purge(tx, organizationId, now)) }
  })
}
