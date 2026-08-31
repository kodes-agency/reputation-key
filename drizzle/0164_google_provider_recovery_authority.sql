-- SAFE-04: durable one-use OAuth response recovery and disconnect-specific
-- revoke cleanup authority. Provider credentials are never stored in clear;
-- the exchange envelope is application-encrypted and bounded to ten minutes,
-- while revoke retains only the exact credential binding for at most 60s.
CREATE TYPE "public"."google_oauth_exchange_attempt_state" AS ENUM(
  'prepared',
  'provider_started',
  'response_preserved',
  'applying',
  'completed',
  'failed',
  'provider_outcome_ambiguous',
  'expired'
);--> statement-breakpoint
CREATE TYPE "public"."google_disconnect_revoke_attempt_state" AS ENUM(
  'active',
  'dispatching',
  'confirmed_not_sent',
  'confirmed_revoked',
  'cleanup_ambiguous'
);--> statement-breakpoint

CREATE TABLE "google_oauth_exchange_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "initiator_user_id" varchar(255) NOT NULL,
  "connection_id" uuid NOT NULL,
  "connection_mode" varchar(16) NOT NULL,
  "target_connection_id" uuid,
  "state" "google_oauth_exchange_attempt_state" NOT NULL,
  "expected_lifecycle_version" bigint NOT NULL,
  "expected_access_version" bigint NOT NULL,
  "expected_credential_generation" bigint NOT NULL,
  "credential_home_cell_id" varchar(16) NOT NULL,
  "credential_home_policy_version" integer NOT NULL,
  "credential_home_authority_generation" integer NOT NULL,
  "encrypted_result" text,
  "provider_started_at" timestamp with time zone,
  "preserved_at" timestamp with time zone,
  "response_expires_at" timestamp with time zone,
  "apply_lease_expires_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "outcome_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_oauth_exchange_attempts_target_check" CHECK (
    ("connection_mode" = 'new' AND "target_connection_id" IS NULL)
    OR
    ("connection_mode" IN ('reauth', 'reconnect')
      AND "target_connection_id" = "connection_id")
  ),
  CONSTRAINT "google_oauth_exchange_attempts_versions_check" CHECK (
    "expected_lifecycle_version" >= 0
    AND "expected_access_version" >= 0
    AND "expected_credential_generation" >= 0
  ),
  CONSTRAINT "google_oauth_exchange_attempts_home_check" CHECK (
    "credential_home_cell_id" IN ('us', 'europe', 'global')
    AND "credential_home_policy_version" >= 1
    AND "credential_home_authority_generation" >= 1
  ),
  CONSTRAINT "google_oauth_exchange_attempts_state_check" CHECK (
    ("state" = 'prepared'
      AND "provider_started_at" IS NULL
      AND "encrypted_result" IS NULL
      AND "preserved_at" IS NULL
      AND "response_expires_at" IS NULL
      AND "apply_lease_expires_at" IS NULL
      AND "terminal_at" IS NULL)
    OR
    ("state" = 'provider_started'
      AND "provider_started_at" IS NOT NULL
      AND "encrypted_result" IS NULL
      AND "preserved_at" IS NULL
      AND "response_expires_at" IS NULL
      AND "apply_lease_expires_at" IS NULL
      AND "terminal_at" IS NULL)
    OR
    ("state" = 'response_preserved'
      AND "provider_started_at" IS NOT NULL
      AND "encrypted_result" IS NOT NULL
      AND "preserved_at" IS NOT NULL
      AND "response_expires_at" > "preserved_at"
      AND "apply_lease_expires_at" IS NULL
      AND "terminal_at" IS NULL)
    OR
    ("state" = 'applying'
      AND "provider_started_at" IS NOT NULL
      AND "encrypted_result" IS NOT NULL
      AND "preserved_at" IS NOT NULL
      AND "response_expires_at" > "preserved_at"
      AND "apply_lease_expires_at" IS NOT NULL
      AND "apply_lease_expires_at" <= "response_expires_at"
      AND "terminal_at" IS NULL)
    OR
    ("state" IN ('completed', 'failed', 'provider_outcome_ambiguous', 'expired')
      AND "encrypted_result" IS NULL
      AND "response_expires_at" IS NULL
      AND "apply_lease_expires_at" IS NULL
      AND "terminal_at" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "google_oauth_exchange_attempts_recovery_idx"
  ON "google_oauth_exchange_attempts" USING btree (
    "state", "response_expires_at", "apply_lease_expires_at"
  );--> statement-breakpoint
CREATE INDEX "google_oauth_exchange_attempts_scope_idx"
  ON "google_oauth_exchange_attempts" USING btree (
    "organization_id", "initiator_user_id", "created_at"
  );--> statement-breakpoint

CREATE TABLE "google_disconnect_revoke_attempts" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "connection_id" uuid NOT NULL,
  "initiator_user_id" varchar(255) NOT NULL,
  "cleanup_work_permit_id" uuid,
  "state" "google_disconnect_revoke_attempt_state" NOT NULL,
  "expected_lifecycle_version" bigint NOT NULL,
  "expected_access_version" bigint NOT NULL,
  "expected_credential_generation" bigint NOT NULL,
  "credential_binding" varchar(64),
  "cleanup_deadline_at" timestamp with time zone NOT NULL,
  "activated_at" timestamp with time zone NOT NULL,
  "dispatching_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "outcome_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_disconnect_revoke_attempts_versions_check" CHECK (
    "expected_lifecycle_version" >= 1
    AND "expected_access_version" >= 1
    AND "expected_credential_generation" >= 1
  ),
  CONSTRAINT "google_disconnect_revoke_attempts_window_check" CHECK (
    "cleanup_deadline_at" > "activated_at"
    AND "cleanup_deadline_at" <= "activated_at" + interval '00:01:00'
  ),
  CONSTRAINT "google_disconnect_revoke_attempts_state_check" CHECK (
    ("state" = 'active'
      AND "cleanup_work_permit_id" IS NULL
      AND "credential_binding" ~ '^[a-f0-9]{64}$'
      AND "dispatching_at" IS NULL
      AND "terminal_at" IS NULL)
    OR
    ("state" = 'dispatching'
      AND "cleanup_work_permit_id" IS NOT NULL
      AND "credential_binding" IS NULL
      AND "dispatching_at" IS NOT NULL
      AND "terminal_at" IS NULL)
    OR
    ("state" IN ('confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous')
      AND "credential_binding" IS NULL
      AND "terminal_at" IS NOT NULL)
  ),
  CONSTRAINT "google_disconnect_revoke_attempts_connection_fk"
    FOREIGN KEY ("organization_id", "connection_id")
    REFERENCES "public"."google_connections"("organization_id", "id")
    ON DELETE RESTRICT,
  CONSTRAINT "google_disconnect_revoke_attempts_cleanup_permit_fk"
    FOREIGN KEY ("cleanup_work_permit_id")
    REFERENCES "public"."authorization_execution_permits"("id")
    ON DELETE RESTRICT
);--> statement-breakpoint
CREATE UNIQUE INDEX "google_disconnect_revoke_attempts_permit_key"
  ON "google_disconnect_revoke_attempts" USING btree ("cleanup_work_permit_id")
  WHERE "cleanup_work_permit_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "google_disconnect_revoke_attempts_one_active_idx"
  ON "google_disconnect_revoke_attempts" USING btree (
    "organization_id", "connection_id"
  ) WHERE "state" IN ('active', 'dispatching');--> statement-breakpoint
