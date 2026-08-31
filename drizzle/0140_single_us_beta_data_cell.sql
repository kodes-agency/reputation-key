-- ADR-0057 expand phase: install a durable, initially open coordination row.
-- This migration deliberately rewrites no tenant or credential data. The
-- bounded operator command owns the report/fence/backfill/verify lifecycle.
CREATE TABLE "data_cell_topology_cutovers" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"cutover_key" varchar(64) NOT NULL,
	"state" varchar(16) DEFAULT 'open' NOT NULL,
	"phase" varchar(32) DEFAULT 'properties' NOT NULL,
	"target_cell_id" varchar(16) NOT NULL,
	"target_policy_version" integer NOT NULL,
	"target_project_id" varchar(255),
	"target_environment_id" varchar(255),
	"property_checkpoint" uuid,
	"organization_checkpoint" varchar(255),
	"credential_active_organization_id" varchar(255),
	"credential_connection_checkpoint" uuid,
	"properties_processed" bigint DEFAULT 0 NOT NULL,
	"credential_homes_processed" bigint DEFAULT 0 NOT NULL,
	"credential_connections_processed" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"last_error_code" varchar(64),
	"last_report_digest_sha256" varchar(64),
	"completion_digest_sha256" varchar(64),
	"operator_id" varchar(255),
	"change_ticket" varchar(255),
	"correlation_id" varchar(255),
	"fenced_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_cell_topology_cutovers_cutover_key_unique" UNIQUE("cutover_key"),
	CONSTRAINT "data_cell_topology_cutovers_singleton_valid" CHECK ("singleton" = TRUE AND "cutover_key" = 'single-us-beta-v3' AND "target_cell_id" = 'us' AND "target_policy_version" = 3),
	CONSTRAINT "data_cell_topology_cutovers_state_valid" CHECK ("state" IN ('open', 'fenced', 'completed') AND "phase" IN ('properties', 'credential_homes', 'verify', 'completed')),
	CONSTRAINT "data_cell_topology_cutovers_target_binding_valid" CHECK ((("target_project_id" IS NULL AND "target_environment_id" IS NULL) OR ("target_project_id" IS NOT NULL AND btrim("target_project_id") <> '' AND "target_environment_id" IS NOT NULL AND btrim("target_environment_id") <> '')) AND ("state" = 'open' OR "target_project_id" IS NOT NULL)),
	CONSTRAINT "data_cell_topology_cutovers_checkpoint_valid" CHECK (("credential_active_organization_id" IS NULL AND "credential_connection_checkpoint" IS NULL) OR ("credential_active_organization_id" IS NOT NULL AND "phase" = 'credential_homes')),
	CONSTRAINT "data_cell_topology_cutovers_progress_valid" CHECK ("properties_processed" >= 0 AND "credential_homes_processed" >= 0 AND "credential_connections_processed" >= 0 AND "error_count" >= 0),
	CONSTRAINT "data_cell_topology_cutovers_digest_valid" CHECK (("last_report_digest_sha256" IS NULL OR "last_report_digest_sha256" ~ '^[a-f0-9]{64}$') AND ("completion_digest_sha256" IS NULL OR "completion_digest_sha256" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "data_cell_topology_cutovers_lifecycle_valid" CHECK (("state" = 'open' AND "fenced_at" IS NULL AND "completed_at" IS NULL) OR ("state" = 'fenced' AND "fenced_at" IS NOT NULL AND "completed_at" IS NULL) OR ("state" = 'completed' AND "fenced_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "phase" = 'completed' AND "completion_digest_sha256" IS NOT NULL))
);--> statement-breakpoint

INSERT INTO data_cell_topology_cutovers (
  singleton, cutover_key, state, phase, target_cell_id, target_policy_version
) VALUES (
  TRUE, 'single-us-beta-v3', 'open', 'properties', 'us', 3
);--> statement-breakpoint

-- Frozen database-side copy of the exact catalogue-policy-v3 country set.
-- The migration unit test proves parity with DATA_CELL_SUPPORTED_COUNTRY_CODES;
-- the cutover guard uses this predicate so its operator escape hatch cannot
-- convert a genuinely invalid/missing country merely because it is unresolved.
CREATE OR REPLACE FUNCTION single_us_beta_supported_country_v3(country_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(country_value) = ANY (ARRAY[
    'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT',
    'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI',
    'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ',
    'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO',
    'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO',
    'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM',
    'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM',
    'GN', 'GP', 'GQ', 'GR', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT',
    'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE',
    'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW',
    'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV',
    'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN',
    'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
    'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
    'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PR', 'PS', 'PT',
    'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD',
    'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
    'ST', 'SV', 'SX', 'SY', 'SZ', 'TA', 'TC', 'TD', 'TG', 'TH', 'TJ', 'TK',
    'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US',
    'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'XK',
    'YE', 'YT', 'ZA', 'ZM', 'ZW'
  ]::text[])
$$;--> statement-breakpoint

-- Every workflow table whose nonterminal rows block verification shares the
-- same durable fence. The row share lock orders a concurrent admission before
-- or after the operator's exclusive fence transition; there is no timing gap.
CREATE OR REPLACE FUNCTION guard_data_cell_topology_cutover_work_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  topology_state text;
  transition_value text;
BEGIN
  SELECT state
  INTO topology_state
  FROM data_cell_topology_cutovers
  WHERE singleton = TRUE
  FOR SHARE;

  IF topology_state IS NULL THEN
    RAISE EXCEPTION 'Data Cell topology cutover authority is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF topology_state <> 'fenced' THEN
    RETURN NEW;
  END IF;

  transition_value := to_jsonb(NEW) ->> TG_ARGV[0];
  IF (
    transition_value IS NOT NULL
    AND '__not_null__' = ANY (TG_ARGV[1:])
  ) OR transition_value = ANY (TG_ARGV[1:]) THEN
    RAISE EXCEPTION 'Data Cell topology cutover admission is fenced'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER region_moves_topology_cutover_fence
BEFORE INSERT OR UPDATE ON region_moves
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'requested', 'writes_paused', 'queues_drained', 'data_copied',
  'verified', 'target_activated', 'source_erased', 'failed', 'rolling_back'
);--> statement-breakpoint
CREATE TRIGGER gbp_import_jobs_topology_cutover_fence
BEFORE INSERT OR UPDATE ON gbp_import_jobs
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'status', 'queued', 'in_progress'
);--> statement-breakpoint
CREATE TRIGGER legacy_import_effect_leases_topology_cutover_fence
BEFORE INSERT OR UPDATE ON legacy_import_effect_leases
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'active'
);--> statement-breakpoint
CREATE TRIGGER gbp_import_requests_topology_cutover_fence
BEFORE INSERT OR UPDATE ON gbp_import_requests
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'status', 'queued', 'processing'
);--> statement-breakpoint
CREATE TRIGGER gbp_import_request_items_topology_cutover_fence
BEFORE INSERT OR UPDATE ON gbp_import_request_items
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'status', 'pending', 'processing'
);--> statement-breakpoint
CREATE TRIGGER gbp_import_request_item_retries_topology_cutover_fence
BEFORE INSERT OR UPDATE ON gbp_import_request_items
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'outcome_code', 'temporarily_unavailable'
);--> statement-breakpoint
CREATE TRIGGER authorization_execution_permits_topology_cutover_fence
BEFORE INSERT OR UPDATE ON authorization_execution_permits
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'admitted', 'started'
);--> statement-breakpoint
CREATE TRIGGER google_credential_source_operations_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_credential_source_operations
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'registered', 'provider_started', 'provider_outcome_ambiguous'
);--> statement-breakpoint
CREATE TRIGGER credential_revoke_permits_topology_cutover_fence
BEFORE INSERT OR UPDATE ON credential_revoke_permits
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'dormant', 'active', 'dispatching', 'cleanup_ambiguous'
);--> statement-breakpoint
CREATE TRIGGER google_subject_authority_guards_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_subject_authority_guards
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'source_active', 'cleanup_pending', 'provider_reset_required', 'ambiguous'
);--> statement-breakpoint
CREATE TRIGGER google_subject_authority_pointer_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_subject_authority_guards
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'active_source_operation_id', '__not_null__'
);--> statement-breakpoint
CREATE TRIGGER google_credential_broker_replay_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_credential_broker_replay
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'state', 'issued'
);--> statement-breakpoint
CREATE TRIGGER google_connections_cleanup_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_connections
FOR EACH ROW EXECUTE FUNCTION guard_data_cell_topology_cutover_work_v1(
  'credential_use_state', 'cleanup_only'
);--> statement-breakpoint

