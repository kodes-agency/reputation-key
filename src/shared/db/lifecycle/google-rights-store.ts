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
  'google_import_items',
  'google_imports',
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
        WHERE organization_id = ${organizationId}) AS imports,
      (SELECT count(*)::int FROM google_imports
        WHERE organization_id = ${organizationId}) AS google_imports
  `)
  const row = result.rows[0] as Row | undefined
  return {
    connections: count(row, 'connections'),
    imports: count(row, 'imports'),
    googleImports: count(row, 'google_imports'),
  }
}

async function propertyFootprint(tx: Tx, organizationId: string, propertyId: string) {
  const result = await tx.execute(sql`
    SELECT
      (SELECT count(*)::int FROM gbp_import_request_items
        WHERE organization_id = ${organizationId}
          AND (destination_property_id = ${propertyId}
            OR existing_property_id = ${propertyId})) AS import_items,
      (SELECT count(*)::int FROM google_import_items
        WHERE organization_id = ${organizationId}
          AND (destination_property_id = ${propertyId}
            OR existing_property_id = ${propertyId})) AS google_import_items,
      (SELECT count(*)::int FROM gbp_import_request_items
        WHERE organization_id = ${organizationId}
          AND (destination_property_id = ${propertyId}
            OR existing_property_id = ${propertyId})
          AND status IN ('pending', 'processing'))
      + (SELECT count(*)::int FROM google_import_items
        WHERE organization_id = ${organizationId}
          AND (destination_property_id = ${propertyId}
            OR existing_property_id = ${propertyId})
          AND status IN ('pending', 'processing')) AS in_flight_import_items
  `)
  const row = result.rows[0] as Row | undefined
  return {
    importItems: count(row, 'import_items'),
    googleImportItems: count(row, 'google_import_items'),
    inFlight: count(row, 'in_flight_import_items'),
  }
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
          AND status IN ('pending', 'processing'))
      + (SELECT count(*)::int FROM google_import_items
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
        imports: await rows(sql`
          SELECT
            parent.id::text AS id,
            parent.request_id::text AS request_id,
            parent.initiated_by,
            parent.total_count,
            to_char(parent.first_terminal_at AT TIME ZONE 'UTC', ${UTC}) AS first_terminal_at,
            to_char(parent.purge_at AT TIME ZONE 'UTC', ${UTC}) AS purge_at,
            to_char(parent.created_at AT TIME ZONE 'UTC', ${UTC}) AS created_at,
            to_char(parent.updated_at AT TIME ZONE 'UTC', ${UTC}) AS updated_at
          FROM google_imports AS parent
          WHERE parent.organization_id = ${organizationId}
          ORDER BY parent.created_at, parent.id`),
        importItemStateCounts: await rows(sql`
          SELECT grouped.import_job_id, grouped.status, grouped.action,
                 grouped.outcome_code, grouped.item_count
          FROM (
            SELECT
              item.import_job_id::text AS import_job_id,
              item.status::text AS status,
              item.action::text AS action,
              item.outcome_code::text AS outcome_code,
              count(*)::int AS item_count
            FROM gbp_import_request_items AS item
            WHERE item.organization_id = ${organizationId}
            GROUP BY item.import_job_id, item.status, item.action, item.outcome_code
            UNION ALL
            SELECT
              item.import_id::text AS import_job_id,
              item.status::text AS status,
              item.action::text AS action,
              item.outcome_code::text AS outcome_code,
              count(*)::int AS item_count
            FROM google_import_items AS item
            WHERE item.organization_id = ${organizationId}
            GROUP BY item.import_id, item.status, item.action, item.outcome_code
          ) AS grouped
          ORDER BY grouped.import_job_id, grouped.status, grouped.action,
                   grouped.outcome_code`),
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
        `connections=${held.connections} import_batches=${held.imports} imports=${held.googleImports}`,
        found.length === 0
          ? 'closure blockers: none'
          : `closure blockers: ${found.map((b) => `${b.code}=${b.count}`).join(',')}`,
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/** The reason an Organization closure would be refused, or null. Writes nothing. */
export async function googleClosureRefusal(
  db: Database,
  organizationId: string,
  now: Date,
): Promise<string | null> {
  return db.transaction(
    async (tx) => {
      if (!(await organizationExists(tx, organizationId))) return 'organization not found'
      const found = await blockers(tx, organizationId, now)
      return found.length > 0 ? blockerError(found) : null
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

/**
 * The closure scrub for a restored cell. A restore brings back connections that
 * still hold credentials; the journaled closure already ran with none live, so
 * those grants were revoked before the erasure and the scrub needs no readiness
 * check. Idempotent: rows that are already scrubbed are not counted again.
 */
export async function scrubRestoredGoogleIntegrationInTx(
  tx: Tx,
  organizationId: string,
  now: Date,
): Promise<GoogleClosureOutcome> {
  if (!(await organizationExists(tx, organizationId))) {
    return { ok: true, deleted: 0, scrubbed: 0 }
  }
  await tx.execute(sql`
    SELECT id FROM google_connections
    WHERE organization_id = ${organizationId}
    ORDER BY id
    FOR UPDATE
  `)
  return { ok: true, ...(await purge(tx, organizationId, now)) }
}

/** Counts and blocker codes only, for one Property's import items. */
export async function readGoogleRightsPropertyReport(
  db: Database,
  organizationId: string,
  propertyId: string,
): Promise<ReadonlyArray<string>> {
  return db.transaction(
    async (tx) => {
      const held = await propertyFootprint(tx, organizationId, propertyId)
      return [
        `import_items=${held.importItems} google_import_items=${held.googleImportItems}`,
        held.inFlight === 0
          ? 'erasure blockers: none'
          : `erasure blockers: in_flight_import_items=${held.inFlight}`,
      ]
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/** One Property's import items: states, actions, outcomes and times only. */
export async function readGoogleRightsPropertyExport(
  db: Database,
  organizationId: string,
  propertyId: string,
) {
  return db.transaction(
    async (tx) => {
      const rows = async (query: ReturnType<typeof sql>) =>
        (await tx.execute(query)).rows as Row[]
      return {
        version: EXPORT_VERSION,
        organizationId,
        propertyId,
        importItems: await rows(sql`
          SELECT grouped.import_job_id, grouped.status, grouped.action,
                 grouped.outcome_code, grouped.item_count, grouped.first_terminal_at,
                 grouped.last_updated_at
          FROM (
            SELECT
              item.import_job_id::text AS import_job_id,
              item.status::text AS status,
              item.action::text AS action,
              item.outcome_code::text AS outcome_code,
              count(*)::int AS item_count,
              to_char(min(item.first_terminal_at) AT TIME ZONE 'UTC', ${UTC}) AS first_terminal_at,
              to_char(max(item.updated_at) AT TIME ZONE 'UTC', ${UTC}) AS last_updated_at
            FROM gbp_import_request_items AS item
            WHERE item.organization_id = ${organizationId}
              AND (item.destination_property_id = ${propertyId}
                OR item.existing_property_id = ${propertyId})
            GROUP BY item.import_job_id, item.status, item.action, item.outcome_code
            UNION ALL
            SELECT
              item.import_id::text AS import_job_id,
              item.status::text AS status,
              item.action::text AS action,
              item.outcome_code::text AS outcome_code,
              count(*)::int AS item_count,
              to_char(min(item.first_terminal_at) AT TIME ZONE 'UTC', ${UTC}) AS first_terminal_at,
              to_char(max(item.updated_at) AT TIME ZONE 'UTC', ${UTC}) AS last_updated_at
            FROM google_import_items AS item
            WHERE item.organization_id = ${organizationId}
              AND (item.destination_property_id = ${propertyId}
                OR item.existing_property_id = ${propertyId})
            GROUP BY item.import_id, item.status, item.action, item.outcome_code
          ) AS grouped
          ORDER BY grouped.import_job_id, grouped.status, grouped.action,
                   grouped.outcome_code`),
        excludedRecordClasses: EXCLUDED_RECORD_CLASSES,
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

async function deleteReturningIds(
  tx: Tx,
  query: ReturnType<typeof sql>,
): Promise<ReadonlyArray<string>> {
  const result = await tx.execute(query)
  return result.rows.map((row) => String((row as Row).parent_id))
}

function inFlightError(inFlight: number): string {
  return `Google integration is not ready to erase (in_flight_import_items=${inFlight})`
}

/** The reason a Property erase would be refused, or null. Writes nothing. */
export async function googlePropertyErasureRefusal(
  db: Database,
  organizationId: string,
  propertyId: string,
): Promise<string | null> {
  return db.transaction(
    async (tx) => {
      const held = await propertyFootprint(tx, organizationId, propertyId)
      return held.inFlight > 0 ? inFlightError(held.inFlight) : null
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/**
 * Deletes the Property's import items, then the imports and batches those items
 * leave empty. Other Properties' items in the same import keep their parent.
 */
export async function eraseGoogleIntegrationForProperty(
  db: Database,
  organizationId: string,
  propertyId: string,
): Promise<GoogleClosureOutcome> {
  return db.transaction((tx) =>
    eraseGoogleIntegrationForPropertyInTx(tx, organizationId, propertyId),
  )
}

/** The erase inside a caller's transaction, for restore replay. */
export async function eraseGoogleIntegrationForPropertyInTx(
  tx: Tx,
  organizationId: string,
  propertyId: string,
): Promise<GoogleClosureOutcome> {
  const held = await propertyFootprint(tx, organizationId, propertyId)
  if (held.inFlight > 0) return { ok: false, error: inFlightError(held.inFlight) }
  const newParents = await deleteReturningIds(
    tx,
    sql`DELETE FROM google_import_items
          WHERE organization_id = ${organizationId}
            AND (destination_property_id = ${propertyId}
              OR existing_property_id = ${propertyId})
          RETURNING import_id AS parent_id`,
  )
  const oldParents = await deleteReturningIds(
    tx,
    sql`DELETE FROM gbp_import_request_items
          WHERE organization_id = ${organizationId}
            AND (destination_property_id = ${propertyId}
              OR existing_property_id = ${propertyId})
          RETURNING import_job_id AS parent_id`,
  )
  const imports = await tx.execute(sql`
      DELETE FROM google_imports AS parent
      WHERE parent.organization_id = ${organizationId}
        AND parent.id = ANY(string_to_array(${newParents.join(',')}, ',')::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM google_import_items AS item
          WHERE item.organization_id = parent.organization_id
            AND item.import_id = parent.id)
      RETURNING 1`)
  const requests = await tx.execute(sql`
      DELETE FROM gbp_import_requests AS parent
      WHERE parent.organization_id = ${organizationId}
        AND parent.id = ANY(string_to_array(${oldParents.join(',')}, ',')::uuid[])
        AND NOT EXISTS (
          SELECT 1 FROM gbp_import_request_items AS item
          WHERE item.organization_id = parent.organization_id
            AND item.import_job_id = parent.id)
      RETURNING 1`)
  return {
    ok: true,
    deleted:
      newParents.length + oldParents.length + imports.rows.length + requests.rows.length,
    scrubbed: 0,
  }
}