CREATE INDEX "google_disconnect_revoke_attempts_recovery_idx"
  ON "google_disconnect_revoke_attempts" USING btree (
    "state", "cleanup_deadline_at"
  );--> statement-breakpoint

-- The admission process calls v3. Existing exchange and ordinary work remain
-- owned by v2/v1; only a revoke linked to the dedicated disconnect attempt is
-- decided here. The old serialized source/guard cleanup path still delegates
-- to v2 and remains valid for refresh/reauth/reconnect rotation cleanup.
CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v3(
  p_permit_id uuid,
  p_permit_generation bigint,
  p_policy_version bigint,
  p_emergency_kill_version bigint,
  p_route_key text,
  p_route_catalog_version text,
  p_quota_policy_id text,
  p_authorization_vector jsonb,
  p_release_sha text
) RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation_deadline_at timestamptz := v_now + interval '30 seconds';
BEGIN
  IF p_route_key <> 'oauth.revoke' OR NOT EXISTS (
    SELECT 1
    FROM public.google_disconnect_revoke_attempts AS attempt
    WHERE attempt.cleanup_work_permit_id = p_permit_id
  ) THEN
    RETURN QUERY
    SELECT delegated.outcome
    FROM public.start_google_execution_permit_v2(
      p_permit_id,
      p_permit_generation,
      p_policy_version,
      p_emergency_kill_version,
      p_route_key,
      p_route_catalog_version,
      p_quota_policy_id,
      p_authorization_vector,
      p_release_sha
    ) AS delegated;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT permit.*,
      CASE
        WHEN permit.state <> 'admitted' THEN 'changed'
        WHEN permit.start_deadline_at <= v_now THEN 'expired'
        WHEN permit.capability::text = 'property.import_gbp_v2'
          AND permit.property_id IS NULL
          AND permit.connection_id IS NOT NULL
          AND permit.initiator_user_id IS NOT NULL
          AND permit.operation_key = 'provider.oauth.revoke'
          AND permit.route_key = 'oauth.revoke'
          AND EXISTS (
            SELECT 1
            FROM public.google_disconnect_revoke_attempts AS attempt
            INNER JOIN public.google_connections AS connection
              ON connection.organization_id = attempt.organization_id
             AND connection.id = attempt.connection_id
            INNER JOIN public.capability_compliance_approvals AS approval
              ON approval.id = permit.approval_binding_id
             AND approval.capability = permit.capability
            WHERE attempt.cleanup_work_permit_id = permit.id
              AND attempt.organization_id = permit.organization_id
              AND attempt.connection_id = permit.connection_id
              AND attempt.initiator_user_id = permit.initiator_user_id
              AND attempt.state = 'dispatching'
              AND attempt.cleanup_deadline_at > v_now
              AND attempt.dispatching_at IS NOT NULL
              AND attempt.terminal_at IS NULL
              AND attempt.credential_binding IS NULL
              AND permit.admitted_at <= attempt.dispatching_at
              AND connection.status = 'disconnecting'
              AND connection.credential_use_state = 'cleanup_only'
              AND connection.cleanup_material_deadline_at =
                attempt.cleanup_deadline_at
              AND connection.lifecycle_version =
                attempt.expected_lifecycle_version + 1
              AND connection.access_version = attempt.expected_access_version
              AND connection.credential_generation =
                attempt.expected_credential_generation
              AND permit.authorization_vector->>'connectionLifecycleVersion' =
                attempt.expected_lifecycle_version::text
              AND permit.authorization_vector->>'connectionAccessVersion' =
                attempt.expected_access_version::text
              AND permit.authorization_vector->>'credentialGeneration' =
                attempt.expected_credential_generation::text
              AND approval.release_sha = p_release_sha
              AND approval.route_catalog_version = permit.route_catalog_version
              AND approval.execution_policy_version =
                permit.authorization_vector->>'executionPolicyVersion'
              AND approval.google_project_attestation_sha256 =
                permit.authorization_vector->>'projectFingerprint'
              AND approval.status = 'approved'
              AND approval.approved_at <= permit.admitted_at
              AND approval.expires_at > permit.admitted_at
              AND (
                approval.target_phase <> 'railway_closed_beta'
                OR approval.railway_closed_beta_cohort @>
                  to_jsonb(ARRAY[permit.organization_id]::text[])
              )
          ) THEN 'started'
        ELSE 'changed'
      END AS admission_outcome
    FROM public.authorization_execution_permits AS permit
    WHERE permit.id = p_permit_id
    FOR UPDATE OF permit
  ), transition AS (
    UPDATE public.authorization_execution_permits AS permit
    SET state = CASE WHEN candidate.admission_outcome = 'started'
          THEN 'started'::public.authorization_execution_permit_state
          ELSE 'fenced'::public.authorization_execution_permit_state END,
        started_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN v_now ELSE permit.started_at END,
        operation_deadline_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN v_operation_deadline_at ELSE permit.operation_deadline_at END,
        fenced_at = CASE WHEN candidate.admission_outcome = 'started'
          THEN permit.fenced_at ELSE v_now END,
        correlation_id = CASE
          WHEN candidate.admission_outcome = 'started' THEN permit.correlation_id
          WHEN candidate.admission_outcome = 'expired' THEN 'start_deadline_elapsed'
          ELSE 'authorization_changed' END
    FROM candidate
    WHERE permit.id = candidate.id
      AND candidate.state = 'admitted'
      AND candidate.permit_generation = p_permit_generation
      AND candidate.policy_version = p_policy_version
      AND candidate.emergency_kill_version = p_emergency_kill_version
      AND candidate.route_key = p_route_key
      AND candidate.route_catalog_version = p_route_catalog_version
      AND candidate.quota_policy_id = p_quota_policy_id
      AND jsonb_typeof(p_authorization_vector) = 'object'
      AND (SELECT count(*) FROM jsonb_object_keys(p_authorization_vector)) = 5
      AND p_authorization_vector ?& ARRAY[
        'requestBindingSha256',
        'credentialBinding',
        'projectFingerprint',
        'requestBodySha256',
        'requestBodyBytes'
      ]::text[]
      AND p_authorization_vector->>'requestBindingSha256' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'credentialBinding' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'projectFingerprint' ~ '^[a-f0-9]{64}$'
      AND p_authorization_vector->>'requestBodySha256' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(p_authorization_vector->'requestBodyBytes') = 'number'
      AND p_authorization_vector->>'requestBodyBytes' ~ '^[1-9][0-9]*$'
      AND candidate.authorization_vector @> p_authorization_vector
    RETURNING candidate.admission_outcome
  )
  SELECT transition.admission_outcome FROM transition
  UNION ALL
  SELECT CASE WHEN candidate.start_deadline_at <= v_now
    THEN 'expired' ELSE 'changed' END
  FROM candidate
  WHERE NOT EXISTS (SELECT 1 FROM transition)
  LIMIT 1;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.start_google_execution_permit_v3(
  uuid, bigint, bigint, bigint, text, text, text, jsonb, text
) FROM PUBLIC;