-- Once the fence activates (and after completion), fresh credential routing
-- facts can only name the durable beta target. Existing non-target facts may
-- be superseded or converged by the operator, but cannot be refreshed in place.
CREATE OR REPLACE FUNCTION guard_single_us_credential_home_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  topology_state text;
  new_record jsonb;
BEGIN
  new_record := to_jsonb(NEW);
  SELECT state
  INTO topology_state
  FROM data_cell_topology_cutovers
  WHERE singleton = TRUE
  FOR SHARE;
  IF topology_state IS NULL THEN
    RAISE EXCEPTION 'Data Cell topology cutover authority is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF topology_state NOT IN ('fenced', 'completed') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'google_organization_credential_homes'
     AND new_record ->> 'superseded_at' IS NULL
     AND (new_record ->> 'home_cell_id' IS DISTINCT FROM 'us'
       OR (new_record ->> 'catalogue_policy_version')::int IS DISTINCT FROM 3
       OR (new_record ->> 'effective_from')::timestamptz > clock_timestamp()) THEN
    RAISE EXCEPTION 'Data Cell topology cutover admission is fenced'
      USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'google_connections'
     AND new_record ->> 'credential_use_state' = 'active'
  THEN
    IF new_record ->> 'credential_home_cell_id' IS DISTINCT FROM 'us'
       OR (new_record ->> 'credential_home_policy_version')::int IS DISTINCT FROM 3
       OR new_record ->> 'credential_home_authority_generation' IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM google_organization_credential_homes authority
         WHERE authority.organization_id = new_record ->> 'organization_id'
           AND authority.authority_generation =
             (new_record ->> 'credential_home_authority_generation')::int
           AND authority.home_cell_id = 'us'
           AND authority.catalogue_policy_version = 3
           AND authority.superseded_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Data Cell topology cutover admission is fenced'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER google_organization_credential_homes_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_organization_credential_homes
