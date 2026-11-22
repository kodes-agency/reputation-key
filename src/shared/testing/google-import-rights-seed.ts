// Google import rows for the rights executor suites. The replay digest and the
// provider suffix are planted markers the export must never contain, so the
// caller passes them.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

type SeedPool = Pick<Pool, 'query'>

const ITEM_EFFECT_WINDOW_MS = 86_400_000

export async function insertGoogleImport(
  pool: SeedPool,
  input: Readonly<{
    importId: string
    organizationId: string
    userId: string
    totalCount: number
    replayDigest: string
    at: Date
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO google_imports (
       id, organization_id, request_id, initiated_by, total_count,
       wire_replay_key_version, wire_replay_digest,
       semantic_replay_key_version, semantic_replay_digest,
       first_terminal_at, purge_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $7, 'wire_v1', $5, 'semantic_v1', $5,
               $6, $6::timestamptz + interval '30 days', $6, $6)`,
    [
      input.importId,
      input.organizationId,
      randomUUID(),
      input.userId,
      input.replayDigest,
      input.at,
      input.totalCount,
    ],
  )
}

export async function insertGoogleItem(
  pool: SeedPool,
  input: Readonly<{
    organizationId: string
    importId: string
    propertyId: string
    at: Date
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO google_import_items (
       id, organization_id, import_id, destination_property_id,
       action, update_existing_profile, property_name, country_code, timezone,
       status, outcome_code, first_terminal_at, effect_deadline_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'create', true, 'Imported Location', 'US', 'UTC',
               'imported', 'imported', $5, $6, $5, $5)`,
    [
      randomUUID(),
      input.organizationId,
      input.importId,
      input.propertyId,
      input.at,
      new Date(input.at.getTime() + ITEM_EFFECT_WINDOW_MS),
    ],
  )
}

/** An item still to be dispatched; it raises the import's total by one. */
export async function insertPendingGoogleItem(
  pool: SeedPool,
  input: Readonly<{
    organizationId: string
    importId: string
    propertyId: string
    connectionId: string
    providerSuffix: string
    at: Date
  }>,
): Promise<void> {
  await pool.query(
    `UPDATE google_imports SET total_count = total_count + 1 WHERE id = $1`,
    [input.importId],
  )
  await pool.query(
    `INSERT INTO google_import_items (
       id, organization_id, import_id, destination_property_id,
       connection_id, provider_account_suffix, provider_location_suffix,
       expected_connection_lifecycle_version, expected_connection_access_version,
       expected_credential_generation, expected_execution_policy_version,
       expected_actor_role, expected_permission_digest, expected_principal_kind,
       expected_permission_version,
       action, update_existing_profile, property_name, country_code, timezone,
       status, effect_deadline_at, next_dispatch_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, 1, 1, 1, 'v1', 'owner', $7, 'user', 1,
               'create', true, 'Imported Location', 'US', 'UTC',
               'pending', $8, $9, $9, $9)`,
    [
      randomUUID(),
      input.organizationId,
      input.importId,
      input.propertyId,
      input.connectionId,
      input.providerSuffix,
      'a'.repeat(64),
      new Date(input.at.getTime() + ITEM_EFFECT_WINDOW_MS),
      input.at,
    ],
  )
}
