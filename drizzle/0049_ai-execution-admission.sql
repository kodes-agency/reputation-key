CREATE TABLE "ai_admission_cost_reservations" (
	"permit_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255),
	"property_id" uuid,
	"property_window_generation" integer,
	"organization_utc_date" date,
	"release_sha" varchar(40),
	"maximum_cost_micros" bigint NOT NULL,
	"actual_cost_micros" bigint,
	"state" varchar(20) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ai_admission_cost_reservations_branch_valid" CHECK ((
        ("ai_admission_cost_reservations"."organization_id" IS NOT NULL AND "ai_admission_cost_reservations"."property_id" IS NOT NULL AND "ai_admission_cost_reservations"."property_window_generation" >= 1 AND "ai_admission_cost_reservations"."organization_utc_date" IS NOT NULL AND "ai_admission_cost_reservations"."release_sha" IS NULL)
        OR ("ai_admission_cost_reservations"."organization_id" IS NULL AND "ai_admission_cost_reservations"."property_id" IS NULL AND "ai_admission_cost_reservations"."property_window_generation" IS NULL AND "ai_admission_cost_reservations"."organization_utc_date" IS NULL AND "ai_admission_cost_reservations"."release_sha" ~ '^[0-9a-f]{40}$')
      )),
	CONSTRAINT "ai_admission_cost_reservations_state_valid" CHECK ("ai_admission_cost_reservations"."state" IN ('reserved', 'released', 'charged')
        AND "ai_admission_cost_reservations"."maximum_cost_micros" BETWEEN 0 AND 9007199254740991
        AND ("ai_admission_cost_reservations"."actual_cost_micros" IS NULL OR "ai_admission_cost_reservations"."actual_cost_micros" BETWEEN 0 AND "ai_admission_cost_reservations"."maximum_cost_micros")
        AND (("ai_admission_cost_reservations"."state" = 'reserved' AND "ai_admission_cost_reservations"."actual_cost_micros" IS NULL AND "ai_admission_cost_reservations"."settled_at" IS NULL)
          OR ("ai_admission_cost_reservations"."state" <> 'reserved' AND "ai_admission_cost_reservations"."actual_cost_micros" IS NOT NULL AND "ai_admission_cost_reservations"."settled_at" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "ai_admission_product_consumptions" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"capability" varchar(40) NOT NULL,
	"property_window_generation" integer NOT NULL,
	"accounted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_admission_product_consumptions_valid" CHECK ("ai_admission_product_consumptions"."capability" IN ('review_analysis', 'reply_drafting') AND "ai_admission_product_consumptions"."property_window_generation" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_admission_rate_windows" (
  "scope_key" varchar(200) PRIMARY KEY NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "consumed_count" integer NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "ai_admission_rate_windows_valid" CHECK (
    length("ai_admission_rate_windows"."scope_key") BETWEEN 1 AND 200
    AND "ai_admission_rate_windows"."consumed_count" >= 0
  )
);
--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE "ai_organization_cost_windows" (
	"organization_id" varchar(255) NOT NULL,
	"utc_date" date NOT NULL,
	"reserved_cost_micros" bigint DEFAULT 0 NOT NULL,
	"settled_cost_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_organization_cost_windows_pk" PRIMARY KEY("organization_id","utc_date"),
	CONSTRAINT "ai_organization_cost_windows_valid" CHECK ("ai_organization_cost_windows"."reserved_cost_micros" BETWEEN 0 AND 9007199254740991 AND "ai_organization_cost_windows"."settled_cost_micros" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "ai_property_quota_windows" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"generation" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"local_date" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"transition_anchor" timestamp with time zone,
	"adoption_at" timestamp with time zone,
	"pending_timezone" varchar(64),
	"pending_property_profile_version" integer,
	"analysis_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"reserved_cost_micros" bigint DEFAULT 0 NOT NULL,
	"settled_cost_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_quota_windows_valid" CHECK ("ai_property_quota_windows"."generation" >= 1
        AND "ai_property_quota_windows"."property_profile_version" >= 1
        AND length("ai_property_quota_windows"."timezone") BETWEEN 1 AND 64
        AND "ai_property_quota_windows"."ends_at" > "ai_property_quota_windows"."starts_at"
        AND "ai_property_quota_windows"."analysis_count" BETWEEN 0 AND 500
        AND "ai_property_quota_windows"."reply_count" BETWEEN 0 AND 100
        AND "ai_property_quota_windows"."reserved_cost_micros" BETWEEN 0 AND 9007199254740991
        AND "ai_property_quota_windows"."settled_cost_micros" BETWEEN 0 AND 9007199254740991
        AND (
          ("ai_property_quota_windows"."transition_anchor" IS NULL
            AND "ai_property_quota_windows"."adoption_at" IS NULL
            AND "ai_property_quota_windows"."pending_timezone" IS NULL
            AND "ai_property_quota_windows"."pending_property_profile_version" IS NULL)
          OR ("ai_property_quota_windows"."transition_anchor" IS NOT NULL
            AND "ai_property_quota_windows"."adoption_at" = "ai_property_quota_windows"."ends_at"
            AND "ai_property_quota_windows"."adoption_at" >= "ai_property_quota_windows"."transition_anchor" + interval '24 hours'
            AND length("ai_property_quota_windows"."pending_timezone") BETWEEN 1 AND 64
            AND "ai_property_quota_windows"."pending_property_profile_version" >= 1)
        ))
);
--> statement-breakpoint
CREATE TABLE "ai_provider_circuit_states" (
	"provider_deployment_profile_version" varchar(100) PRIMARY KEY NOT NULL,
	"state" varchar(20) NOT NULL,
	"consecutive_failures" integer NOT NULL,
	"opened_until" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_provider_circuit_states_valid" CHECK ("ai_provider_circuit_states"."state" IN ('closed', 'open', 'half_open')
        AND "ai_provider_circuit_states"."consecutive_failures" BETWEEN 0 AND 1000000
        AND (("ai_provider_circuit_states"."state" = 'closed' AND "ai_provider_circuit_states"."opened_until" IS NULL)
          OR ("ai_provider_circuit_states"."state" <> 'closed' AND "ai_provider_circuit_states"."opened_until" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "source_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "source_byte_count" integer;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ai_operations" WHERE "command" <> 'synthetic_canary') THEN
    RAISE EXCEPTION 'ai admission provenance cutover requires no preexisting product operations';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_source_provenance_valid"
CHECK (
  ("command" = 'synthetic_canary' AND "source_digest" IS NULL AND "source_byte_count" IS NULL)
  OR ("command" <> 'synthetic_canary' AND "source_digest" ~ '^[0-9a-f]{64}$'
    AND "source_byte_count" BETWEEN 1 AND 131072)
);--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" DROP CONSTRAINT "ai_execution_permit_settlements_state_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "grant_kid" varchar(32) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "request_binding_hmac" varchar(43) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "nonce" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "disposition" varchar(40) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "reported_disposition" varchar(40) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "input_tokens" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "cached_input_tokens" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "output_tokens" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "reasoning_tokens" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "retry_after_seconds" integer;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "usage_known" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "provider_retryable" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "cost_micros" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD COLUMN "settlement_state" varchar(20) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "route" varchar(40) NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "request_binding_key_id" varchar(32);--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "request_binding_hmac" varchar(43);--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "grant_kid" varchar(32);--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "nonce" varchar(128);--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "state" varchar(20) DEFAULT 'issued' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "concurrency_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD COLUMN "maximum_cost_micros" bigint;--> statement-breakpoint
ALTER TABLE "ai_admission_cost_reservations" ADD CONSTRAINT "ai_admission_cost_reservations_permit_id_ai_execution_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."ai_execution_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_admission_cost_reservations" ADD CONSTRAINT "ai_admission_cost_reservations_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_admission_product_consumptions" ADD CONSTRAINT "ai_admission_product_consumptions_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_admission_product_consumptions" ADD CONSTRAINT "ai_admission_product_consumptions_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_quota_windows" ADD CONSTRAINT "ai_property_quota_windows_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_circuit_states" ADD CONSTRAINT "ai_provider_circuit_states_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_admission_cost_reservations_release_idx" ON "ai_admission_cost_reservations" USING btree ("release_sha","state");--> statement-breakpoint
CREATE INDEX "ai_admission_product_consumptions_reply_hour_idx" ON "ai_admission_product_consumptions" USING btree ("property_id","capability","accounted_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consume_ai_admission_rate_v1(
  p_scope_key text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamp with time zone
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  consumed boolean := false;
BEGIN
  IF p_scope_key IS NULL
    OR length(p_scope_key) NOT BETWEEN 1 AND 200
    OR p_limit < 1
    OR p_window_seconds < 1
    OR p_now IS NULL
  THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_admission_rate_windows (
    scope_key,
    window_started_at,
    consumed_count,
    updated_at
  ) VALUES (
    p_scope_key,
    p_now,
    1,
    p_now
  )
  ON CONFLICT (scope_key) DO UPDATE
  SET
    window_started_at = CASE
      WHEN ai_admission_rate_windows.window_started_at +
        make_interval(secs => p_window_seconds) <= p_now
      THEN p_now
      ELSE ai_admission_rate_windows.window_started_at
    END,
    consumed_count = CASE
      WHEN ai_admission_rate_windows.window_started_at +
        make_interval(secs => p_window_seconds) <= p_now
      THEN 1
      ELSE ai_admission_rate_windows.consumed_count + 1
    END,
    updated_at = p_now
  WHERE ai_admission_rate_windows.window_started_at +
      make_interval(secs => p_window_seconds) <= p_now
    OR ai_admission_rate_windows.consumed_count < p_limit
  RETURNING true INTO consumed;

  RETURN coalesce(consumed, false);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consume_ai_admission_rate_v1(
  text, integer, integer, timestamp with time zone
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_ai_admission_cost_reservation_binding_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  operation_row public.ai_operations%ROWTYPE;
  binding_row record;
  permit_attempt integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.permit_id IS DISTINCT FROM OLD.permit_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.property_id IS DISTINCT FROM OLD.property_id
      OR NEW.property_window_generation IS DISTINCT FROM OLD.property_window_generation
      OR NEW.organization_utc_date IS DISTINCT FROM OLD.organization_utc_date
      OR NEW.release_sha IS DISTINCT FROM OLD.release_sha
      OR NEW.maximum_cost_micros IS DISTINCT FROM OLD.maximum_cost_micros
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'AI admission cost reservation identity is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT o AS operation, p.execution_attempt AS permit_attempt
  INTO STRICT binding_row
  FROM public.ai_execution_permits AS p
  JOIN public.ai_operations AS o ON o.id = p.operation_id
  WHERE p.id = NEW.permit_id;
  operation_row := binding_row.operation;
  permit_attempt := binding_row.permit_attempt;

  IF permit_attempt <> operation_row.execution_attempt THEN
    RAISE EXCEPTION 'AI admission cost reservation permit attempt mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF operation_row.organization_id IS NOT NULL THEN
    IF NEW.organization_id IS DISTINCT FROM operation_row.organization_id
      OR NEW.property_id IS DISTINCT FROM operation_row.property_id
      OR NEW.release_sha IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.ai_property_quota_windows AS q
        WHERE q.organization_id = NEW.organization_id
          AND q.property_id = NEW.property_id
          AND q.generation = NEW.property_window_generation
      )
    THEN
      RAISE EXCEPTION 'AI admission property cost reservation binding mismatch'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.organization_id IS NOT NULL
      OR NEW.property_id IS NOT NULL
      OR NEW.property_window_generation IS NOT NULL
      OR NEW.organization_utc_date IS NOT NULL
      OR NEW.release_sha IS DISTINCT FROM operation_row.release_sha
    THEN
      RAISE EXCEPTION 'AI admission canary cost reservation binding mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'AI admission cost reservation permit is unavailable'
      USING ERRCODE = '23503';
END;
$$;--> statement-breakpoint
CREATE TRIGGER ai_admission_cost_reservations_binding_guard
BEFORE INSERT OR UPDATE ON public.ai_admission_cost_reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_admission_cost_reservation_binding_v1();--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD CONSTRAINT "ai_execution_permit_settlements_usage_valid" CHECK ("ai_execution_permit_settlements"."grant_kid" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "ai_execution_permit_settlements"."request_binding_hmac" ~ '^[A-Za-z0-9_-]{43}$'
        AND length("ai_execution_permit_settlements"."nonce") BETWEEN 1 AND 128
        AND "ai_execution_permit_settlements"."input_tokens" >= 0 AND "ai_execution_permit_settlements"."cached_input_tokens" BETWEEN 0 AND "ai_execution_permit_settlements"."input_tokens"
        AND "ai_execution_permit_settlements"."output_tokens" >= 0
        AND "ai_execution_permit_settlements"."reasoning_tokens" BETWEEN 0 AND "ai_execution_permit_settlements"."output_tokens"
        AND ("ai_execution_permit_settlements"."usage_known"
          OR ("ai_execution_permit_settlements"."input_tokens" = 0
            AND "ai_execution_permit_settlements"."cached_input_tokens" = 0
            AND "ai_execution_permit_settlements"."output_tokens" = 0
            AND "ai_execution_permit_settlements"."reasoning_tokens" = 0))
        AND ("ai_execution_permit_settlements"."disposition" <> 'success'
          OR "ai_execution_permit_settlements"."usage_known")
        AND ("ai_execution_permit_settlements"."disposition" <> 'no_dispatch'
          OR (NOT "ai_execution_permit_settlements"."usage_known"
            AND "ai_execution_permit_settlements"."cost_micros" = 0
            AND "ai_execution_permit_settlements"."settlement_state" = 'released'))
        AND ("ai_execution_permit_settlements"."disposition" <> 'transport_ambiguous'
          OR (NOT "ai_execution_permit_settlements"."usage_known"
            AND "ai_execution_permit_settlements"."settlement_state" = 'ambiguous'))
        AND "ai_execution_permit_settlements"."cost_micros" BETWEEN 0 AND 9007199254740991
        AND (NOT "ai_execution_permit_settlements"."provider_retryable"
          OR "ai_execution_permit_settlements"."reported_disposition" IN ('rate_limited', 'provider_unavailable'))
        AND ("ai_execution_permit_settlements"."reported_disposition" <> 'rate_limited'
          OR "ai_execution_permit_settlements"."provider_retryable")
        AND ("ai_execution_permit_settlements"."retry_after_seconds" IS NULL
          OR ("ai_execution_permit_settlements"."provider_retryable"
            AND "ai_execution_permit_settlements"."retry_after_seconds" BETWEEN 1 AND 300)));--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD CONSTRAINT "ai_execution_permit_settlements_state_valid" CHECK ("ai_execution_permit_settlements"."terminal_state" IN ('completed', 'failed', 'cancelled')
        AND "ai_execution_permit_settlements"."settlement_state" IN ('settled', 'released', 'ambiguous')
        AND "ai_execution_permit_settlements"."disposition" IN ('success', 'no_dispatch', 'provider_refused', 'output_invalid', 'rate_limited', 'provider_unavailable', 'caller_aborted', 'deadline_exceeded', 'transport_ambiguous', 'source_stale', 'policy_denied')
        AND "ai_execution_permit_settlements"."reported_disposition" IN ('success', 'no_dispatch', 'provider_refused', 'output_invalid', 'rate_limited', 'provider_unavailable', 'caller_aborted', 'deadline_exceeded', 'transport_ambiguous', 'source_stale', 'policy_denied'));--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_admission_valid" CHECK ("ai_execution_permits"."route" IN ('review-analysis', 'reply-suggestion', 'property-trend', 'synthetic-canary')
        AND "ai_execution_permits"."state" IN ('issued', 'consumed', 'settled', 'released', 'ambiguous')
        AND (
          ("ai_execution_permits"."state" IN ('issued', 'released') AND "ai_execution_permits"."request_binding_key_id" IS NULL AND "ai_execution_permits"."request_binding_hmac" IS NULL AND "ai_execution_permits"."grant_kid" IS NULL AND "ai_execution_permits"."nonce" IS NULL AND "ai_execution_permits"."consumed_at" IS NULL AND "ai_execution_permits"."concurrency_expires_at" IS NULL AND "ai_execution_permits"."maximum_cost_micros" IS NULL)
          OR ("ai_execution_permits"."state" IN ('consumed', 'settled', 'released', 'ambiguous') AND "ai_execution_permits"."request_binding_key_id" ~ '^[a-z][a-z0-9_-]{0,31}$' AND "ai_execution_permits"."request_binding_hmac" ~ '^[A-Za-z0-9_-]{43}$' AND "ai_execution_permits"."grant_kid" ~ '^[a-z][a-z0-9_-]{0,31}$' AND length("ai_execution_permits"."nonce") BETWEEN 1 AND 128 AND "ai_execution_permits"."consumed_at" IS NOT NULL AND "ai_execution_permits"."concurrency_expires_at" IS NOT NULL AND "ai_execution_permits"."maximum_cost_micros" BETWEEN 0 AND 9007199254740991)
        ));--> statement-breakpoint

INSERT INTO "ai_provider_circuit_states" (
  "provider_deployment_profile_version",
  "state",
  "consecutive_failures",
  "opened_until",
  "updated_at"
)
SELECT "profile_version", 'closed', 0, NULL, now()
FROM "ai_provider_deployment_profiles"
ON CONFLICT ("provider_deployment_profile_version") DO NOTHING;--> statement-breakpoint


CREATE OR REPLACE FUNCTION "ai_property_quota_adoption_v1"(
  p_transition_anchor timestamp with time zone,
  p_timezone text
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_value timestamp with time zone := p_transition_anchor + interval '24 hours';
  local_date_value date;
  candidate_value timestamp with time zone;
  offset_days integer;
BEGIN
  local_date_value := public.resolve_ai_property_local_date_v1(
    target_value,
    p_timezone,
    'property-calendar-v1'
  );
  IF local_date_value IS NULL THEN RETURN NULL; END IF;
  FOR offset_days IN 0..3 LOOP
    candidate_value := public.ai_property_local_midnight_v1(
      local_date_value + offset_days,
      p_timezone
    );
    IF candidate_value IS NOT NULL AND candidate_value >= target_value THEN
      RETURN candidate_value;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "ai_property_quota_adoption_v1"(
  timestamp with time zone, text
) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "admit_ai_property_v1"(
  p_descriptor jsonb,
  p_request_binding_key_id varchar,
  p_request_binding_hmac varchar,
  p_grant_kid varchar
)
RETURNS TABLE (
  status text,
  code text,
  nonce text,
  issued_at_epoch_millis bigint,
  expires_at_epoch_millis bigint,
  reply_token_expires_at_epoch_millis bigint,
  reply_draft_expires_at_epoch_millis bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  operation_row ai_operations%ROWTYPE;
  permit_row ai_execution_permits%ROWTYPE;
  property_row properties%ROWTYPE;
  review_row reviews%ROWTYPE;
  aggregate_row ai_property_aggregate_heads%ROWTYPE;
  profile_row ai_property_processing_profiles%ROWTYPE;
  operation_profile_row ai_operation_profiles%ROWTYPE;
  runtime_profile_row ai_runtime_capability_profiles%ROWTYPE;
  provider_profile_row ai_provider_deployment_profiles%ROWTYPE;
  membership_row ai_provider_deployment_capabilities%ROWTYPE;
  enablement_row merchant_ai_enablement%ROWTYPE;
  control_row ai_execution_control_heads%ROWTYPE;
  quota_row ai_property_quota_windows%ROWTYPE;
  circuit_row ai_provider_circuit_states%ROWTYPE;
  actor_role text;
  product_consumed boolean;
  rate_denied boolean := false;
  effective_actor_id text;
  route_name text := p_descriptor->>'route';
  capability_name text;
  command_name text;
  operation_id_value uuid;
  permit_id_value uuid;
  attempt_value integer;
  claimed_cost_value bigint;
  maximum_cost_value bigint;
  maximum_input_tokens bigint;
  caller_deadline_value bigint;
  observed_content_expiry bigint;
  source_digest_value text;
  source_byte_count_value integer;
  now_value timestamp with time zone := transaction_timestamp();
  now_millis bigint;
  deployment_rate_limit integer;
  deployment_concurrency_limit integer;
  organization_concurrency_limit integer;
  property_concurrency_limit integer;
  local_date_value date;
  local_start timestamp with time zone;
  local_end timestamp with time zone;
  transition_anchor_value timestamp with time zone;
  candidate_adoption timestamp with time zone;
  reply_count_value integer;
BEGIN
  BEGIN
    operation_id_value := (p_descriptor->>'operationId')::uuid;
    permit_id_value := (p_descriptor->>'permitId')::uuid;
    attempt_value := (p_descriptor->>'attemptNumber')::integer;
    claimed_cost_value := (p_descriptor#>>'{limits,costMicros}')::bigint;
    caller_deadline_value := (p_descriptor->>'callerDeadlineEpochMillis')::bigint;
    observed_content_expiry :=
      NULLIF(p_descriptor->>'observedContentExpiresAtEpochMillis', '')::bigint;
    source_digest_value := p_descriptor->>'sourceDigest';
    source_byte_count_value := (p_descriptor->>'sourceByteCount')::integer;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END;

  IF route_name NOT IN ('review-analysis', 'reply-suggestion', 'property-trend')
    OR attempt_value NOT BETWEEN 1 AND 4
    OR p_request_binding_key_id !~ '^[a-z][a-z0-9_-]{0,31}$'
    OR p_request_binding_hmac !~ '^[A-Za-z0-9_-]{43}$'
    OR p_grant_kid !~ '^[a-z][a-z0-9_-]{0,31}$'
    OR claimed_cost_value < 0
    OR claimed_cost_value > 9007199254740991
    OR source_digest_value !~ '^[0-9a-f]{64}$'
    OR source_byte_count_value NOT BETWEEN 1 AND 131072
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  capability_name := CASE route_name
    WHEN 'review-analysis' THEN 'review_analysis'
    WHEN 'reply-suggestion' THEN 'reply_drafting'
    ELSE 'property_trends'
  END;
  command_name := CASE route_name
    WHEN 'review-analysis' THEN 'analysis'
    WHEN 'reply-suggestion' THEN 'reply'
    ELSE 'trend'
  END;
  SELECT * INTO operation_profile_row
  FROM ai_operation_profiles
  WHERE profile_version = p_descriptor#>>'{binding,operationProfileVersion}';
  SELECT * INTO runtime_profile_row
  FROM ai_runtime_capability_profiles
  WHERE runtime_profile_version =
    p_descriptor#>>'{binding,capabilityRuntimeProfileVersion}';
  SELECT * INTO provider_profile_row
  FROM ai_provider_deployment_profiles
  WHERE profile_version =
    p_descriptor#>>'{binding,providerDeploymentProfileVersion}';
  SELECT * INTO membership_row
  FROM ai_provider_deployment_capabilities AS membership
  WHERE membership.provider_deployment_profile_version =
      provider_profile_row.profile_version
    AND membership.capability = capability_name;
  IF operation_profile_row.profile_version IS NULL
    OR runtime_profile_row.runtime_profile_version IS NULL
    OR provider_profile_row.profile_version IS NULL
    OR membership_row.provider_deployment_profile_version IS NULL
    OR operation_profile_row.command <> command_name
    OR operation_profile_row.capability <> capability_name
    OR operation_profile_row.source_route <> route_name
    OR operation_profile_row.provider_deployment_profile_version <>
      provider_profile_row.profile_version
    OR operation_profile_row.capability_runtime_profile_version <>
      runtime_profile_row.runtime_profile_version
    OR runtime_profile_row.capability <> capability_name
    OR runtime_profile_row.source_route <> route_name
    OR runtime_profile_row.operation_profile_version <>
      operation_profile_row.profile_version
    OR runtime_profile_row.provider_deployment_profile_version <>
      provider_profile_row.profile_version
    OR membership_row.runtime_profile_version <>
      runtime_profile_row.runtime_profile_version
    OR membership_row.catalogue_digest <> runtime_profile_row.catalogue_digest
    OR (p_descriptor#>>'{limits,sourceBytes}')::integer <>
      operation_profile_row.source_byte_limit
    OR (p_descriptor#>>'{limits,providerPayloadBytes}')::integer <>
      operation_profile_row.provider_payload_byte_limit
    OR (p_descriptor#>>'{limits,preparedRequestBytes}')::integer <>
      operation_profile_row.prepared_request_byte_limit
    OR (p_descriptor#>>'{limits,responseBytes}')::integer <>
      operation_profile_row.response_byte_limit
    OR (p_descriptor#>>'{limits,outputTokens}')::integer <>
      operation_profile_row.max_output_tokens
    OR source_byte_count_value > operation_profile_row.source_byte_limit
    OR (p_descriptor->>'providerPayloadByteCount')::integer >
      operation_profile_row.provider_payload_byte_limit
    OR (p_descriptor->>'preparedByteCount')::integer >
      operation_profile_row.prepared_request_byte_limit
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  maximum_input_tokens :=
    operation_profile_row.static_token_bearing_bytes::bigint +
    (p_descriptor->>'providerPayloadByteCount')::bigint;
  maximum_cost_value := floor((
    maximum_input_tokens::numeric * 750000::numeric +
    operation_profile_row.max_output_tokens::numeric * 4500000::numeric +
    999999::numeric
  ) / 1000000::numeric)::bigint;
  IF maximum_cost_value NOT BETWEEN 0 AND 9007199254740991
    OR claimed_cost_value <> maximum_cost_value
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  deployment_rate_limit := CASE route_name
    WHEN 'review-analysis' THEN 60
    WHEN 'reply-suggestion' THEN 30
    ELSE 10
  END;
  deployment_concurrency_limit := CASE route_name
    WHEN 'review-analysis' THEN 16
    WHEN 'reply-suggestion' THEN 8
    ELSE 4
  END;
  organization_concurrency_limit := CASE route_name
    WHEN 'review-analysis' THEN 8
    WHEN 'reply-suggestion' THEN 4
    ELSE 2
  END;
  property_concurrency_limit := CASE route_name
    WHEN 'review-analysis' THEN 2
    WHEN 'reply-suggestion' THEN 2
    ELSE 1
  END;
  now_millis := public.ai_epoch_millis_v1(now_value);

  IF caller_deadline_value <= now_millis
    OR caller_deadline_value > now_millis +
      operation_profile_row.request_deadline_ms
    OR caller_deadline_value - now_millis <
      operation_profile_row.provider_deadline_ms + 5000
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(lock_key)
  FROM (
    SELECT DISTINCT public.ai_advisory_lock_key_v1(value) AS lock_key
    FROM unnest(ARRAY[
      'provider-rate|' || provider_profile_row.profile_version || '|' ||
        command_name,
      'deployment-concurrency|' || provider_profile_row.profile_version || '|' ||
        command_name,
      'organization-concurrency|' || (p_descriptor->>'organizationId') || '|' ||
        command_name,
      'property-concurrency|' || (p_descriptor->>'propertyId') || '|' ||
        command_name,
      'operation-attempt|' || operation_id_value::text || '|' ||
        attempt_value::text
    ]) AS value
    ORDER BY lock_key
  ) AS ordered_locks;

  SELECT * INTO operation_row
  FROM ai_operations
  WHERE id = operation_id_value
  FOR UPDATE;
  IF NOT FOUND
    OR operation_row.state <> 'executing'
    OR operation_row.execution_attempt <> attempt_value
    OR operation_row.capability <> capability_name
    OR operation_row.organization_id <> p_descriptor->>'organizationId'
    OR operation_row.property_id::text <> p_descriptor->>'propertyId'
    OR operation_row.review_id::text IS DISTINCT FROM
      p_descriptor->>'internalSubjectId'
    OR operation_row.actor_user_id IS DISTINCT FROM p_descriptor->>'actorId'
    OR operation_row.source_digest <> source_digest_value
    OR operation_row.source_byte_count <> source_byte_count_value
    OR p_descriptor->'binding' IS DISTINCT FROM jsonb_build_object(
      'authorizationLineageId', operation_row.authorization_lineage_id,
      'noticeVersion', operation_row.notice_version,
      'noticeDigest', operation_row.notice_digest,
      'capabilityFence', operation_row.capability_fences,
      'sourceEpoch', operation_row.source_epoch,
      'evaluatedLanguage', operation_row.evaluated_language,
      'concreteReplyLanguage', CASE
        WHEN operation_row.concrete_reply_language_tag IS NULL THEN NULL
        ELSE jsonb_build_object(
          'tag', operation_row.concrete_reply_language_tag,
          'templateGroup', operation_row.concrete_reply_template_group
        )
      END,
      'languageCatalogueDigest', operation_row.language_catalogue_digest,
      'replyLanguageVerifierDigest', operation_row.reply_language_verifier_digest,
      'languageScriptConsistencyDigest',
        operation_row.language_script_consistency_digest,
      'zhOrthographyVerifierDigest', operation_row.zh_orthography_verifier_digest,
      'sourceRevision', operation_row.source_revision,
      'reviewedAtEpochMillis', operation_row.reviewed_at_epoch_millis,
      'propertyProfileVersion', operation_row.property_profile_version,
      'routingPolicyVersion', operation_row.routing_policy_version,
      'sourcePolicyId', operation_row.source_policy_id,
      'sourceCanonicalizerDigest', operation_row.source_canonicalizer_digest,
      'redactionProfileVersion', operation_row.redaction_profile_version,
      'outputLeakageProfileVersion', operation_row.output_leakage_profile_version,
      'outputLeakageProfileDigest', operation_row.output_leakage_profile_digest,
      'replyTemplateCatalogueVersion', operation_row.reply_template_catalogue_version,
      'replyTemplateCatalogueDigest', operation_row.reply_template_catalogue_digest,
      'providerDeploymentProfileVersion',
        operation_row.provider_deployment_profile_version,
      'operationProfileVersion', operation_row.operation_profile_version,
      'capabilityRuntimeProfileVersion',
        operation_row.capability_runtime_profile_version,
      'aiSubjectHmacKeyVersion', operation_row.subject_hmac_key_version,
      'stopFence', jsonb_build_object(
        'globalControlId', operation_row.global_control_id,
        'globalGeneration', operation_row.global_control_generation,
        'providerControlId', operation_row.provider_control_id,
        'providerGeneration', operation_row.provider_control_generation,
        'capabilityControlId', operation_row.capability_control_id,
        'capabilityGeneration', operation_row.capability_control_generation
      )
    )
    OR p_descriptor->>'redactionProfileVersion' IS DISTINCT FROM
      operation_row.redaction_profile_version
    OR p_descriptor->>'outputLeakageProfileVersion' IS DISTINCT FROM
      operation_row.output_leakage_profile_version
    OR p_descriptor->>'outputLeakageProfileDigest' IS DISTINCT FROM
      operation_row.output_leakage_profile_digest
    OR p_descriptor->>'replyTemplateCatalogueVersion' IS DISTINCT FROM
      operation_row.reply_template_catalogue_version
    OR p_descriptor->>'replyTemplateCatalogueDigest' IS DISTINCT FROM
      operation_row.reply_template_catalogue_digest
    OR operation_row.operation_profile_version <>
      p_descriptor#>>'{binding,operationProfileVersion}'
    OR operation_row.provider_deployment_profile_version <>
      p_descriptor#>>'{binding,providerDeploymentProfileVersion}'
    OR operation_row.capability_runtime_profile_version <>
      p_descriptor#>>'{binding,capabilityRuntimeProfileVersion}'
    OR operation_row.authorization_lineage_id::text <>
      p_descriptor#>>'{binding,authorizationLineageId}'
    OR operation_row.source_epoch <>
      (p_descriptor#>>'{binding,sourceEpoch}')::integer
    OR operation_row.property_profile_version <>
      (p_descriptor#>>'{binding,propertyProfileVersion}')::integer
    OR operation_row.expires_at <= now_value
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO permit_row
  FROM ai_execution_permits
  WHERE id = permit_id_value
    AND operation_id = operation_id_value
    AND execution_attempt = attempt_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied', 'permit_unknown', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF permit_row.state <> 'issued' THEN
    RETURN QUERY SELECT 'denied', 'already_consumed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF permit_row.expires_at <= now_value THEN
    RETURN QUERY SELECT 'denied', 'permit_expired', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row
  FROM ai_execution_control_heads
  WHERE scope_key = 'global'
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.global_control_id
    OR control_row.generation <> operation_row.global_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row
  FROM ai_execution_control_heads
  WHERE scope_key =
    'provider:' || operation_row.provider_deployment_profile_version
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.provider_control_id
    OR control_row.generation <> operation_row.provider_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row
  FROM ai_execution_control_heads
  WHERE scope_key = 'capability:' || capability_name
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.capability_control_id
    OR control_row.generation <> operation_row.capability_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO circuit_row
  FROM ai_provider_circuit_states
  WHERE provider_deployment_profile_version =
    operation_row.provider_deployment_profile_version
  FOR UPDATE;
  IF NOT FOUND
    OR circuit_row.state = 'open'
      AND circuit_row.opened_until > now_value
  THEN
    RETURN QUERY SELECT 'denied', 'circuit_open', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF circuit_row.state = 'open' THEN
    UPDATE ai_provider_circuit_states
    SET state = 'half_open',
      opened_until = now_value + interval '60 seconds',
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version
      AND state = 'open';
  ELSIF circuit_row.state = 'half_open' AND EXISTS (
    SELECT 1
    FROM ai_execution_permits AS probe_permit
    JOIN ai_operations AS probe_operation
      ON probe_operation.id = probe_permit.operation_id
    WHERE probe_permit.state = 'consumed'
      AND probe_permit.concurrency_expires_at > now_value
      AND probe_operation.provider_deployment_profile_version =
        operation_row.provider_deployment_profile_version
  ) THEN
    RETURN QUERY SELECT 'denied', 'circuit_open', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO property_row
  FROM properties
  WHERE organization_id = operation_row.organization_id
    AND id = operation_row.property_id
  FOR SHARE;
  IF NOT FOUND
    OR property_row.deleted_at IS NOT NULL
    OR property_row.lifecycle_state <> 'active'
    OR property_row.source_epoch <> operation_row.source_epoch
    OR property_row.country_code <> p_descriptor->>'redactionCountry'
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF route_name IN ('review-analysis', 'reply-suggestion') THEN
    SELECT * INTO review_row
    FROM reviews
    WHERE organization_id = operation_row.organization_id
      AND property_id = operation_row.property_id
      AND id = operation_row.review_id
    FOR SHARE;
    IF NOT FOUND
      OR review_row.source_epoch <> operation_row.source_epoch
      OR review_row.source_revision <> operation_row.source_revision
      OR floor(extract(epoch FROM review_row.reviewed_at) * 1000)::bigint <>
        operation_row.reviewed_at_epoch_millis
      OR review_row.ai_source_digest <> source_digest_value
      OR review_row.ai_source_byte_length <> source_byte_count_value
      OR review_row.content_expires_at IS NULL
      OR review_row.content_expires_at <= now_value
      OR floor(extract(epoch FROM review_row.content_expires_at) * 1000)::bigint <>
        observed_content_expiry
      OR (
        route_name = 'review-analysis'
        AND review_row.analysis_sequence <> operation_row.analysis_sequence
      )
    THEN
      RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
  ELSE
    SELECT * INTO aggregate_row
    FROM ai_property_aggregate_heads
    WHERE organization_id = operation_row.organization_id
      AND property_id = operation_row.property_id
      AND source_epoch = operation_row.source_epoch
      AND review_analysis_epoch =
        (operation_row.capability_fences->>'reviewAnalysisEpoch')::integer
      AND property_profile_version = operation_row.property_profile_version
    FOR SHARE;
    IF observed_content_expiry IS NOT NULL
      OR NOT FOUND
      OR aggregate_row.aggregate_revision <> operation_row.aggregate_revision
      OR aggregate_row.terminal_analysis_sequence <>
        operation_row.terminal_analysis_sequence
    THEN
      RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO profile_row
  FROM ai_property_processing_profiles
  WHERE organization_id = operation_row.organization_id
    AND property_id = operation_row.property_id
  FOR SHARE;
  IF NOT FOUND
    OR profile_row.lifecycle_state <> 'active'
    OR profile_row.source_epoch <> operation_row.source_epoch
    OR profile_row.profile_version <> operation_row.property_profile_version
    OR profile_row.timezone <> property_row.timezone
    OR profile_row.provider_deployment_profile_version <>
      operation_row.provider_deployment_profile_version
    OR profile_row.country_code <> p_descriptor->>'redactionCountry'
    OR profile_row.routing_policy_version <> operation_row.routing_policy_version
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO enablement_row
  FROM merchant_ai_enablement
  WHERE organization_id = operation_row.organization_id
    AND property_id = operation_row.property_id
  FOR SHARE;
  IF NOT FOUND
    OR enablement_row.state <> 'enabled'
    OR enablement_row.authorization_lineage_id <>
      operation_row.authorization_lineage_id
    OR enablement_row.authorized_source_epoch <> operation_row.source_epoch
    OR NOT capability_name = ANY(enablement_row.capabilities)
    OR enablement_row.capability_runtime_profile_versions->>capability_name <>
      operation_row.capability_runtime_profile_version
    OR (
      capability_name = 'review_analysis'
      AND enablement_row.review_analysis_epoch <>
        (operation_row.capability_fences->>'reviewAnalysisEpoch')::integer
    )
    OR (
      capability_name = 'reply_drafting'
      AND enablement_row.reply_drafting_epoch <>
        (operation_row.capability_fences->>'replyDraftingEpoch')::integer
    )
    OR (
      capability_name = 'property_trends'
      AND (
        enablement_row.review_analysis_epoch <>
          (operation_row.capability_fences->>'reviewAnalysisEpoch')::integer
        OR enablement_row.property_trends_epoch <>
          (operation_row.capability_fences->>'propertyTrendsEpoch')::integer
      )
    )
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  effective_actor_id := operation_row.actor_user_id;
  IF effective_actor_id IS NULL THEN
    SELECT actor_user_id INTO effective_actor_id
    FROM merchant_ai_consent_evidence
    WHERE authorization_lineage_id = operation_row.authorization_lineage_id
      AND state_version = enablement_row.state_version
    FOR SHARE;
  END IF;
  SELECT role INTO actor_role
  FROM member
  WHERE "organizationId" = operation_row.organization_id
    AND "userId" = effective_actor_id
  FOR SHARE;
  IF NOT FOUND
    OR (
      NOT (
        'owner' = ANY (
          regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
        )
      )
      AND (
        NOT (
          'admin' = ANY (
            regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
          )
        )
        OR NOT EXISTS (
          SELECT 1 FROM property_access_grant
          WHERE organization_id = operation_row.organization_id
            AND property_id = operation_row.property_id
            AND user_id = effective_actor_id
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now_value)
        )
      )
    )
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization_capability
    WHERE organization_id = operation_row.organization_id
      AND capability = capability_name
  ) OR NOT EXISTS (
    SELECT 1 FROM property_policy
    WHERE property_id = operation_row.property_id
      AND suspended_at IS NULL
  )
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF (
    SELECT count(*) FROM ai_execution_permits
    WHERE state = 'consumed' AND concurrency_expires_at > now_value
  ) >= 16 OR (
    SELECT count(*) FROM ai_execution_permits p
    JOIN ai_operations o ON o.id = p.operation_id
    WHERE p.state = 'consumed'
      AND p.concurrency_expires_at > now_value
      AND o.organization_id = operation_row.organization_id
  ) >= 8 OR (
    SELECT count(*) FROM ai_execution_permits p
    JOIN ai_operations o ON o.id = p.operation_id
    WHERE p.state = 'consumed'
      AND p.concurrency_expires_at > now_value
      AND o.property_id = operation_row.property_id
  ) >= 4 OR (
    SELECT count(*) FROM ai_execution_permits p
    JOIN ai_operations o ON o.id = p.operation_id
    WHERE p.state = 'consumed'
      AND p.concurrency_expires_at > now_value
      AND o.provider_deployment_profile_version =
        operation_row.provider_deployment_profile_version
  ) >= 16
  THEN
    RETURN QUERY SELECT 'denied', 'concurrency_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;


  local_date_value := public.resolve_ai_property_local_date_v1(
    now_value,
    property_row.timezone,
    'property-calendar-v1'
  );
  local_start := public.ai_property_local_midnight_v1(
    local_date_value,
    property_row.timezone
  );
  local_end := public.ai_property_local_midnight_v1(
    local_date_value + 1,
    property_row.timezone
  );
  IF local_date_value IS NULL OR local_start IS NULL OR local_end IS NULL
    OR local_end <= now_value OR local_end <= local_start
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  INSERT INTO ai_property_quota_windows (
    property_id, organization_id, generation, property_profile_version,
    timezone, local_date, starts_at, ends_at,
    transition_anchor, adoption_at, pending_timezone,
    pending_property_profile_version, analysis_count, reply_count,
    reserved_cost_micros, settled_cost_micros, updated_at
  ) VALUES (
    operation_row.property_id, operation_row.organization_id, 1,
    operation_row.property_profile_version, property_row.timezone,
    local_date_value, local_start, local_end, NULL, NULL, NULL, NULL,
    0, 0, 0, 0, now_value
  )
  ON CONFLICT (property_id) DO NOTHING;
  SELECT * INTO STRICT quota_row
  FROM ai_property_quota_windows
  WHERE property_id = operation_row.property_id
  FOR UPDATE;

  IF quota_row.transition_anchor IS NULL
    AND quota_row.timezone = property_row.timezone
  THEN
    IF quota_row.ends_at <= now_value THEN
      UPDATE ai_property_quota_windows
      SET generation = generation + 1,
        property_profile_version = operation_row.property_profile_version,
        local_date = local_date_value,
        starts_at = local_start,
        ends_at = local_end,
        analysis_count = 0,
        reply_count = 0,
        reserved_cost_micros = 0,
        settled_cost_micros = 0,
        updated_at = now_value
      WHERE property_id = operation_row.property_id
      RETURNING * INTO quota_row;
    ELSIF quota_row.property_profile_version <>
      operation_row.property_profile_version
    THEN
      UPDATE ai_property_quota_windows
      SET property_profile_version = operation_row.property_profile_version,
        updated_at = now_value
      WHERE property_id = operation_row.property_id
      RETURNING * INTO quota_row;
    END IF;
  ELSE
    transition_anchor_value := COALESCE(
      quota_row.transition_anchor,
      quota_row.ends_at
    );
    candidate_adoption := public.ai_property_quota_adoption_v1(
      transition_anchor_value,
      property_row.timezone
    );
    IF candidate_adoption IS NULL THEN
      RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
    candidate_adoption := GREATEST(
      COALESCE(quota_row.adoption_at, candidate_adoption),
      candidate_adoption
    );
    UPDATE ai_property_quota_windows
    SET transition_anchor = transition_anchor_value,
      adoption_at = candidate_adoption,
      ends_at = candidate_adoption,
      pending_timezone = property_row.timezone,
      pending_property_profile_version = operation_row.property_profile_version,
      updated_at = now_value
    WHERE property_id = operation_row.property_id
    RETURNING * INTO quota_row;

    IF now_value >= candidate_adoption THEN
      UPDATE ai_property_quota_windows
      SET generation = generation + 1,
        property_profile_version = operation_row.property_profile_version,
        timezone = property_row.timezone,
        local_date = local_date_value,
        starts_at = local_start,
        ends_at = local_end,
        transition_anchor = NULL,
        adoption_at = NULL,
        pending_timezone = NULL,
        pending_property_profile_version = NULL,
        analysis_count = 0,
        reply_count = 0,
        reserved_cost_micros = 0,
        settled_cost_micros = 0,
        updated_at = now_value
      WHERE property_id = operation_row.property_id
      RETURNING * INTO quota_row;
    END IF;
  END IF;

  IF capability_name = 'review_analysis'
    AND quota_row.analysis_count >= 500
  THEN
    RETURN QUERY SELECT 'denied', 'quota_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF capability_name = 'reply_drafting' THEN
    SELECT count(*) INTO reply_count_value
    FROM ai_admission_product_consumptions
    WHERE property_id = operation_row.property_id
      AND capability = 'reply_drafting'
      AND accounted_at > now_value - interval '1 hour';
    IF quota_row.reply_count >= 100 OR reply_count_value >= 20 THEN
      RETURN QUERY SELECT 'denied', 'quota_exhausted', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
  END IF;

  INSERT INTO ai_organization_cost_windows (
    organization_id, utc_date, reserved_cost_micros,
    settled_cost_micros, updated_at
  ) VALUES (
    operation_row.organization_id, (now_value AT TIME ZONE 'UTC')::date,
    0, 0, now_value
  )
  ON CONFLICT (organization_id, utc_date) DO NOTHING;
  PERFORM 1 FROM ai_organization_cost_windows
  WHERE organization_id = operation_row.organization_id
    AND utc_date = (now_value AT TIME ZONE 'UTC')::date
  FOR UPDATE;
  IF quota_row.reserved_cost_micros + quota_row.settled_cost_micros
      + maximum_cost_value > 10000000
    OR (
      SELECT reserved_cost_micros + settled_cost_micros
      FROM ai_organization_cost_windows
      WHERE organization_id = operation_row.organization_id
        AND utc_date = (now_value AT TIME ZONE 'UTC')::date
    ) + maximum_cost_value > 50000000
  THEN
    RETURN QUERY SELECT 'denied', 'quota_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  BEGIN
    IF NOT consume_ai_admission_rate_v1('global', 16, 60, now_value)
      OR NOT consume_ai_admission_rate_v1(
        'provider:' || operation_row.provider_deployment_profile_version,
        16, 60, now_value
      )
      OR NOT consume_ai_admission_rate_v1(
        'organization:' || operation_row.organization_id,
        8, 60, now_value
      )
      OR NOT consume_ai_admission_rate_v1(
        'property:' || operation_row.property_id::text,
        4, 60, now_value
      )
    THEN
      RAISE EXCEPTION 'ai_admission_rate_limited' USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      rate_denied := true;
  END;
  IF rate_denied THEN
    RETURN QUERY SELECT 'denied', 'rate_limited', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  INSERT INTO ai_admission_product_consumptions (
    operation_id, organization_id, property_id, capability,
    property_window_generation, accounted_at
  ) VALUES (
    operation_row.id, operation_row.organization_id, operation_row.property_id,
    capability_name, quota_row.generation, now_value
  )
  ON CONFLICT (operation_id) DO NOTHING;
  product_consumed := FOUND;
  UPDATE ai_property_quota_windows
  SET analysis_count = analysis_count +
        CASE
          WHEN product_consumed AND capability_name = 'review_analysis' THEN 1
          ELSE 0
        END,
      reply_count = reply_count +
        CASE
          WHEN product_consumed AND capability_name = 'reply_drafting' THEN 1
          ELSE 0
        END,
      reserved_cost_micros = reserved_cost_micros + maximum_cost_value,
      updated_at = now_value
  WHERE property_id = operation_row.property_id;
  UPDATE ai_organization_cost_windows
  SET reserved_cost_micros = reserved_cost_micros + maximum_cost_value,
    updated_at = now_value
  WHERE organization_id = operation_row.organization_id
    AND utc_date = (now_value AT TIME ZONE 'UTC')::date;

  UPDATE ai_execution_permits
  SET request_binding_key_id = p_request_binding_key_id,
    request_binding_hmac = p_request_binding_hmac,
    grant_kid = p_grant_kid,
    nonce = replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', ''),
    state = 'consumed',
    consumed_at = now_value,
    concurrency_expires_at = to_timestamp(caller_deadline_value / 1000.0),
    maximum_cost_micros = maximum_cost_value
  WHERE id = permit_id_value AND state = 'issued'
  RETURNING * INTO permit_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_admission_permit_race' USING ERRCODE = '40001';
  END IF;

  INSERT INTO ai_admission_cost_reservations (
    permit_id, organization_id, property_id, property_window_generation,
    organization_utc_date, release_sha, maximum_cost_micros,
    actual_cost_micros, state, created_at, settled_at
  ) VALUES (
    permit_row.id, operation_row.organization_id, operation_row.property_id,
    quota_row.generation, (now_value AT TIME ZONE 'UTC')::date, NULL,
    maximum_cost_value, NULL, 'reserved', now_value, NULL
  );

  RETURN QUERY SELECT 'admitted', NULL::text, permit_row.nonce::text,
    now_millis, caller_deadline_value,
    CASE WHEN route_name = 'reply-suggestion'
      THEN observed_content_expiry ELSE NULL END,
    CASE WHEN route_name = 'reply-suggestion'
      THEN LEAST(observed_content_expiry, caller_deadline_value) ELSE NULL END;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "admit_ai_property_v1"(
  jsonb, varchar, varchar, varchar
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "admit_ai_canary_v1"(
  p_descriptor jsonb,
  p_request_binding_key_id varchar,
  p_request_binding_hmac varchar,
  p_grant_kid varchar
)
RETURNS TABLE (
  status text,
  code text,
  nonce text,
  issued_at_epoch_millis bigint,
  expires_at_epoch_millis bigint,
  reply_token_expires_at_epoch_millis bigint,
  reply_draft_expires_at_epoch_millis bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  operation_row ai_operations%ROWTYPE;
  permit_row ai_execution_permits%ROWTYPE;
  authorization_row ai_canary_authorizations%ROWTYPE;
  head_row ai_canary_authorization_heads%ROWTYPE;
  control_row ai_execution_control_heads%ROWTYPE;
  circuit_row ai_provider_circuit_states%ROWTYPE;
  operation_id_value uuid;
  permit_id_value uuid;
  authorization_id_value uuid;
  attempt_value integer;
  maximum_cost_value bigint;
  caller_deadline_value bigint;
  now_value timestamp with time zone := clock_timestamp();
  now_millis bigint;
BEGIN
  BEGIN
    operation_id_value := (p_descriptor->>'operationId')::uuid;
    permit_id_value := (p_descriptor->>'permitId')::uuid;
    authorization_id_value := (p_descriptor->>'canaryAuthorizationId')::uuid;
    attempt_value := (p_descriptor->>'attemptNumber')::integer;
    maximum_cost_value := (p_descriptor#>>'{limits,costMicros}')::bigint;
    caller_deadline_value := (p_descriptor->>'callerDeadlineEpochMillis')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END;
  now_millis := floor(extract(epoch FROM now_value) * 1000)::bigint;
  IF p_descriptor->>'route' <> 'synthetic-canary'
    OR attempt_value <> 1
    OR maximum_cost_value <> 100000
    OR caller_deadline_value <= now_millis
    OR caller_deadline_value > now_millis + 120000
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(lock_key)
  FROM (
    SELECT DISTINCT hashtextextended(value, 0) AS lock_key
    FROM unnest(ARRAY[
      '00:global',
      '01:provider:' || COALESCE(
        p_descriptor#>>'{canaryBinding,providerDeploymentProfileVersion}', ''
      ),
      '02:capability:review_analysis',
      '02:capability:reply_drafting',
      '02:capability:property_trends',
      '03:release:' || COALESCE(p_descriptor->>'releaseSha', ''),
      '05:operation:' || operation_id_value::text
    ]) AS value
    ORDER BY lock_key
  ) AS ordered_locks;

  SELECT * INTO operation_row
  FROM ai_operations
  WHERE id = operation_id_value
  FOR UPDATE;
  IF NOT FOUND
    OR operation_row.command <> 'synthetic_canary'
    OR operation_row.state <> 'executing'
    OR operation_row.execution_attempt <> attempt_value
    OR p_descriptor->>'canaryAuthorizationId' IS DISTINCT FROM
      operation_row.canary_authorization_id::text
    OR p_descriptor->'canaryBinding' IS DISTINCT FROM jsonb_build_object(
      'canaryAuthorizationId', operation_row.canary_authorization_id,
      'canaryAuthorizationGeneration',
        operation_row.canary_authorization_generation,
      'releaseSha', operation_row.release_sha,
      'canaryProfileVersion', operation_row.canary_profile_version,
      'safetyIdentifierProfileVersion', 'synthetic-canary-safety-v1',
      'providerDeploymentProfileVersion',
        operation_row.provider_deployment_profile_version,
      'operationProfileVersion', operation_row.operation_profile_version,
      'stopFence', jsonb_build_object(
        'globalControlId', operation_row.global_control_id,
        'globalGeneration', operation_row.global_control_generation,
        'providerControlId', operation_row.provider_control_id,
        'providerGeneration', operation_row.provider_control_generation,
        'allCapabilityStopFences', operation_row.capability_fences
      )
    )
    OR operation_row.release_sha <> p_descriptor->>'releaseSha'
    OR operation_row.canary_authorization_id <> authorization_id_value
    OR operation_row.canary_authorization_generation <>
      (p_descriptor#>>'{canaryBinding,canaryAuthorizationGeneration}')::integer
    OR operation_row.canary_profile_version <>
      p_descriptor#>>'{canaryBinding,canaryProfileVersion}'
    OR operation_row.provider_deployment_profile_version <>
      p_descriptor#>>'{canaryBinding,providerDeploymentProfileVersion}'
    OR operation_row.operation_profile_version <>
      p_descriptor#>>'{canaryBinding,operationProfileVersion}'
    OR operation_row.expires_at <= now_value
  THEN
    RETURN QUERY SELECT 'denied', 'canary_not_eligible', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO permit_row
  FROM ai_execution_permits
  WHERE id = permit_id_value
    AND operation_id = operation_id_value
    AND execution_attempt = attempt_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied', 'permit_unknown', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF permit_row.state <> 'issued' THEN
    RETURN QUERY SELECT 'denied', 'already_consumed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF permit_row.expires_at <= now_value THEN
    RETURN QUERY SELECT 'denied', 'permit_expired', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row FROM ai_execution_control_heads
  WHERE scope_key = 'global' FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.global_control_id
    OR control_row.generation <> operation_row.global_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  SELECT * INTO control_row FROM ai_execution_control_heads
  WHERE scope_key =
    'provider:' || operation_row.provider_deployment_profile_version
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.provider_control_id
    OR control_row.generation <> operation_row.provider_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(operation_row.capability_fences) AS fence(value)
    LEFT JOIN ai_execution_control_heads head
      ON head.scope_key = 'capability:' || (fence.value->>'capability')
    WHERE head.control_id IS NULL
      OR head.control_id::text <> fence.value->>'capabilityControlId'
      OR head.generation <> (fence.value->>'capabilityGeneration')::integer
      OR head.execution_state <> 'killed'
      OR head.admission_state <> 'draining'
  ) THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO circuit_row FROM ai_provider_circuit_states
  WHERE provider_deployment_profile_version =
    operation_row.provider_deployment_profile_version
  FOR UPDATE;
  IF NOT FOUND
    OR circuit_row.state = 'open' AND circuit_row.opened_until > now_value
  THEN
    RETURN QUERY SELECT 'denied', 'circuit_open', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF circuit_row.state = 'open' THEN
    UPDATE ai_provider_circuit_states
    SET state = 'half_open',
      opened_until = now_value + interval '60 seconds',
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version
      AND state = 'open';
  ELSIF circuit_row.state = 'half_open' AND EXISTS (
    SELECT 1
    FROM ai_execution_permits AS probe_permit
    JOIN ai_operations AS probe_operation
      ON probe_operation.id = probe_permit.operation_id
    WHERE probe_permit.state = 'consumed'
      AND probe_permit.concurrency_expires_at > now_value
      AND probe_operation.provider_deployment_profile_version =
        operation_row.provider_deployment_profile_version
  ) THEN
    RETURN QUERY SELECT 'denied', 'circuit_open', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO authorization_row
  FROM ai_canary_authorizations
  WHERE id = authorization_id_value
  FOR UPDATE;
  SELECT * INTO head_row
  FROM ai_canary_authorization_heads
  WHERE release_sha = operation_row.release_sha
    AND canary_profile_version = operation_row.canary_profile_version
  FOR UPDATE;
  IF authorization_row.id IS NULL
    OR authorization_row.state <> 'issued'
    OR authorization_row.expires_at <= now_value
    OR head_row.current_authorization_id <> authorization_row.id
    OR head_row.state <> 'issued'
  THEN
    RETURN QUERY SELECT 'denied', 'canary_not_eligible', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF (
    SELECT count(*)
    FROM ai_execution_permits AS live_permit
    JOIN ai_operations AS live_operation
      ON live_operation.id = live_permit.operation_id
    WHERE live_permit.state = 'consumed'
      AND live_permit.concurrency_expires_at > now_value
      AND live_operation.command = 'synthetic_canary'
  ) >= 1 OR NOT consume_ai_admission_rate_v1(
    'canary-release:' || operation_row.release_sha, 1, 60, now_value
  ) THEN
    RETURN QUERY SELECT 'denied', 'concurrency_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  UPDATE ai_execution_permits
  SET request_binding_key_id = p_request_binding_key_id,
    request_binding_hmac = p_request_binding_hmac,
    grant_kid = p_grant_kid,
    nonce = replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', ''),
    state = 'consumed',
    consumed_at = now_value,
    concurrency_expires_at = to_timestamp(caller_deadline_value / 1000.0),
    maximum_cost_micros = maximum_cost_value
  WHERE id = permit_id_value AND state = 'issued'
  RETURNING * INTO permit_row;
  UPDATE ai_canary_authorizations
  SET state = 'consumed'
  WHERE id = authorization_row.id AND state = 'issued';
  UPDATE ai_canary_authorization_heads
  SET state = 'in_flight',
    transition_generation = transition_generation + 1,
    current_operation_id = operation_row.id,
    current_permit_id = permit_row.id,
    updated_at = now_value
  WHERE release_sha = operation_row.release_sha
    AND canary_profile_version = operation_row.canary_profile_version
    AND state = 'issued';
  INSERT INTO ai_admission_cost_reservations (
    permit_id, organization_id, property_id, property_window_generation,
    organization_utc_date, release_sha, maximum_cost_micros,
    actual_cost_micros, state, created_at, settled_at
  ) VALUES (
    permit_row.id, NULL, NULL, NULL, NULL, operation_row.release_sha,
    maximum_cost_value, NULL, 'reserved', now_value, NULL
  );

  RETURN QUERY SELECT 'admitted', NULL::text, permit_row.nonce::text,
    now_millis, caller_deadline_value,
    NULL::bigint, NULL::bigint;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "settle_ai_execution_v1"(
  p_request jsonb,
  p_receipt_kid varchar
)
RETURNS TABLE (
  status text,
  code text,
  grant_kid text,
  request_binding_hmac text,
  disposition text,
  usage_known boolean,
  provider_retryable boolean,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  cost_micros bigint,
  settled_at_epoch_millis bigint,
  settlement_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  permit_row ai_execution_permits%ROWTYPE;
  reservation_row ai_admission_cost_reservations%ROWTYPE;
  existing_row ai_execution_permit_settlements%ROWTYPE;
  operation_row ai_operations%ROWTYPE;
  circuit_row ai_provider_circuit_states%ROWTYPE;
  permit_id_value uuid;
  operation_id_value uuid;
  attempt_value integer;
  input_value integer;
  cached_input_value integer;
  output_value integer;
  reasoning_value integer;
  usage_known_value boolean;
  cost_value bigint;
  disposition_value text;
  reported_disposition_value text;
  provider_retryable_value boolean;
  price_unit_tokens bigint;
  uncached_input_price_micros bigint;
  cached_input_price_micros bigint;
  output_price_micros bigint;
  model_snapshot_value text;
  state_value text;
  expected_cost bigint;
  now_value timestamp with time zone := clock_timestamp();
  now_millis bigint;
BEGIN
  IF p_receipt_kid !~ '^[a-z][a-z0-9_-]{0,31}$' THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  BEGIN
    permit_id_value := (p_request->>'permitId')::uuid;
    operation_id_value := (p_request->>'operationId')::uuid;
    attempt_value := (p_request->>'attemptNumber')::integer;
    input_value := (p_request->>'inputTokens')::integer;
    cached_input_value := (p_request->>'cachedInputTokens')::integer;
    output_value := (p_request->>'outputTokens')::integer;
    reasoning_value := (p_request->>'reasoningTokens')::integer;
    IF jsonb_typeof(p_request->'usageKnown') <> 'boolean' THEN
      RAISE EXCEPTION 'usageKnown must be boolean';
    END IF;
    usage_known_value := (p_request->>'usageKnown')::boolean;
    disposition_value := p_request->>'disposition';
    reported_disposition_value := p_request->>'reportedDisposition';
    IF jsonb_typeof(p_request->'providerRetryable') <> 'boolean' THEN
      RAISE EXCEPTION 'providerRetryable must be boolean';
    END IF;
    provider_retryable_value := (p_request->>'providerRetryable')::boolean;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END;
  BEGIN
    SELECT
      (profile.deployment_contract #>> '{pricing,unitTokens}')::bigint,
      (profile.deployment_contract #>> '{pricing,uncachedInputMicros}')::bigint,
      (profile.deployment_contract #>> '{pricing,cachedInputMicros}')::bigint,
      (profile.deployment_contract #>> '{pricing,outputMicros}')::bigint,
      profile.model_snapshot::text
    INTO STRICT
      price_unit_tokens,
      uncached_input_price_micros,
      cached_input_price_micros,
      output_price_micros,
      model_snapshot_value
    FROM ai_operations AS operation
    JOIN ai_provider_deployment_profiles AS profile
      ON profile.profile_version =
        operation.provider_deployment_profile_version
    WHERE operation.id = operation_id_value;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END;
  IF price_unit_tokens <= 0
    OR uncached_input_price_micros < 0
    OR cached_input_price_micros < 0
    OR output_price_micros < 0
  THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  state_value := CASE
    WHEN disposition_value IN ('no_dispatch', 'source_stale', 'policy_denied')
      THEN 'released'
    WHEN disposition_value = 'transport_ambiguous' THEN 'ambiguous'
    ELSE 'settled'
  END;
  expected_cost := (
    ((input_value - cached_input_value)::bigint * uncached_input_price_micros)
    + (cached_input_value::bigint * cached_input_price_micros)
    + (output_value::bigint * output_price_micros)
    + price_unit_tokens - 1
  ) / price_unit_tokens;
  IF attempt_value NOT BETWEEN 1 AND 4
    OR input_value < 0
    OR cached_input_value NOT BETWEEN 0 AND input_value
    OR output_value < 0
    OR reasoning_value NOT BETWEEN 0 AND output_value
    OR (
      NOT usage_known_value
      AND (
        input_value <> 0 OR cached_input_value <> 0 OR output_value <> 0
        OR reasoning_value <> 0
      )
    )
    OR (disposition_value = 'success' AND NOT usage_known_value)
    OR (state_value = 'released' AND usage_known_value)
  THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('05:permit:' || permit_id_value::text, 0)
  );
  SELECT * INTO permit_row
  FROM ai_execution_permits
  WHERE id = permit_id_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied', 'permit_unknown', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF permit_row.operation_id <> operation_id_value
    OR permit_row.execution_attempt <> attempt_value
    OR permit_row.nonce <> p_request->>'nonce'
  THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF permit_row.grant_kid <> p_receipt_kid THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  cost_value := CASE
    WHEN state_value = 'released' THEN 0
    WHEN usage_known_value THEN expected_cost
    ELSE permit_row.maximum_cost_micros
  END;

  SELECT * INTO existing_row
  FROM ai_execution_permit_settlements
  WHERE permit_id = permit_id_value;
  IF FOUND THEN
    IF existing_row.disposition <> disposition_value
      OR existing_row.reported_disposition <> reported_disposition_value
      OR existing_row.provider_retryable <> provider_retryable_value
      OR existing_row.usage_known <> usage_known_value
      OR existing_row.input_tokens <> input_value
      OR existing_row.cached_input_tokens <> cached_input_value
      OR existing_row.output_tokens <> output_value
      OR existing_row.reasoning_tokens <> reasoning_value
      OR existing_row.cost_micros <> cost_value
      OR existing_row.retry_after_seconds IS DISTINCT FROM
        NULLIF(p_request->>'retryAfterSeconds', '')::integer
    THEN
      RETURN QUERY SELECT 'denied', 'settlement_conflict', NULL::text, NULL::text,
        NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
        NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'settled', NULL::text, existing_row.grant_kid::text,
      existing_row.request_binding_hmac::text, existing_row.disposition::text,
      existing_row.usage_known, existing_row.provider_retryable,
      existing_row.input_tokens, existing_row.cached_input_tokens,
      existing_row.output_tokens, existing_row.reasoning_tokens,
      existing_row.cost_micros,
      floor(extract(epoch FROM existing_row.settled_at) * 1000)::bigint,
      existing_row.settlement_state::text;
    RETURN;
  END IF;

  IF permit_row.state <> 'consumed' THEN
    RETURN QUERY SELECT 'denied', 'permit_not_consumed', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF cost_value > permit_row.maximum_cost_micros THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO STRICT reservation_row
  FROM ai_admission_cost_reservations
  WHERE permit_id = permit_id_value
  FOR UPDATE;
  SELECT * INTO STRICT operation_row
  FROM ai_operations
  WHERE id = permit_row.operation_id
  FOR UPDATE;
  SELECT * INTO STRICT circuit_row
  FROM ai_provider_circuit_states
  WHERE provider_deployment_profile_version =
    operation_row.provider_deployment_profile_version
  FOR UPDATE;
  now_millis := floor(extract(epoch FROM now_value) * 1000)::bigint;

  INSERT INTO ai_execution_permit_settlements (
    permit_id, terminal_state, settled_at, grant_kid,
    request_binding_hmac, nonce, disposition, reported_disposition,
    usage_known, provider_retryable, input_tokens, cached_input_tokens,
    output_tokens, reasoning_tokens, retry_after_seconds, cost_micros,
    settlement_state
  ) VALUES (
    permit_row.id,
    CASE
      WHEN disposition_value = 'success' THEN 'completed'
      WHEN disposition_value = 'caller_aborted' THEN 'cancelled'
      ELSE 'failed'
    END,
    now_value, permit_row.grant_kid, permit_row.request_binding_hmac,
    permit_row.nonce, disposition_value, reported_disposition_value,
    usage_known_value, provider_retryable_value, input_value,
    cached_input_value, output_value, reasoning_value,
    NULLIF(p_request->>'retryAfterSeconds', '')::integer,
    cost_value, state_value
  );
  UPDATE ai_execution_permits
  SET state = state_value
  WHERE id = permit_row.id AND state = 'consumed';
  UPDATE ai_admission_cost_reservations
  SET state = CASE WHEN state_value = 'released' THEN 'released' ELSE 'charged' END,
    actual_cost_micros = cost_value,
    settled_at = now_value
  WHERE permit_id = permit_row.id AND state = 'reserved';
  IF disposition_value = 'success' AND circuit_row.state <> 'open' THEN
    UPDATE ai_provider_circuit_states
    SET state = 'closed',
      consecutive_failures = 0,
      opened_until = NULL,
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version;
  ELSIF reported_disposition_value IN (
    'provider_unavailable', 'deadline_exceeded', 'transport_ambiguous'
  ) THEN
    UPDATE ai_provider_circuit_states
    SET state = CASE
        WHEN circuit_row.state IN ('open', 'half_open')
          OR circuit_row.consecutive_failures + 1 >= 5
        THEN 'open'
        ELSE 'closed'
      END,
      consecutive_failures = LEAST(circuit_row.consecutive_failures + 1, 1000000),
      opened_until = CASE
        WHEN circuit_row.state IN ('open', 'half_open')
          OR circuit_row.consecutive_failures + 1 >= 5
        THEN now_value + interval '60 seconds'
        ELSE NULL
      END,
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version;
  END IF;

  IF reservation_row.property_id IS NOT NULL THEN
    UPDATE ai_property_quota_windows
    SET reserved_cost_micros =
          reserved_cost_micros - reservation_row.maximum_cost_micros,
      settled_cost_micros = settled_cost_micros + cost_value,
      updated_at = now_value
    WHERE property_id = reservation_row.property_id
      AND generation = reservation_row.property_window_generation;
    UPDATE ai_organization_cost_windows
    SET reserved_cost_micros =
          reserved_cost_micros - reservation_row.maximum_cost_micros,
      settled_cost_micros = settled_cost_micros + cost_value,
      updated_at = now_value
    WHERE organization_id = reservation_row.organization_id
      AND utc_date = reservation_row.organization_utc_date;
  ELSE
    UPDATE ai_canary_authorizations
    SET state = CASE
        WHEN disposition_value = 'success' THEN 'passed'
        WHEN state_value = 'released' THEN 'released_no_dispatch'
        ELSE 'terminal_failed'
      END,
      settled_at = now_value
    WHERE id = operation_row.canary_authorization_id
      AND state = 'consumed';
    UPDATE ai_operation_attempts
    SET state = CASE WHEN disposition_value = 'success' THEN 'completed' ELSE 'failed' END,
      model_snapshot = CASE
        WHEN disposition_value = 'success' THEN model_snapshot_value
        ELSE NULL
      END,
      input_tokens = CASE WHEN disposition_value = 'success' THEN input_value ELSE NULL END,
      output_tokens = CASE WHEN disposition_value = 'success' THEN output_value ELSE NULL END,
      failure_code = CASE
        WHEN disposition_value = 'success' THEN NULL
        WHEN state_value = 'released' THEN 'provider_no_dispatch'
        ELSE 'operation_ambiguous'
      END,
      settled_at = now_value
    WHERE operation_id = operation_row.id
      AND attempt = operation_row.execution_attempt
      AND state = 'executing';
    UPDATE ai_operations
    SET state = CASE WHEN disposition_value = 'success' THEN 'succeeded' ELSE 'failed' END,
      failure_code = CASE
        WHEN disposition_value = 'success' THEN NULL
        WHEN state_value = 'released' THEN 'provider_no_dispatch'
        ELSE 'operation_ambiguous'
      END,
      next_attempt_at = NULL,
      updated_at = now_value
    WHERE id = operation_row.id AND state = 'executing';
    UPDATE ai_canary_authorization_heads
    SET transition_generation = transition_generation + 1,
      state = CASE
        WHEN disposition_value = 'success' THEN 'passed'
        WHEN state_value = 'released' THEN 'eligible'
        ELSE 'terminal_failed'
      END,
      current_authorization_id = CASE
        WHEN state_value = 'released' THEN NULL
        ELSE current_authorization_id
      END,
      current_operation_id = CASE
        WHEN state_value = 'released' THEN NULL
        ELSE current_operation_id
      END,
      current_permit_id = CASE
        WHEN state_value = 'released' THEN NULL
        ELSE current_permit_id
      END,
      updated_at = now_value
    WHERE release_sha = operation_row.release_sha
      AND canary_profile_version = operation_row.canary_profile_version
      AND current_permit_id = permit_row.id;
  END IF;

  RETURN QUERY SELECT 'settled', NULL::text, permit_row.grant_kid::text,
    permit_row.request_binding_hmac::text, disposition_value::text,
    usage_known_value, provider_retryable_value, input_value,
    cached_input_value, output_value, reasoning_value, cost_value, now_millis,
    state_value::text;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "admit_ai_canary_v1"(
  jsonb, varchar, varchar, varchar
) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "settle_ai_execution_v1"(jsonb, varchar) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reap_expired_ai_execution_permits_v1"(
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  candidate record;
  reservation_row ai_admission_cost_reservations%ROWTYPE;
  operation_row ai_operations%ROWTYPE;
  circuit_row ai_provider_circuit_states%ROWTYPE;
  reaped_count integer := 0;
  now_value timestamp with time zone := clock_timestamp();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'ai_admission_reap_limit_invalid' USING ERRCODE = '22023';
  END IF;
  FOR candidate IN
    SELECT id, operation_id, grant_kid, request_binding_hmac, nonce,
      maximum_cost_micros
    FROM ai_execution_permits
    WHERE state = 'consumed'
      AND concurrency_expires_at <= now_value
    ORDER BY concurrency_expires_at, id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO STRICT reservation_row
    FROM ai_admission_cost_reservations
    WHERE permit_id = candidate.id
    FOR UPDATE;
    SELECT * INTO STRICT operation_row
    FROM ai_operations
    WHERE id = candidate.operation_id
    FOR UPDATE;
    SELECT * INTO STRICT circuit_row
    FROM ai_provider_circuit_states
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version
    FOR UPDATE;

    INSERT INTO ai_execution_permit_settlements (
      permit_id, terminal_state, settled_at, grant_kid,
      request_binding_hmac, nonce, disposition, reported_disposition,
      input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
      retry_after_seconds, usage_known, provider_retryable, cost_micros,
      settlement_state
    ) VALUES (
      candidate.id, 'failed', now_value, candidate.grant_kid,
      candidate.request_binding_hmac, candidate.nonce,
      'transport_ambiguous', 'transport_ambiguous', 0, 0, 0, 0, NULL,
      false, false, candidate.maximum_cost_micros, 'ambiguous'
    )
    ON CONFLICT (permit_id) DO NOTHING;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE ai_execution_permits
    SET state = 'ambiguous'
    WHERE id = candidate.id AND state = 'consumed';
    UPDATE ai_admission_cost_reservations
    SET state = 'charged',
      actual_cost_micros = candidate.maximum_cost_micros,
      settled_at = now_value
    WHERE permit_id = candidate.id AND state = 'reserved';
    UPDATE ai_provider_circuit_states
    SET state = CASE
        WHEN circuit_row.state IN ('open', 'half_open')
          OR circuit_row.consecutive_failures + 1 >= 5
        THEN 'open'
        ELSE 'closed'
      END,
      consecutive_failures = LEAST(circuit_row.consecutive_failures + 1, 1000000),
      opened_until = CASE
        WHEN circuit_row.state IN ('open', 'half_open')
          OR circuit_row.consecutive_failures + 1 >= 5
        THEN now_value + interval '60 seconds'
        ELSE NULL
      END,
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version;

    UPDATE ai_operation_attempts
    SET state = 'failed', failure_code = 'operation_ambiguous',
      settled_at = now_value
    WHERE operation_id = candidate.operation_id
      AND attempt = operation_row.execution_attempt
      AND state = 'executing';
    UPDATE ai_operations
    SET state = 'failed', failure_code = 'operation_ambiguous',
      next_attempt_at = NULL, updated_at = now_value
    WHERE id = candidate.operation_id
      AND state = 'executing';

    IF reservation_row.property_id IS NOT NULL THEN
      UPDATE ai_property_quota_windows
      SET reserved_cost_micros =
            reserved_cost_micros - reservation_row.maximum_cost_micros,
        settled_cost_micros =
            settled_cost_micros + candidate.maximum_cost_micros,
        updated_at = now_value
      WHERE property_id = reservation_row.property_id
        AND generation = reservation_row.property_window_generation;
      UPDATE ai_organization_cost_windows
      SET reserved_cost_micros =
            reserved_cost_micros - reservation_row.maximum_cost_micros,
        settled_cost_micros =
            settled_cost_micros + candidate.maximum_cost_micros,
        updated_at = now_value
      WHERE organization_id = reservation_row.organization_id
        AND utc_date = reservation_row.organization_utc_date;
    ELSE
      UPDATE ai_canary_authorizations
      SET state = 'terminal_failed', settled_at = now_value
      WHERE id = operation_row.canary_authorization_id
        AND state = 'consumed';
      UPDATE ai_canary_authorization_heads
      SET transition_generation = transition_generation + 1,
        state = 'terminal_failed',
        updated_at = now_value
      WHERE release_sha = operation_row.release_sha
        AND canary_profile_version = operation_row.canary_profile_version
        AND current_permit_id = candidate.id;
    END IF;
    reaped_count := reaped_count + 1;
  END LOOP;
  RETURN reaped_count;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "reap_expired_ai_execution_permits_v1"(integer)
FROM PUBLIC;