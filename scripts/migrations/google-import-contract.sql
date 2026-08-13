-- Google import + Performance contract migration.
--
-- Dormant by design: the normal Drizzle migrator MUST NOT apply this file.
-- Production execution belongs only to the controlled R4 release after R3 has
-- produced a fresh denied/quiescent attestation. R2 may apply it only to a
-- disposable local database. Run with psql -v ON_ERROR_STOP=1 in one transaction.

DO $contract_gate$
DECLARE
  incompatible_control_count bigint;
  active_legacy_lease_count bigint;
  legacy_job_count bigint;
  active_import_count bigint;
  active_permit_count bigint;
  unpublished_import_event_count bigint;
  enabled_capability_count bigint;
  incompatible_identity_count bigint;
BEGIN
  SELECT count(*)
  INTO incompatible_control_count
  FROM legacy_import_control
  WHERE state <> 'closed'
     OR connected_event_issuance <> 'v2'
     OR oauth_state_issuance <> 'opaque-v2'
     OR v1_events_drained_at IS NULL;

  IF incompatible_control_count <> 0 OR
     (SELECT count(*) FROM legacy_import_control) <> 1 THEN
    RAISE EXCEPTION 'google_import_contract_gate: compatibility control is not exactly closed';
  END IF;

  SELECT count(*) INTO active_legacy_lease_count
  FROM legacy_import_effect_leases
  WHERE state = 'active';
  IF active_legacy_lease_count <> 0 THEN
    RAISE EXCEPTION 'google_import_contract_gate: active legacy effect leases remain';
  END IF;

  SELECT count(*) INTO legacy_job_count FROM gbp_import_jobs;
  IF legacy_job_count <> 0 THEN
    RAISE EXCEPTION 'google_import_contract_gate: legacy import jobs remain';
  END IF;

  SELECT count(*) INTO active_import_count
  FROM gbp_import_requests
  WHERE status IN ('queued', 'processing');
  IF active_import_count <> 0 THEN
    RAISE EXCEPTION 'google_import_contract_gate: active v2 import requests remain';
  END IF;

  SELECT count(*) INTO active_permit_count
  FROM authorization_execution_permits
  WHERE capability IN ('property.import_gbp_v2', 'property.read_gbp_performance')
    AND state IN ('admitted', 'started');
  IF active_permit_count <> 0 THEN
    RAISE EXCEPTION 'google_import_contract_gate: active Google execution permits remain';
  END IF;

  SELECT count(*) INTO unpublished_import_event_count
  FROM outbox_events
  WHERE published_at IS NULL
    AND event_type IN (
      'integration.property_import.requested',
      'integration.property_import.retention_released',
      'property.google_binding.changed',
      'integration.google_account.connected',
      'integration.google_account.disconnected'
    );
  IF unpublished_import_event_count <> 0 THEN
    RAISE EXCEPTION 'google_import_contract_gate: unpublished Google lifecycle events remain';
  END IF;

  SELECT count(*) INTO enabled_capability_count
  FROM capability_execution_control
  WHERE capability IN ('property.import_gbp_v2', 'property.read_gbp_performance')
    AND (NOT denied OR denied_at IS NULL);
  IF enabled_capability_count <> 0 OR
     (SELECT count(*) FROM capability_execution_control
      WHERE capability IN ('property.import_gbp_v2', 'property.read_gbp_performance')) <> 2 THEN
    RAISE EXCEPTION 'google_import_contract_gate: both Google capabilities must be persisted denied';
  END IF;

  SELECT count(*) INTO incompatible_identity_count
  FROM google_connections
  WHERE google_subject IS NULL AND status <> 'disconnected';
  IF incompatible_identity_count <> 0 THEN
    RAISE EXCEPTION 'google_import_contract_gate: non-disconnected legacy Google identities remain';
  END IF;
END
$contract_gate$;

DROP TABLE legacy_import_effect_leases;
DROP TABLE gbp_import_legacy_history;
DROP TABLE gbp_import_jobs;
DROP TABLE gbp_cache;
DROP TABLE legacy_import_control;

DROP INDEX properties_org_gbp_place_id_unique;
ALTER TABLE properties DROP COLUMN gbp_place_id;

DROP INDEX google_connections_google_account_idx;
ALTER TABLE google_connections DROP CONSTRAINT google_connections_identity_check;
ALTER TABLE google_connections DROP COLUMN google_account_id;
ALTER TABLE google_connections DROP COLUMN google_email;
ALTER TABLE google_connections
  ADD CONSTRAINT google_connections_identity_check
  CHECK (google_subject IS NOT NULL OR status = 'disconnected');

DROP TYPE legacy_import_effect_lease_state;
DROP TYPE legacy_import_history_status;
DROP TYPE legacy_import_control_state;
DROP TYPE google_oauth_state_issuance_version;
DROP TYPE google_connected_event_issuance_version;
DROP TYPE import_job_status;
DROP TYPE gbp_cache_data_type;