FOR EACH ROW EXECUTE FUNCTION guard_single_us_credential_home_v1();--> statement-breakpoint
CREATE TRIGGER google_connections_home_topology_cutover_fence
BEFORE INSERT OR UPDATE ON google_connections
FOR EACH ROW EXECUTE FUNCTION guard_single_us_credential_home_v1();--> statement-breakpoint

-- Extend the existing Property immutability authority. With the control row
-- open this preserves the old contract. While fenced, only unresolved writes
-- or the exact operator-owned convergence to US/policy 3 can proceed.
CREATE OR REPLACE FUNCTION guard_property_data_cell_assignment_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  topology_state text;
  cutover_authorized boolean;
BEGIN
  SELECT state
  INTO topology_state
  FROM data_cell_topology_cutovers
  WHERE singleton = TRUE
  FOR SHARE;
  IF topology_state IS NULL THEN
    RAISE EXCEPTION 'Data Cell topology cutover authority is unavailable'
      USING ERRCODE = '55000';
  END IF;
  cutover_authorized :=
    topology_state = 'fenced'
    AND current_setting('repkey.data_cell_topology_cutover', true) =
      'single-us-beta-v3';

  IF TG_OP = 'INSERT' THEN
    IF NEW.data_cell_id IS NULL
       AND NEW.processing_region IN ('us', 'europe', 'global') THEN
      NEW.data_cell_id := NEW.processing_region;
    ELSIF NEW.data_cell_id IS NOT NULL
       AND NEW.processing_region IS DISTINCT FROM NEW.data_cell_id THEN
      RAISE EXCEPTION 'property data cell assignment conflicts with processing region'
        USING ERRCODE = '23514';
    END IF;
    IF topology_state IN ('fenced', 'completed')
       AND NEW.processing_region <> 'unresolved'
       AND (NEW.data_cell_id IS DISTINCT FROM 'us'
         OR NEW.processing_region IS DISTINCT FROM 'us'
         OR NEW.routing_policy_version IS DISTINCT FROM 3) THEN
      RAISE EXCEPTION 'Data Cell topology cutover admission is fenced'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.data_cell_id IS NULL
     AND OLD.data_cell_id IS NULL
     AND NEW.processing_region IN ('us', 'europe', 'global') THEN
    NEW.data_cell_id := NEW.processing_region;
  END IF;
  IF NEW.data_cell_id IS NULL AND OLD.data_cell_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.data_cell_id IS NULL THEN
    RAISE EXCEPTION 'property data cell assignment cannot be cleared'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.processing_region IS DISTINCT FROM NEW.data_cell_id THEN
    RAISE EXCEPTION 'property data cell assignment conflicts with processing region'
      USING ERRCODE = '23514';
  END IF;

  IF topology_state IN ('fenced', 'completed')
     AND NEW.processing_region <> 'unresolved'
     AND (NEW.data_cell_id IS DISTINCT FROM 'us'
       OR NEW.processing_region IS DISTINCT FROM 'us'
       OR NEW.routing_policy_version IS DISTINCT FROM 3) THEN
    RAISE EXCEPTION 'Data Cell topology cutover admission is fenced'
      USING ERRCODE = '55000';
  END IF;

  IF cutover_authorized
     AND NEW.data_cell_id = 'us'
     AND NEW.processing_region = 'us'
     AND NEW.routing_policy_version = 3
     AND (OLD.data_cell_id IN ('us', 'europe', 'global')
       OR (OLD.data_cell_id IS NULL
         AND (OLD.processing_region IN ('us', 'europe', 'global')
           OR (OLD.processing_region = 'unresolved'
             AND single_us_beta_supported_country_v3(OLD.country_code))))) THEN
    RETURN NEW;
  END IF;
  IF topology_state = 'fenced'
     AND (NEW.data_cell_id IS DISTINCT FROM OLD.data_cell_id
       OR NEW.processing_region IS DISTINCT FROM OLD.processing_region
       OR NEW.routing_policy_version IS DISTINCT FROM OLD.routing_policy_version) THEN
    RAISE EXCEPTION 'Data Cell topology cutover admission is fenced'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.data_cell_id IS NULL
     OR NEW.data_cell_id IS NOT DISTINCT FROM OLD.data_cell_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM region_moves move
    WHERE move.property_id = OLD.id
      AND move.organization_id = OLD.organization_id
      AND ((move.state = 'verified'
        AND move.from_region = OLD.data_cell_id
        AND move.to_region = NEW.data_cell_id)
      OR (move.state = 'failed'
        AND move.to_region = OLD.data_cell_id
        AND move.from_region = NEW.data_cell_id))
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'property data cell assignment is immutable outside an operator move'
    USING ERRCODE = '23514';
END;
$$;
