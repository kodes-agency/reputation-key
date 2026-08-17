import type { Pool } from 'pg'

export type FinalGoogleImportSchemaProbeResult = Readonly<{
  status: 'ok'
  checks: 4
}>

/**
 * Parse and plan the final release image's four Google import read surfaces.
 * `LIMIT 0` proves relation and column compatibility without inspecting tenant data.
 */
export async function probeFinalGoogleImportSchema(
  pool: Pick<Pool, 'query'>,
): Promise<FinalGoogleImportSchemaProbeResult> {
  await pool.query(`
    SELECT id, organization_id, request_id, initiated_by, status,
           wire_replay_key_version, wire_replay_digest,
           semantic_replay_key_version, semantic_replay_digest,
           first_terminal_at, purge_at
      FROM gbp_import_requests
     LIMIT 0
  `)

  await pool.query(`
    SELECT id, organization_id, import_job_id, connection_id,
           existing_property_id, destination_property_id,
           provider_account_suffix, provider_location_suffix,
           expected_connection_lifecycle_version,
           expected_connection_access_version,
           expected_credential_generation, approval_binding_id,
           expected_execution_policy_version,
           expected_google_content_policy_version,
           expected_emergency_kill_version, expected_actor_role,
           expected_permission_digest, expected_source_epoch,
           expected_profile_version, effect_deadline_at, retry_revision,
           highest_attempt_for_revision, claim_fence,
           claim_lease_expires_at, first_terminal_at
      FROM gbp_import_request_items
     LIMIT 0
  `)

  await pool.query(`
    SELECT id, organization_id, initiating_user_id, item_id,
           retry_request_id, request_digest_key_version, request_digest,
           accepted_retry_revision, created_at
      FROM gbp_import_item_retry_receipts
     LIMIT 0
  `)

  await pool.query(`
    SELECT connection.google_subject, connection.lifecycle_version,
           connection.access_version, connection.credential_generation,
           property.google_connection_id, property.gbp_account_id,
           property.gbp_location_id, property.google_binding_state,
           property.profile_source, property.profile_version,
           property.source_epoch
      FROM google_connections AS connection
      LEFT JOIN properties AS property
        ON property.organization_id = connection.organization_id
       AND property.google_connection_id = connection.id
     LIMIT 0
  `)

  return { status: 'ok', checks: 4 }
}
