CREATE OR REPLACE FUNCTION public.ai_advisory_lock_key_v1(p_lock_key text)
 RETURNS bigint
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
  SELECT hashtextextended(p_lock_key, 0)
$function$
;
--> statement-breakpoint
-- DB-only constructs: the functions and triggers no pgTable declaration can
-- express. Extracted from a database migrated by the complete 182-migration
-- journal, immediately before that journal was squashed to one baseline
-- (2026-09-05). This file is the second migration and the authority for these
-- objects; src/shared/db/schema/db-only-constructs.ts parses their names from
-- it. Edit here, then `pnpm db:baseline && pnpm db:reset`.
--
-- Two ordering facts are load-bearing:
--   * Extension-owned functions are excluded. btree_gist installs 188
--     C-language functions into `public`; recreating them is both wrong and
--     impossible. The 114 that remain are exactly what the previous
--     hand-maintained register listed.
--   * plpgsql functions come first, SQL-language functions last. PostgreSQL
--     validates a SQL function body at CREATE time, so a SQL function that
--     calls a plpgsql one fails if it is created first. Name order alone put
--     revoke_ai_canary_authorization_v1 ahead of the function it calls.
--     Within the SQL group, name order already places callees first.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.advance_review_reply_state_revision_on_delete_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."source" = 'internal' AND EXISTS (
    SELECT 1
    FROM "reviews"
    WHERE "id" = OLD."review_id"
      AND "organization_id" = OLD."organization_id"
  ) THEN
    PERFORM "advance_review_reply_state_revision_v1"(
      OLD."review_id",
      OLD."organization_id"
    );
  END IF;
  RETURN OLD;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.advance_review_reply_state_revision_v1(p_review_id uuid, p_organization_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  changed_rows integer;
BEGIN
  UPDATE "reviews"
  SET "reply_state_revision" = "reply_state_revision" + 1
  WHERE "id" = p_review_id
    AND "organization_id" = p_organization_id
    AND "reply_state_revision" < '9007199254740991'::bigint;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'cannot advance review reply state revision';
  END IF;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ai_epoch_millis_v1(p_timestamp timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  result numeric;
BEGIN
  result := floor(extract(epoch FROM p_timestamp)::numeric * 1000);
  IF result < 0 OR result > 9007199254740991 THEN
    RAISE EXCEPTION 'ai_epoch_millis_v1_out_of_range' USING ERRCODE = '22003';
  END IF;
  RETURN result::bigint;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ai_property_local_date_v1(p_reviewed_at timestamp with time zone, p_timezone text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_epoch_millis bigint;
  v_millisecond_instant timestamp with time zone;
  v_local_date date;
BEGIN
  IF length(p_timezone) NOT BETWEEN 1 AND 64
    OR p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  THEN
    RETURN NULL;
  END IF;
  v_epoch_millis := public.ai_epoch_millis_v1(p_reviewed_at);
  v_millisecond_instant :=
    timestamp with time zone '1970-01-01 00:00:00+00'
    + (v_epoch_millis * interval '1 millisecond');
  v_local_date := (v_millisecond_instant AT TIME ZONE p_timezone)::date;
  IF extract(year FROM v_local_date) NOT BETWEEN 1970 AND 2100 THEN
    RETURN NULL;
  END IF;
  RETURN v_local_date;
EXCEPTION
  WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ai_property_local_midnight_v1(p_local_date date, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_midnight timestamp with time zone;
BEGIN
  IF extract(year FROM p_local_date) NOT BETWEEN 1970 AND 2100
    OR length(p_timezone) NOT BETWEEN 1 AND 64
    OR p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  THEN
    RETURN NULL;
  END IF;
  v_midnight := p_local_date::timestamp AT TIME ZONE p_timezone;
  IF public.ai_property_local_date_v1(v_midnight, p_timezone) <> p_local_date THEN
    RETURN NULL;
  END IF;
  RETURN v_midnight;
EXCEPTION
  WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.apply_merchant_ai_transition_v1(p_authorization_lineage_id uuid, p_expected_state_version integer, p_state_version integer, p_organization_id character varying, p_property_id uuid, p_transition_kind text, p_state text, p_capabilities text[], p_runtime_profiles jsonb, p_review_analysis_epoch integer, p_reply_drafting_epoch integer, p_property_trends_epoch integer, p_authorized_source_epoch integer, p_analysis_start_sequence bigint, p_notice_version character varying, p_notice_digest character varying, p_source_policy_id character varying, p_routing_policy_version integer, p_processing_region character varying, p_provider_deployment_profile_version character varying, p_redaction_profile_family character varying, p_actor_user_id character varying, p_reason_code character varying, p_idempotency_key character varying, p_request_hash character varying, p_occurred_at timestamp with time zone)
 RETURNS merchant_ai_consent_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  current_head merchant_ai_enablement%ROWTYPE;
  replay merchant_ai_consent_evidence%ROWTYPE;
  inserted_evidence merchant_ai_consent_evidence%ROWTYPE;
  actor_role text;
  property_source_epoch integer;
  property_lifecycle_state text;
  property_binding_state text;
  property_deleted_at timestamp with time zone;
  review_head_sequence bigint;
  head_found boolean;
  contract_changed boolean;
  reset_analysis_watermark boolean;
  expected_review_analysis_epoch integer;
  expected_reply_drafting_epoch integer;
  expected_property_trends_epoch integer;
BEGIN
  IF p_expected_state_version < 0
    OR p_occurred_at IS NULL
    OR p_authorized_source_epoch < 0
    OR p_analysis_start_sequence < 0
    OR p_analysis_start_sequence > 9007199254740991
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_transition_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO replay
  FROM merchant_ai_consent_evidence
  WHERE organization_id = p_organization_id
    AND idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    IF replay.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'merchant_ai_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN replay;
  END IF;

  SELECT lifecycle_state, google_binding_state, deleted_at, source_epoch
  INTO property_lifecycle_state, property_binding_state, property_deleted_at,
       property_source_epoch
  FROM properties
  WHERE organization_id = p_organization_id
    AND id = p_property_id
  FOR SHARE;
  IF NOT FOUND
    OR property_deleted_at IS NOT NULL
    OR (
      p_transition_kind <> 'revoke'
      AND property_source_epoch <> p_authorized_source_epoch
    )
    OR (
      p_transition_kind <> 'revoke'
      AND p_transition_kind <> 'restore_reset'
      AND (
        property_lifecycle_state <> 'active'
        OR property_binding_state <> 'active'
      )
    )
  THEN
    RAISE EXCEPTION 'merchant_ai_property_inactive' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO actor_role
  FROM member
  WHERE "organizationId" = p_organization_id
    AND "userId" = p_actor_user_id
  FOR SHARE;
  IF p_transition_kind <> 'restore_reset' THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'merchant_ai_membership_denied' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      'owner' = ANY (
        regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
      )
    ) AND (
      NOT (
        'admin' = ANY (
          regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM property_access_grant
        WHERE organization_id = p_organization_id
          AND property_id = p_property_id
          AND user_id = p_actor_user_id
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > p_occurred_at)
      )
    ) THEN
      RAISE EXCEPTION 'merchant_ai_assignment_denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO current_head
  FROM merchant_ai_enablement
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
  FOR UPDATE;
  head_found := FOUND;

  IF (NOT head_found AND p_expected_state_version <> 0)
    OR (
      head_found
      AND current_head.state_version <> p_expected_state_version
    )
  THEN
    RAISE EXCEPTION 'merchant_ai_version_conflict' USING ERRCODE = '40001';
  END IF;

  IF p_transition_kind = 'restore_reset' THEN
    IF p_state <> 'disabled'
      OR cardinality(p_capabilities) <> 0
      OR p_state_version <> 1
      OR p_analysis_start_sequence <> 0
      OR (head_found AND current_head.authorization_lineage_id = p_authorization_lineage_id)
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_restore_reset' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF p_state_version <> p_expected_state_version + 1
      OR (
        p_transition_kind = 'enable'
        AND (
          p_state <> 'enabled'
          OR (head_found AND current_head.state NOT IN ('disabled', 'revoked'))
        )
      )
      OR (
        p_transition_kind = 'change'
        AND (
          NOT head_found
          OR current_head.state <> 'enabled'
          OR p_state <> 'enabled'
        )
      )
      OR (
        p_transition_kind = 'revoke'
        AND (
          NOT head_found
          OR current_head.state <> 'enabled'
          OR p_state <> 'revoked'
          OR cardinality(p_capabilities) <> 0
          OR current_head.authorized_source_epoch <> p_authorized_source_epoch
          OR current_head.analysis_start_sequence <> p_analysis_start_sequence
        )
      )
      OR p_transition_kind NOT IN ('enable', 'change', 'revoke')
      OR (
        head_found
        AND current_head.authorization_lineage_id <> p_authorization_lineage_id
      )
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_state_transition' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_transition_kind IN ('enable', 'change') THEN
    SELECT head_sequence INTO review_head_sequence
    FROM review_ai_analysis_heads
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_authorized_source_epoch
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'merchant_ai_review_head_unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT head_found OR p_transition_kind = 'restore_reset' THEN
    expected_review_analysis_epoch := 1;
    expected_reply_drafting_epoch := 1;
    expected_property_trends_epoch := 1;
    IF p_transition_kind <> 'restore_reset'
      AND p_analysis_start_sequence <> review_head_sequence
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_transition_kind = 'enable' THEN
    expected_review_analysis_epoch := current_head.review_analysis_epoch + 1;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + 1;
    expected_property_trends_epoch := current_head.property_trends_epoch + 1;
    IF p_analysis_start_sequence <> review_head_sequence THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_transition_kind = 'revoke' THEN
    expected_review_analysis_epoch := current_head.review_analysis_epoch + 1;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + 1;
    expected_property_trends_epoch := current_head.property_trends_epoch + 1;
  ELSE
    contract_changed :=
      current_head.notice_version <> p_notice_version
      OR current_head.notice_digest <> p_notice_digest
      OR current_head.source_policy_id <> p_source_policy_id
      OR current_head.routing_policy_version <> p_routing_policy_version
      OR current_head.provider_deployment_profile_version
        <> p_provider_deployment_profile_version
      OR current_head.redaction_profile_family <> p_redaction_profile_family;

    expected_review_analysis_epoch := current_head.review_analysis_epoch + CASE
      WHEN (
        (
          ('review_analysis' = ANY(current_head.capabilities))
          <> ('review_analysis' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR contract_changed
            OR current_head.capability_runtime_profile_versions->>'review_analysis'
              IS DISTINCT FROM p_runtime_profiles->>'review_analysis'
          )
          AND (
            'review_analysis' = ANY(current_head.capabilities)
            OR 'review_analysis' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;
    expected_reply_drafting_epoch := current_head.reply_drafting_epoch + CASE
      WHEN (
        (
          ('reply_drafting' = ANY(current_head.capabilities))
          <> ('reply_drafting' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR contract_changed
            OR current_head.capability_runtime_profile_versions->>'reply_drafting'
              IS DISTINCT FROM p_runtime_profiles->>'reply_drafting'
          )
          AND (
            'reply_drafting' = ANY(current_head.capabilities)
            OR 'reply_drafting' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;
    expected_property_trends_epoch := current_head.property_trends_epoch + CASE
      WHEN (
        (
          ('property_trends' = ANY(current_head.capabilities))
          <> ('property_trends' = ANY(p_capabilities))
        )
        OR (
          (
            current_head.authorized_source_epoch <> p_authorized_source_epoch
            OR contract_changed
            OR current_head.capability_runtime_profile_versions->>'property_trends'
              IS DISTINCT FROM p_runtime_profiles->>'property_trends'
          )
          AND (
            'property_trends' = ANY(current_head.capabilities)
            OR 'property_trends' = ANY(p_capabilities)
          )
        )
      ) THEN 1 ELSE 0
    END;

    reset_analysis_watermark :=
      'review_analysis' = ANY(p_capabilities)
      AND (
        NOT ('review_analysis' = ANY(current_head.capabilities))
        OR current_head.authorized_source_epoch <> p_authorized_source_epoch
      );
    IF reset_analysis_watermark THEN
      IF p_analysis_start_sequence <> review_head_sequence THEN
        RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
      END IF;
    ELSIF p_analysis_start_sequence <> current_head.analysis_start_sequence THEN
      RAISE EXCEPTION 'merchant_ai_invalid_analysis_sequence' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_review_analysis_epoch <> expected_review_analysis_epoch
    OR p_reply_drafting_epoch <> expected_reply_drafting_epoch
    OR p_property_trends_epoch <> expected_property_trends_epoch
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_capability_epoch' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('repkey.merchant_ai_transition', '1', true);
  INSERT INTO merchant_ai_consent_evidence (
    authorization_lineage_id, state_version, organization_id, property_id,
    transition_kind, state, capabilities, capability_runtime_profile_versions,
    review_analysis_epoch, reply_drafting_epoch, property_trends_epoch,
    authorized_source_epoch, analysis_start_sequence, notice_version, notice_digest,
    source_policy_id, routing_policy_version, processing_region,
    provider_deployment_profile_version, redaction_profile_family,
    actor_user_id, reason_code, idempotency_key, request_hash, occurred_at
  ) VALUES (
    p_authorization_lineage_id, p_state_version, p_organization_id, p_property_id,
    p_transition_kind, p_state, p_capabilities, p_runtime_profiles,
    p_review_analysis_epoch, p_reply_drafting_epoch, p_property_trends_epoch,
    p_authorized_source_epoch, p_analysis_start_sequence, p_notice_version,
    p_notice_digest, p_source_policy_id, p_routing_policy_version,
    p_processing_region, p_provider_deployment_profile_version,
    p_redaction_profile_family, p_actor_user_id, p_reason_code,
    p_idempotency_key, p_request_hash, p_occurred_at
  )
  RETURNING * INTO inserted_evidence;

  INSERT INTO merchant_ai_enablement (
    property_id, organization_id, authorization_lineage_id, state, capabilities,
    capability_runtime_profile_versions, review_analysis_epoch,
    reply_drafting_epoch, property_trends_epoch, authorized_source_epoch,
    analysis_start_sequence, state_version, notice_version, notice_digest,
    source_policy_id, routing_policy_version, processing_region,
    provider_deployment_profile_version, redaction_profile_family,
    updated_by, updated_at
  ) VALUES (
    p_property_id, p_organization_id, p_authorization_lineage_id, p_state,
    p_capabilities, p_runtime_profiles, p_review_analysis_epoch,
    p_reply_drafting_epoch, p_property_trends_epoch, p_authorized_source_epoch,
    p_analysis_start_sequence, p_state_version, p_notice_version, p_notice_digest,
    p_source_policy_id, p_routing_policy_version, p_processing_region,
    p_provider_deployment_profile_version, p_redaction_profile_family,
    p_actor_user_id, p_occurred_at
  )
  ON CONFLICT (property_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    authorization_lineage_id = EXCLUDED.authorization_lineage_id,
    state = EXCLUDED.state,
    capabilities = EXCLUDED.capabilities,
    capability_runtime_profile_versions = EXCLUDED.capability_runtime_profile_versions,
    review_analysis_epoch = EXCLUDED.review_analysis_epoch,
    reply_drafting_epoch = EXCLUDED.reply_drafting_epoch,
    property_trends_epoch = EXCLUDED.property_trends_epoch,
    authorized_source_epoch = EXCLUDED.authorized_source_epoch,
    analysis_start_sequence = EXCLUDED.analysis_start_sequence,
    state_version = EXCLUDED.state_version,
    notice_version = EXCLUDED.notice_version,
    notice_digest = EXCLUDED.notice_digest,
    source_policy_id = EXCLUDED.source_policy_id,
    routing_policy_version = EXCLUDED.routing_policy_version,
    processing_region = EXCLUDED.processing_region,
    provider_deployment_profile_version = EXCLUDED.provider_deployment_profile_version,
    redaction_profile_family = EXCLUDED.redaction_profile_family,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  RETURN inserted_evidence;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.bump_permission_version(org_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF org_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO permission_version (organization_id, version, updated_at)
  VALUES (org_id, 1, now())
  ON CONFLICT (organization_id) DO UPDATE
    SET version = permission_version.version + 1, updated_at = now();
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.complete_google_execution_permit_v1(p_permit_id uuid, p_authority_revision text, p_outcome text, p_retry_after_ms integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_permit public.authorization_execution_permits%ROWTYPE;
  v_updated integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_outcome NOT IN (
    'success', 'provider_4xx', 'provider_5xx', 'rate_limited',
    'deadline_exceeded', 'transport_error', 'response_too_large',
    'caller_abandoned'
  ) OR (p_retry_after_ms IS NOT NULL AND
    (p_retry_after_ms < 0 OR p_retry_after_ms > 300000)) THEN
    RETURN false;
  END IF;

  SELECT permit.* INTO v_permit
  FROM public.authorization_execution_permits AS permit
  WHERE permit.id = p_permit_id
  FOR UPDATE OF permit;
  IF v_permit.id IS NULL
    OR v_permit.state <> 'started'
    OR public.google_execution_permit_revision_v1(v_permit) <>
      p_authority_revision THEN
    RETURN false;
  END IF;

  IF v_permit.operation_deadline_at IS NULL
    OR v_permit.operation_deadline_at <= v_now THEN
    UPDATE public.authorization_execution_permits AS permit
    SET state = 'fenced',
        fenced_at = v_now,
        correlation_id = 'operation_deadline_elapsed'
    WHERE permit.id = p_permit_id
      AND permit.state = 'started';
    RETURN false;
  END IF;

  UPDATE public.authorization_execution_permits AS permit
  SET state = 'completed',
      completed_at = v_now,
      correlation_id = CASE WHEN p_retry_after_ms IS NULL
        THEN p_outcome
        ELSE p_outcome || ':retry_after_' || p_retry_after_ms::text END
  WHERE permit.id = p_permit_id
    AND permit.state = 'started';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_inbox_feedback_handling_outcome_append_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  completion_transition public.inbox_handling_cycle_transitions%ROWTYPE;
  previous_outcome public.inbox_feedback_handling_outcomes%ROWTYPE;
BEGIN
  SELECT * INTO completion_transition
  FROM public.inbox_handling_cycle_transitions
  WHERE inbox_item_id = NEW.inbox_item_id
    AND state_revision = NEW.completion_state_revision;

  IF NOT FOUND
     OR completion_transition.cycle_number <> NEW.cycle_number
     OR completion_transition.kind <> 'closed'
     OR completion_transition.transition_reason <> 'private_feedback_handled'
     OR completion_transition.transitioned_at <> NEW.completion_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'feedback outcome requires its private_feedback_handled completion transition';
  END IF;

  IF NEW.outcome_revision = 1 THEN
    IF NEW.recorded_at <> NEW.completion_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'initial feedback outcome must be recorded at completion';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous_outcome
  FROM public.inbox_feedback_handling_outcomes
  WHERE inbox_item_id = NEW.inbox_item_id
    AND cycle_number = NEW.cycle_number
    AND id = NEW.supersedes_outcome_id
    AND outcome_revision = NEW.supersedes_outcome_revision;

  IF NOT FOUND
     OR NEW.completion_at <> previous_outcome.completion_at
     OR NEW.completion_state_revision <> previous_outcome.completion_state_revision
     OR NEW.deadline_result <> previous_outcome.deadline_result
     OR NEW.recorded_at < previous_outcome.recorded_at
     OR NEW.resulting_command_revision <= previous_outcome.resulting_command_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'feedback outcome correction must preserve and directly supersede completion facts';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_inbox_response_target_reminder_terminal_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycle_response_targets
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target reminder history is immutable';
  END IF;

  IF NEW.inbox_item_id <> OLD.inbox_item_id
     OR NEW.cycle_number <> OLD.cycle_number
     OR NEW.reminder_kind <> OLD.reminder_kind
     OR NEW.event_id <> OLD.event_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.target_kind <> OLD.target_kind
     OR NEW.scheduled_for <> OLD.scheduled_for
     OR NEW.created_at <> OLD.created_at
     OR OLD.delivered_at IS NOT NULL
     OR OLD.cancelled_at IS NOT NULL
     OR ((NEW.delivered_at IS NOT NULL)::integer + (NEW.cancelled_at IS NOT NULL)::integer) <> 1
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target reminder cannot be repeated or rewritten';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_inbox_response_target_terminal_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycles
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target history is immutable';
  END IF;

  IF NEW.inbox_item_id <> OLD.inbox_item_id
     OR NEW.cycle_number <> OLD.cycle_number
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.source_type <> OLD.source_type
     OR NEW.source_id <> OLD.source_id
     OR NEW.source_revision <> OLD.source_revision
     OR NEW.target_kind <> OLD.target_kind
     OR NEW.performance_eligibility <> OLD.performance_eligibility
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
     OR NEW.policy_source IS DISTINCT FROM OLD.policy_source
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.start_at IS DISTINCT FROM OLD.start_at
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.created_at <> OLD.created_at
     OR OLD.completion_at IS NOT NULL
     OR NEW.completion_at IS NULL
     OR NEW.result IS NULL
     OR NEW.stop_reason IS NULL
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target snapshot or terminal result cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fail_google_execution_permit_v1(p_permit_id uuid, p_route_key text, p_route_catalog_version text, p_quota_policy_id text, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_updated integer;
BEGIN
  IF p_code NOT IN ('grant_unavailable', 'grant_expired') THEN
    RETURN false;
  END IF;
  UPDATE public.authorization_execution_permits AS permit
  SET state = 'fenced',
      fenced_at = clock_timestamp(),
      correlation_id = p_code
  WHERE permit.id = p_permit_id
    AND permit.state = 'started'
    AND permit.route_key = p_route_key
    AND permit.route_catalog_version = p_route_catalog_version
    AND permit.quota_policy_id = p_quota_policy_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.fence_google_connector_departure_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cause text;
  v_event_cause text;
  v_old_is_owner boolean;
  v_new_is_owner boolean;
  v_occurred_at timestamptz := clock_timestamp();
BEGIN
  v_old_is_owner := 'owner' = ANY (
    regexp_split_to_array(COALESCE(OLD."role", ''), '\\s*,\\s*')
  );

  IF TG_OP = 'DELETE' THEN
    v_cause := 'connector_departure_member_removed';
    v_event_cause := 'member_removed';
  ELSE
    v_new_is_owner := 'owner' = ANY (
      regexp_split_to_array(COALESCE(NEW."role", ''), '\\s*,\\s*')
    );
    IF NOT v_old_is_owner OR v_new_is_owner THEN
      RETURN NEW;
    END IF;
    v_cause := 'connector_departure_account_admin_role_lost';
    v_event_cause := 'account_admin_role_lost';
  END IF;

  WITH transitioned AS MATERIALIZED (
    UPDATE public.google_connections AS connection
    SET
      status = 'reauth_required',
      lifecycle_version = connection.lifecycle_version + 1,
      access_version = connection.access_version + 1,
      status_reason = v_cause,
      status_changed_at = v_occurred_at,
      updated_at = v_occurred_at
    WHERE connection.organization_id = OLD."organizationId"
      AND COALESCE(
        connection.credential_authorized_by,
        connection.connected_by
      ) = OLD."userId"
      AND connection.credential_use_state = 'active'
      AND connection.status NOT IN (
        'reauth_required',
        'disconnecting',
        'disconnected'
      )
    RETURNING connection.id, connection.organization_id
  ), facts AS (
    SELECT
      gen_random_uuid() AS event_id,
      transitioned.id AS connection_id,
      transitioned.organization_id
    FROM transitioned
  )
  INSERT INTO public.outbox_events (
    id,
    event_type,
    event_version,
    payload,
    organization_id,
    property_id,
    source_context,
    source_aggregate_id,
    created_at
  )
  SELECT
    facts.event_id,
    'integration.google_account.reauthorization_required',
    1,
    jsonb_build_object(
      'connectionId', facts.connection_id::text,
      'organizationId', facts.organization_id,
      'cause', v_event_cause,
      'occurredAt', to_char(
        v_occurred_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'correlationId', NULL
    ),
    facts.organization_id,
    NULL,
    'integration',
    facts.connection_id::text,
    v_occurred_at
  FROM facts;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_beta_feedback_triage_revision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."organization_pseudonym" IS DISTINCT FROM OLD."organization_pseudonym"
     OR NEW."actor_pseudonym" IS DISTINCT FROM OLD."actor_pseudonym"
     OR NEW."feedback_type" IS DISTINCT FROM OLD."feedback_type"
     OR NEW."impact_code" IS DISTINCT FROM OLD."impact_code"
     OR NEW."route_key" IS DISTINCT FROM OLD."route_key"
     OR NEW."viewport" IS DISTINCT FROM OLD."viewport"
     OR NEW."reporter_role" IS DISTINCT FROM OLD."reporter_role"
     OR NEW."attachment_kind" IS DISTINCT FROM OLD."attachment_kind"
     OR NEW."attachment_captured_at" IS DISTINCT FROM OLD."attachment_captured_at"
     OR NEW."attachment_expires_at" IS DISTINCT FROM OLD."attachment_expires_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'beta feedback receipt identity is immutable';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'beta feedback triage revision must advance by exactly one';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_beta_feedback_triage_transition_immutable_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'beta feedback triage transitions are append-only';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_goal_monthly_result_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  assignment_from timestamptz;
  assignment_to timestamptz;
  version_from timestamptz;
  version_to timestamptz;
  version_timezone varchar(64);
  expected_start timestamptz;
  expected_end timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goal monthly results cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'closed' THEN
    RAISE EXCEPTION 'closed goal monthly results are immutable; append a revision'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'open' AND NEW."status" = 'reconciling')
    OR (OLD."status" = 'reconciling' AND NEW."status" = 'closed')
  ) THEN
    RAISE EXCEPTION 'invalid goal monthly result transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  SELECT
    assignment."effective_from",
    assignment."effective_to",
    version."effective_from",
    version."effective_to",
    version."property_timezone"
  INTO
    assignment_from,
    assignment_to,
    version_from,
    version_to,
    version_timezone
  FROM "goal_subject_assignments" assignment
  JOIN "goal_program_versions" version
    ON version."organization_id" = assignment."organization_id"
   AND version."property_id" = assignment."property_id"
   AND version."program_id" = assignment."program_id"
   AND version."id" = assignment."program_version_id"
  WHERE assignment."organization_id" = NEW."organization_id"
    AND assignment."property_id" = NEW."property_id"
    AND assignment."program_id" = NEW."program_id"
    AND assignment."program_version_id" = NEW."program_version_id"
    AND assignment."id" = NEW."assignment_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal monthly result assignment is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."property_timezone" <> version_timezone THEN
    RAISE EXCEPTION 'goal monthly result timezone does not match its immutable program version'
      USING ERRCODE = '23514';
  END IF;

  expected_start := date_trunc('month', NEW."period_start" AT TIME ZONE version_timezone)
    AT TIME ZONE version_timezone;
  expected_end := (
    date_trunc('month', NEW."period_start" AT TIME ZONE version_timezone) + interval '1 month'
  ) AT TIME ZONE version_timezone;

  IF NEW."period_start" <> expected_start OR NEW."period_end" <> expected_end THEN
    RAISE EXCEPTION 'goal monthly result must cover one complete property-local calendar month'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."period_start" < assignment_from
    OR (assignment_to IS NOT NULL AND NEW."period_end" > assignment_to)
    OR NEW."period_start" < version_from
    OR (version_to IS NOT NULL AND NEW."period_end" > version_to)
  THEN
    RAISE EXCEPTION 'goal monthly result falls outside its assignment or version window'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'reconciling' AND clock_timestamp() < NEW."period_end" THEN
    RAISE EXCEPTION 'goal monthly result cannot reconcile before its period ends'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'closed'
    AND clock_timestamp() < NEW."period_end" + interval '24 hours'
  THEN
    RAISE EXCEPTION 'goal monthly result cannot close before the reconciliation window ends'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_goal_program_transition_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."current_version" < OLD."current_version" THEN
    RAISE EXCEPTION 'goal program current_version cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'scheduled' AND NEW."status" IN ('active', 'ended'))
    OR (OLD."status" = 'active' AND NEW."status" IN ('paused', 'ended'))
    OR (OLD."status" = 'paused' AND NEW."status" IN ('active', 'ended'))
  ) THEN
    RAISE EXCEPTION 'invalid goal program transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  org_id text;
  remaining_owners int;
BEGIN
  org_id := COALESCE(OLD."organizationId", NEW."organizationId");
  IF org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Only restrict when the row currently holds the owner token.
  IF string_to_array(COALESCE(OLD."role", ''), ',') @> ARRAY['owner'] THEN
    SELECT count(*) INTO remaining_owners
    FROM member
    WHERE "organizationId" = org_id
      AND id <> OLD.id
      AND string_to_array("role", ',') @> ARRAY['owner'];
    IF remaining_owners = 0 THEN
      RAISE EXCEPTION 'cannot_remove_last_owner: organization % would have no owner', org_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_merchant_ai_enablement_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  evidence merchant_ai_consent_evidence%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF current_setting('repkey.merchant_ai_transition', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'merchant_ai_head_requires_transition_function' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'merchant_ai_head_cannot_be_deleted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT evidence
  FROM merchant_ai_consent_evidence
  WHERE authorization_lineage_id = NEW.authorization_lineage_id
    AND state_version = NEW.state_version;
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id <> OLD.organization_id
    OR NEW.property_id <> OLD.property_id
    OR (
      evidence.transition_kind <> 'restore_reset'
      AND (
        NEW.authorization_lineage_id <> OLD.authorization_lineage_id
        OR NEW.state_version <> OLD.state_version + 1
      )
    )
    OR (
      evidence.transition_kind = 'restore_reset'
      AND (
        NEW.authorization_lineage_id = OLD.authorization_lineage_id
        OR NEW.state_version <> 1
        OR NEW.state <> 'disabled'
      )
    )
  ) THEN
    RAISE EXCEPTION 'merchant_ai_head_lineage_replacement' USING ERRCODE = 'P0001';
  END IF;

  IF evidence.organization_id <> NEW.organization_id
    OR evidence.property_id <> NEW.property_id
    OR evidence.state <> NEW.state
    OR evidence.capabilities <> NEW.capabilities
    OR evidence.capability_runtime_profile_versions <> NEW.capability_runtime_profile_versions
    OR evidence.review_analysis_epoch <> NEW.review_analysis_epoch
    OR evidence.reply_drafting_epoch <> NEW.reply_drafting_epoch
    OR evidence.property_trends_epoch <> NEW.property_trends_epoch
    OR evidence.authorized_source_epoch <> NEW.authorized_source_epoch
    OR evidence.analysis_start_sequence <> NEW.analysis_start_sequence
    OR evidence.notice_version <> NEW.notice_version
    OR evidence.notice_digest <> NEW.notice_digest
    OR evidence.source_policy_id <> NEW.source_policy_id
    OR evidence.routing_policy_version <> NEW.routing_policy_version
    OR evidence.processing_region <> NEW.processing_region
    OR evidence.provider_deployment_profile_version <> NEW.provider_deployment_profile_version
    OR evidence.redaction_profile_family <> NEW.redaction_profile_family
  THEN
    RAISE EXCEPTION 'merchant_ai_head_evidence_mismatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_merchant_ai_evidence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  prior merchant_ai_consent_evidence%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF current_setting('repkey.merchant_ai_transition', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'merchant_ai_history_is_append_only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'merchant_ai_history_is_append_only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO prior
  FROM merchant_ai_consent_evidence
  WHERE authorization_lineage_id = NEW.authorization_lineage_id
    AND state_version = NEW.state_version - 1
  FOR SHARE;

  IF NEW.state_version = 1 THEN
    IF FOUND
      OR NOT (
        (NEW.transition_kind = 'enable' AND NEW.state = 'enabled')
        OR (NEW.transition_kind = 'restore_reset' AND NEW.state = 'disabled')
      )
      OR NEW.review_analysis_epoch <> 1 OR NEW.reply_drafting_epoch <> 1
      OR NEW.property_trends_epoch <> 1
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_initial_transition' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF NOT FOUND
      OR prior.organization_id <> NEW.organization_id
      OR prior.property_id <> NEW.property_id
      OR NEW.state_version <> prior.state_version + 1
      OR NEW.review_analysis_epoch < prior.review_analysis_epoch
      OR NEW.review_analysis_epoch > prior.review_analysis_epoch + 1
      OR NEW.reply_drafting_epoch < prior.reply_drafting_epoch
      OR NEW.reply_drafting_epoch > prior.reply_drafting_epoch + 1
      OR NEW.property_trends_epoch < prior.property_trends_epoch
      OR NEW.property_trends_epoch > prior.property_trends_epoch + 1
    THEN
      RAISE EXCEPTION 'merchant_ai_invalid_transition_lineage' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_operational_action_history_head_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History sequence authority rejects %', TG_OP;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.last_sequence <> OLD.last_sequence + 1
    OR NEW.last_recorded_at IS NULL
    OR (OLD.last_recorded_at IS NOT NULL
      AND NEW.last_recorded_at < OLD.last_recorded_at)
    OR NEW.updated_at IS DISTINCT FROM NEW.last_recorded_at THEN
    RAISE EXCEPTION 'Operational Action History sequence authority rejects UPDATE';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_operational_action_history_hold_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History append-only legal-hold evidence rejects %', TG_OP;
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.reason_code,
    NEW.protects_from,
    NEW.protects_through,
    NEW.placed_at,
    NEW.placed_by_actor_id
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.reason_code,
    OLD.protects_from,
    OLD.protects_through,
    OLD.placed_at,
    OLD.placed_by_actor_id
  ) OR NOT (
    (NEW.released_at IS NOT DISTINCT FROM OLD.released_at
      AND NEW.released_by_actor_id IS NOT DISTINCT FROM OLD.released_by_actor_id
      AND NEW.release_reason_code IS NOT DISTINCT FROM OLD.release_reason_code)
    OR (OLD.released_at IS NULL
      AND OLD.released_by_actor_id IS NULL
      AND OLD.release_reason_code IS NULL
      AND NEW.released_at IS NOT NULL
      AND NEW.released_by_actor_id IS NOT NULL
      AND NEW.release_reason_code IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Operational Action History append-only legal-hold evidence rejects UPDATE';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_operational_action_history_record_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Operational Action History append-only core rejects %', TG_OP;
  END IF;

  IF ROW(
    NEW.id,
    NEW.organization_id,
    NEW.sequence,
    NEW.property_id,
    NEW.actor_type,
    NEW.action,
    NEW.outcome,
    NEW.resource_type,
    NEW.reason_code,
    NEW.provenance_kind,
    NEW.provenance_id,
    NEW.source_event_type,
    NEW.source_event_version,
    NEW.source_context,
    NEW.source_aggregate_id,
    NEW.occurred_at,
    NEW.recorded_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.organization_id,
    OLD.sequence,
    OLD.property_id,
    OLD.actor_type,
    OLD.action,
    OLD.outcome,
    OLD.resource_type,
    OLD.reason_code,
    OLD.provenance_kind,
    OLD.provenance_id,
    OLD.source_event_type,
    OLD.source_event_version,
    OLD.source_context,
    OLD.source_aggregate_id,
    OLD.occurred_at,
    OLD.recorded_at
  ) OR NOT (
    (NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
      AND NEW.actor_redacted_at IS NOT DISTINCT FROM OLD.actor_redacted_at)
    OR (OLD.actor_id IS NOT NULL
      AND NEW.actor_id IS NULL
      AND OLD.actor_redacted_at IS NULL
      AND NEW.actor_redacted_at IS NOT NULL)
  ) OR NOT (
    (NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
      AND NEW.resource_redacted_at IS NOT DISTINCT FROM OLD.resource_redacted_at)
    OR (OLD.resource_id IS NOT NULL
      AND NEW.resource_id IS NULL
      AND OLD.resource_redacted_at IS NULL
      AND NEW.resource_redacted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Operational Action History append-only core rejects UPDATE';
  END IF;

  IF (
    NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
  ) AND EXISTS (
    SELECT 1
    FROM operational_action_history_legal_holds AS hold
    WHERE hold.organization_id = OLD.organization_id
      AND hold.released_at IS NULL
      AND OLD.occurred_at >= hold.protects_from
      AND (hold.protects_through IS NULL OR OLD.occurred_at <= hold.protects_through)
  ) THEN
    RAISE EXCEPTION 'Operational Action History active legal hold rejects redaction';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_organization_export_retrieval_issuance_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  authority public.organization_exports%ROWTYPE;
BEGIN
  SELECT * INTO authority
  FROM public.organization_exports
  WHERE id = NEW.export_id
  FOR UPDATE;

  IF NOT FOUND
     OR NEW.organization_id IS DISTINCT FROM authority.organization_id
     OR NEW.export_revision IS DISTINCT FROM authority.revision + 1 THEN
    RAISE EXCEPTION 'organization export retrieval issuance authority changed';
  END IF;

  IF NOT (
    authority.state = 'ready'
    OR (
      authority.state = 'retrieval_issued'
      AND authority.retrieval_expires_at <= NEW.issued_at
    )
  ) THEN
    RAISE EXCEPTION 'organization export retrieval issuance state is unavailable';
  END IF;

  IF NEW.expires_at > authority.object_expires_at THEN
    RAISE EXCEPTION 'organization export retrieval issuance exceeds object expiry';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_organization_export_revision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
     OR NEW."format_version" IS DISTINCT FROM OLD."format_version"
     OR NEW."as_of" IS DISTINCT FROM OLD."as_of"
     OR NEW."object_expires_at" IS DISTINCT FROM OLD."object_expires_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'organization export immutable request binding changed';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'organization export revision must advance by exactly one';
  END IF;

  IF NOT (
    (OLD."state" = 'requested' AND NEW."state" IN ('generating', 'failed'))
    OR (OLD."state" = 'generating' AND NEW."state" IN ('generating', 'egress_pending', 'failed'))
    OR (OLD."state" = 'egress_pending' AND NEW."state" IN ('egress_pending', 'ready', 'failed'))
    OR (OLD."state" = 'ready' AND NEW."state" IN ('retrieval_issued', 'delete_pending'))
    OR (
      OLD."state" = 'retrieval_issued'
      AND NEW."state" = 'retrieval_issued'
      AND OLD."retrieval_expires_at" <= NEW."retrieval_issued_at"
      AND NEW."retrieval_operation_id" IS DISTINCT FROM OLD."retrieval_operation_id"
      AND NEW."retrieval_token_digest" IS DISTINCT FROM OLD."retrieval_token_digest"
    )
    OR (OLD."state" = 'retrieval_issued' AND NEW."state" IN ('retrieved', 'delete_pending'))
    OR (OLD."state" = 'retrieved' AND NEW."state" = 'delete_pending')
    OR (OLD."state" = 'delete_pending' AND NEW."state" = 'deleted')
  ) THEN
    RAISE EXCEPTION 'invalid organization export state transition: % -> %', OLD."state", NEW."state";
  END IF;

  IF NEW."state" = 'retrieval_issued' AND NOT EXISTS (
    SELECT 1
    FROM "organization_export_retrieval_issuances" AS issuance
    WHERE issuance."export_id" = NEW."id"
      AND issuance."organization_id" = NEW."organization_id"
      AND issuance."export_revision" = NEW."revision"
      AND issuance."operation_id" = NEW."retrieval_operation_id"
      AND issuance."token_digest" = NEW."retrieval_token_digest"
      AND issuance."issued_at" = NEW."retrieval_issued_at"
      AND issuance."expires_at" = NEW."retrieval_expires_at"
  ) THEN
    RAISE EXCEPTION 'organization export retrieval issuance evidence is missing';
  END IF;

  -- Pre-egress evidence is write-once. A recovery pass may only READ these
  -- values; any attempt to rewrite a digest, key, or the moment they were
  -- committed is a rebuild in disguise.
  IF (OLD."object_key" IS NOT NULL AND NEW."object_key" IS DISTINCT FROM OLD."object_key")
     OR (OLD."coverage_sha256" IS NOT NULL AND NEW."coverage_sha256" IS DISTINCT FROM OLD."coverage_sha256")
     OR (OLD."manifest_sha256" IS NOT NULL AND NEW."manifest_sha256" IS DISTINCT FROM OLD."manifest_sha256")
     OR (OLD."archive_sha256" IS NOT NULL AND NEW."archive_sha256" IS DISTINCT FROM OLD."archive_sha256")
     OR (OLD."pre_egress_recorded_at" IS NOT NULL AND NEW."pre_egress_recorded_at" IS DISTINCT FROM OLD."pre_egress_recorded_at")
     OR (OLD."encryption_evidence_ref" IS NOT NULL AND NEW."encryption_evidence_ref" IS DISTINCT FROM OLD."encryption_evidence_ref") THEN
    RAISE EXCEPTION 'organization export immutable archive evidence changed';
  END IF;

  IF NEW."egress_recovery_attempts" < OLD."egress_recovery_attempts" THEN
    RAISE EXCEPTION 'organization export egress recovery evidence cannot be rewound';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_organization_lifecycle_revision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
    RAISE EXCEPTION 'organization lifecycle authority cannot change tenant';
  END IF;

  IF NEW."revision" IS DISTINCT FROM OLD."revision" + 1 THEN
    RAISE EXCEPTION 'organization lifecycle revision must advance by exactly one';
  END IF;

  IF NOT (
    (OLD."state" = 'active' AND NEW."state" = 'closure_requested')
    OR (OLD."state" = 'closure_requested' AND NEW."state" IN ('active', 'closing'))
    OR (OLD."state" = 'closing' AND NEW."state" IN ('active', 'purge_pending'))
    OR (OLD."state" = 'purge_pending' AND NEW."state" IN ('active', 'purging'))
    OR (OLD."state" = 'purging' AND NEW."state" = 'closed')
  ) THEN
    RAISE EXCEPTION 'invalid organization lifecycle state transition: % -> %', OLD."state", NEW."state";
  END IF;

  IF NOT (
    (OLD."state" = 'active' AND NEW."state" = 'closure_requested' AND NEW."last_reason_code" IN ('account_admin_request', 'contract_ended', 'duplicate_workspace', 'privacy_request', 'test_workspace'))
    OR (OLD."state" = 'closure_requested' AND NEW."state" = 'active' AND NEW."last_reason_code" IN ('closure_cancelled', 'request_created_in_error', 'retention_needed'))
    OR (OLD."state" = 'closure_requested' AND NEW."state" = 'closing' AND NEW."last_reason_code" = 'closing_prepared')
    OR (OLD."state" = 'closing' AND NEW."state" = 'active' AND NEW."last_reason_code" IN ('closure_cancelled', 'request_created_in_error', 'retention_needed'))
    OR (OLD."state" = 'closing' AND NEW."state" = 'purge_pending' AND NEW."last_reason_code" IN ('recovery_window_elapsed', 'recovery_window_waived'))
    OR (OLD."state" = 'purge_pending' AND NEW."state" = 'active' AND NEW."last_reason_code" = 'purge_cancelled_before_irreversible')
    OR (OLD."state" = 'purge_pending' AND NEW."state" = 'purging' AND NEW."last_reason_code" = 'irreversible_purge_authorized')
    OR (OLD."state" = 'purging' AND NEW."state" = 'closed' AND NEW."last_reason_code" = 'context_purge_complete')
  ) THEN
    RAISE EXCEPTION 'organization lifecycle reason does not match state transition';
  END IF;

  IF OLD."state" = 'active' AND OLD."reactivation_required" = true THEN
    RAISE EXCEPTION 'organization lifecycle requires explicit reactivation before a new closure';
  END IF;

  IF OLD."state" <> 'active' AND (
    NEW."closure_lineage_id" IS DISTINCT FROM OLD."closure_lineage_id"
    OR NEW."closure_requested_at" IS DISTINCT FROM OLD."closure_requested_at"
    OR NEW."recoverable_until" IS DISTINCT FROM OLD."recoverable_until"
    OR NEW."requested_by" IS DISTINCT FROM OLD."requested_by"
    OR NEW."request_reason_code" IS DISTINCT FROM OLD."request_reason_code"
    OR NEW."request_support_evidence_ref" IS DISTINCT FROM OLD."request_support_evidence_ref"
  ) THEN
    RAISE EXCEPTION 'organization lifecycle closure request evidence is immutable';
  END IF;

  IF OLD."irreversible_at" IS NOT NULL
     AND NEW."irreversible_at" IS DISTINCT FROM OLD."irreversible_at" THEN
    RAISE EXCEPTION 'organization lifecycle irreversible boundary is immutable';
  END IF;

  IF NEW."last_transition_at" < OLD."last_transition_at" THEN
    RAISE EXCEPTION 'organization lifecycle transition time cannot move backwards';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_portal_publication_history_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'portal_publication_snapshots' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'portal publication snapshots are immutable';
  END IF;

  IF OLD.deactivated_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR NEW.portal_id IS DISTINCT FROM OLD.portal_id
     OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.activation_sequence IS DISTINCT FROM OLD.activation_sequence
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.activated_by IS DISTINCT FROM OLD.activated_by
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR NEW.deactivated_at IS NULL
     OR NEW.deactivation_reason IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'portal publication activation history is append-only';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_primary_staff_attribution_immutable_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF ROW(
    NEW.attributed_staff_participant_id,
    NEW.attributed_staff_participation_id,
    NEW.attribution_responsibility_id,
    NEW.staff_attribution_effective_from,
    NEW.staff_attribution_effective_to
  ) IS DISTINCT FROM ROW(
    OLD.attributed_staff_participant_id,
    OLD.attributed_staff_participation_id,
    OLD.attribution_responsibility_id,
    OLD.staff_attribution_effective_from,
    OLD.staff_attribution_effective_to
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'event-time Primary Staff attribution is immutable';
  END IF;
  RETURN NEW;
END
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_review_lifecycle_recovery_execution_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery evidence is durable and cannot be removed';
  END IF;

  IF ROW(
    NEW."id",
    NEW."recovery_generation",
    NEW."approval_id",
    NEW."approval_bundle_sha256",
    NEW."approver_identity",
    NEW."approval_key_id",
    NEW."approved_at",
    NEW."expires_at",
    NEW."release_sha",
    NEW."release_manifest_sha256",
    NEW."restore_point_at",
    NEW."restore_database_service_name",
    NEW."railway_project_id",
    NEW."railway_environment_id",
    NEW."evaluated_at",
    NEW."source_policy_version",
    NEW."retention_policy_version",
    NEW."policy_sha256",
    NEW."report_sha256",
    NEW."report_expired",
    NEW."operator_id",
    NEW."correlation_id",
    NEW."started_at"
  ) IS DISTINCT FROM ROW(
    OLD."id",
    OLD."recovery_generation",
    OLD."approval_id",
    OLD."approval_bundle_sha256",
    OLD."approver_identity",
    OLD."approval_key_id",
    OLD."approved_at",
    OLD."expires_at",
    OLD."release_sha",
    OLD."release_manifest_sha256",
    OLD."restore_point_at",
    OLD."restore_database_service_name",
    OLD."railway_project_id",
    OLD."railway_environment_id",
    OLD."evaluated_at",
    OLD."source_policy_version",
    OLD."retention_policy_version",
    OLD."policy_sha256",
    OLD."report_sha256",
    OLD."report_expired",
    OLD."operator_id",
    OLD."correlation_id",
    OLD."started_at"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery approval binding is immutable';
  END IF;

  IF NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Review lifecycle recovery evidence time cannot move backwards';
  END IF;

  IF OLD."state" = 'applying' AND NEW."state" = 'applying' THEN
    IF NEW."recovery_replayed" IS DISTINCT FROM OLD."recovery_replayed"
       OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
       OR NEW."pages" < OLD."pages"
       OR NEW."scanned" < OLD."scanned"
       OR NEW."rows_redacted" < OLD."rows_redacted"
       OR NEW."legacy_google_replies_reconciled" < OLD."legacy_google_replies_reconciled" THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery applying evidence cannot move backwards';
    END IF;
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled",
      NEW."checkpoint_created_at",
      NEW."checkpoint_review_id"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled",
      OLD."checkpoint_created_at",
      OLD."checkpoint_review_id"
    ) AND (
      NEW."error_code" IS NOT NULL
      OR NEW."pages" <> OLD."pages" + 1
      OR NEW."scanned" <= OLD."scanned"
      OR NEW."scanned" > OLD."scanned" + 100
      OR NEW."rows_redacted" > OLD."rows_redacted" + (NEW."scanned" - OLD."scanned")
      OR NEW."checkpoint_created_at" IS NULL
      OR (
        OLD."checkpoint_created_at" IS NOT NULL
        AND ROW(NEW."checkpoint_created_at", NEW."checkpoint_review_id")
          <= ROW(OLD."checkpoint_created_at", OLD."checkpoint_review_id")
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery page evidence is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'applying' AND NEW."state" = 'lifecycle_applied' THEN
    IF NEW."recovery_replayed" IS NOT NULL
       OR NEW."completed_at" IS NOT NULL
       OR NEW."error_code" IS NOT NULL
       OR NEW."checkpoint_created_at" IS NOT NULL
       OR NEW."checkpoint_review_id" IS NOT NULL
       OR NEW."scanned" < OLD."scanned"
       OR NEW."scanned" > OLD."scanned" + 100
       OR NEW."rows_redacted" < OLD."rows_redacted"
       OR NEW."rows_redacted" > OLD."rows_redacted" + (NEW."scanned" - OLD."scanned")
       OR NEW."legacy_google_replies_reconciled" < OLD."legacy_google_replies_reconciled"
       OR (
         NEW."scanned" = OLD."scanned"
         AND NEW."pages" <> OLD."pages"
       )
       OR (
         NEW."scanned" > OLD."scanned"
         AND NEW."pages" <> OLD."pages" + 1
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery apply transition is invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'lifecycle_applied' AND NEW."state" = 'lifecycle_applied' THEN
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled",
      NEW."checkpoint_created_at",
      NEW."checkpoint_review_id",
      NEW."recovery_replayed",
      NEW."completed_at"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled",
      OLD."checkpoint_created_at",
      OLD."checkpoint_review_id",
      OLD."recovery_replayed",
      OLD."completed_at"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery applied evidence is immutable';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."state" = 'lifecycle_applied' AND NEW."state" = 'completed' THEN
    IF ROW(
      NEW."pages",
      NEW."scanned",
      NEW."rows_redacted",
      NEW."legacy_google_replies_reconciled"
    ) IS DISTINCT FROM ROW(
      OLD."pages",
      OLD."scanned",
      OLD."rows_redacted",
      OLD."legacy_google_replies_reconciled"
    ) OR NEW."recovery_replayed" IS NULL OR NEW."completed_at" IS NULL OR NEW."error_code" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Review lifecycle recovery completion evidence is invalid';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM "recovery_runs" AS recovery
      WHERE recovery."id" = NEW."id"
        AND recovery."generation" = NEW."recovery_generation"
        AND recovery."source_release_sha" = NEW."release_sha"
        AND recovery."source_manifest_sha256" = NEW."release_manifest_sha256"
        AND recovery."restore_point_at" = NEW."restore_point_at"
        AND recovery."operator_id" = NEW."operator_id"
        AND recovery."correlation_id" = NEW."correlation_id"
        AND recovery."completed_at" = NEW."completed_at"
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Review lifecycle recovery completion has no exact recovery run';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Review lifecycle recovery state may only advance';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.increment_reply_state_revision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  material_change boolean;
  authorship_changed boolean;
  legacy_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."source" = 'google_sync' THEN
      IF NEW."authorship" IS NOT NULL OR NEW."ai_generated" THEN
        RAISE EXCEPTION 'Google reply mirrors cannot claim authorship';
      END IF;
      NEW."authorship" := NULL;
      NEW."ai_generated" := false;
    ELSE
      IF NEW."authorship" IS NULL THEN
        NEW."authorship" := CASE
          WHEN NEW."ai_generated" THEN 'ai_assisted'::"reply_authorship"
          ELSE 'human'::"reply_authorship"
        END;
      ELSE
        NEW."ai_generated" := NEW."authorship" = 'ai_assisted';
      END IF;
      IF NEW."state_revision" <> 1 THEN
        RAISE EXCEPTION 'new Reply state revision must be 1';
      END IF;
      PERFORM "advance_review_reply_state_revision_v1"(
        NEW."review_id",
        NEW."organization_id"
      );
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."review_id" IS DISTINCT FROM OLD."review_id"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."source" IS DISTINCT FROM OLD."source"
  THEN
    RAISE EXCEPTION 'Reply ownership and source are immutable';
  END IF;

  IF NEW."source" = 'google_sync' THEN
    IF NEW."authorship" IS NOT NULL OR NEW."ai_generated" THEN
      RAISE EXCEPTION 'Google reply mirrors cannot claim authorship';
    END IF;
    NEW."authorship" := NULL;
    NEW."ai_generated" := false;
  ELSE
    authorship_changed := NEW."authorship" IS DISTINCT FROM OLD."authorship";
    legacy_changed := NEW."ai_generated" IS DISTINCT FROM OLD."ai_generated";

    IF authorship_changed AND legacy_changed THEN
      IF NEW."authorship" IS NULL
        OR NEW."ai_generated" IS DISTINCT FROM
          (NEW."authorship" = 'ai_assisted')
      THEN
        RAISE EXCEPTION 'contradictory Reply authorship fields';
      END IF;
    ELSIF authorship_changed THEN
      IF NEW."authorship" IS NULL THEN
        RAISE EXCEPTION 'internal Reply authorship is required';
      END IF;
      NEW."ai_generated" := NEW."authorship" = 'ai_assisted';
    ELSIF legacy_changed THEN
      NEW."authorship" := CASE
        WHEN NEW."ai_generated" THEN 'ai_assisted'::"reply_authorship"
        ELSE 'human'::"reply_authorship"
      END;
    END IF;

    IF NEW."authorship" IS NULL THEN
      RAISE EXCEPTION 'internal Reply authorship is required';
    END IF;
  END IF;

  IF NEW."authorship" IS DISTINCT FROM 'ai_assisted'::"reply_authorship" THEN
    NEW."origin_operation_id" := NULL;
    NEW."origin_source_epoch" := NULL;
    NEW."origin_source_revision" := NULL;
    NEW."origin_base_reply_state_revision" := NULL;
    NEW."origin_reply_drafting_epoch" := NULL;
    NEW."origin_property_profile_version" := NULL;
    NEW."origin_ai_profile_version" := NULL;
    NEW."origin_reply_template_id" := NULL;
    NEW."origin_reply_template_catalogue_version" := NULL;
    NEW."origin_reply_template_catalogue_digest" := NULL;
    NEW."origin_concrete_language_tag" := NULL;
    NEW."origin_template_group" := NULL;
    NEW."ai_draft_expires_at" := NULL;
  END IF;

  material_change := NEW."source" = 'internal' AND (
    NEW."text" IS DISTINCT FROM OLD."text"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."authorship" IS DISTINCT FROM OLD."authorship"
    OR NEW."origin_operation_id" IS DISTINCT FROM OLD."origin_operation_id"
    OR NEW."origin_source_epoch" IS DISTINCT FROM OLD."origin_source_epoch"
    OR NEW."origin_source_revision" IS DISTINCT FROM OLD."origin_source_revision"
    OR NEW."origin_base_reply_state_revision" IS DISTINCT FROM OLD."origin_base_reply_state_revision"
    OR NEW."origin_reply_drafting_epoch" IS DISTINCT FROM OLD."origin_reply_drafting_epoch"
    OR NEW."origin_property_profile_version" IS DISTINCT FROM OLD."origin_property_profile_version"
    OR NEW."origin_ai_profile_version" IS DISTINCT FROM OLD."origin_ai_profile_version"
    OR NEW."origin_reply_template_id" IS DISTINCT FROM OLD."origin_reply_template_id"
    OR NEW."origin_reply_template_catalogue_version" IS DISTINCT FROM OLD."origin_reply_template_catalogue_version"
    OR NEW."origin_reply_template_catalogue_digest" IS DISTINCT FROM OLD."origin_reply_template_catalogue_digest"
    OR NEW."origin_concrete_language_tag" IS DISTINCT FROM OLD."origin_concrete_language_tag"
    OR NEW."origin_template_group" IS DISTINCT FROM OLD."origin_template_group"
    OR NEW."ai_draft_expires_at" IS DISTINCT FROM OLD."ai_draft_expires_at"
  );

  IF material_change THEN
    IF NEW."state_revision" = OLD."state_revision" THEN
      NEW."state_revision" := OLD."state_revision" + 1;
    ELSIF NEW."state_revision" <> OLD."state_revision" + 1 THEN
      RAISE EXCEPTION 'invalid Reply state revision transition';
    END IF;
    PERFORM "advance_review_reply_state_revision_v1"(
      NEW."review_id",
      NEW."organization_id"
    );
  ELSIF NEW."state_revision" IS DISTINCT FROM OLD."state_revision" THEN
    RAISE EXCEPTION 'Reply state revision changed without a material transition';
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.initialize_review_provider_subject_hmac_key_v1(p_key_version text, p_key_digest text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  LOCK TABLE public."review_provider_subject_hmac_key_versions"
    IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."review_provider_subject_hmac_key_versions") THEN
    RAISE EXCEPTION 'review_provider_subject_key_inventory_not_empty'
      USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public."review_provider_subject_hmac_key_versions" (
    "key_version", "key_digest", "state", "generation", "activated_at"
  )
  VALUES (p_key_version, p_key_digest, 'active', 1, transaction_timestamp());
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.invalidate_ai_reply_adoption_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  origin_operation_id_value uuid;
  invalidated boolean;
BEGIN
  origin_operation_id_value := OLD."origin_operation_id";
  IF origin_operation_id_value IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  invalidated := TG_OP = 'DELETE';
  IF TG_OP = 'UPDATE' THEN
    invalidated :=
      NEW."text" IS DISTINCT FROM OLD."text"
      OR NEW."authorship" IS DISTINCT FROM OLD."authorship"
      OR NEW."origin_operation_id" IS DISTINCT FROM OLD."origin_operation_id"
      OR NEW."origin_source_epoch" IS DISTINCT FROM OLD."origin_source_epoch"
      OR NEW."origin_source_revision" IS DISTINCT FROM OLD."origin_source_revision"
      OR NEW."origin_base_reply_state_revision" IS DISTINCT FROM OLD."origin_base_reply_state_revision"
      OR NEW."origin_reply_drafting_epoch" IS DISTINCT FROM OLD."origin_reply_drafting_epoch"
      OR NEW."origin_property_profile_version" IS DISTINCT FROM OLD."origin_property_profile_version"
      OR NEW."origin_ai_profile_version" IS DISTINCT FROM OLD."origin_ai_profile_version"
      OR NEW."origin_reply_template_id" IS DISTINCT FROM OLD."origin_reply_template_id"
      OR NEW."origin_reply_template_catalogue_version" IS DISTINCT FROM OLD."origin_reply_template_catalogue_version"
      OR NEW."origin_reply_template_catalogue_digest" IS DISTINCT FROM OLD."origin_reply_template_catalogue_digest"
      OR NEW."origin_concrete_language_tag" IS DISTINCT FROM OLD."origin_concrete_language_tag"
      OR NEW."origin_template_group" IS DISTINCT FROM OLD."origin_template_group"
      OR NEW."ai_draft_expires_at" IS DISTINCT FROM OLD."ai_draft_expires_at";
  END IF;

  IF invalidated THEN
    UPDATE "ai_operations"
    SET
      "reply_adoption_disposition" = 'invalidated',
      "updated_at" = transaction_timestamp()
    WHERE "id" = origin_operation_id_value
      AND "command" = 'reply'
      AND "reply_adoption_disposition" = 'adopted';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.is_current_portal_ai_reply_brand_profile_v1(organization_id_value text, property_id_value uuid, profile_version_value integer, display_name_digest_value text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  profile_row record;
BEGIN
  IF profile_version_value < 1
    OR display_name_digest_value !~ '^[0-9a-f]{64}$'
  THEN
    RETURN false;
  END IF;

  SELECT
    profile."version",
    profile."display_name"
  INTO profile_row
  FROM public."property_portal_brand_profiles" AS profile
  WHERE profile."organization_id" = organization_id_value
    AND profile."property_id" = property_id_value
  FOR SHARE;

  RETURN FOUND
    AND profile_row."version" = profile_version_value
    AND encode(
      sha256(
        convert_to('repkey-ai-reply-brand-display-name-v1', 'UTF8')
        || decode('00', 'hex')
        || convert_to(profile_row."display_name", 'UTF8')
      ),
      'hex'
    ) = display_name_digest_value;
END;
$function$
;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.lock_review_ai_analysis_head_v1(p_organization_id text, p_property_id uuid, p_source_epoch integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  property_epoch integer;
  next_sequence bigint;
BEGIN
  SELECT "source_epoch" INTO property_epoch
  FROM public."properties"
  WHERE "organization_id" = p_organization_id
    AND "id" = p_property_id
  FOR UPDATE;

  IF property_epoch IS NULL OR property_epoch <> p_source_epoch THEN
    RAISE EXCEPTION 'review_source_epoch_changed' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."review_ai_analysis_heads" (
    "organization_id", "property_id", "source_epoch", "head_sequence"
  )
  VALUES (p_organization_id, p_property_id, p_source_epoch, 0)
  ON CONFLICT DO NOTHING;

  UPDATE public."review_ai_analysis_heads"
  SET "head_sequence" = "head_sequence" + 1,
      "updated_at" = transaction_timestamp()
  WHERE "organization_id" = p_organization_id
    AND "property_id" = p_property_id
    AND "source_epoch" = p_source_epoch
    AND "head_sequence" < 9007199254740991
  RETURNING "head_sequence" INTO next_sequence;

  IF next_sequence IS NULL THEN
    RAISE EXCEPTION 'review_analysis_sequence_unavailable' USING ERRCODE = '22003';
  END IF;
  RETURN next_sequence;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalize_notification_source_content_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_is_portal boolean;
  v_legacy_rating jsonb;
  v_guest_rating_valid boolean;
BEGIN
  NEW.payload := COALESCE(NEW.payload, '{}'::jsonb);
  v_is_portal := COALESCE(NEW.payload->>'platform' = 'portal', false);

  IF NEW.payload ? 'rating' THEN
    v_legacy_rating := NEW.payload->'rating';
    NEW.payload := NEW.payload - 'rating';
    IF v_is_portal
      AND jsonb_typeof(v_legacy_rating) = 'number'
      AND v_legacy_rating#>>'{}' IN ('1', '2', '3', '4', '5')
    THEN
      NEW.payload := jsonb_set(
        NEW.payload,
        '{guestRating}',
        v_legacy_rating,
        true
      );
    ELSE
      NEW.title := regexp_replace(
        NEW.title,
        '[1-5]-star[[:space:]]+',
        '',
        'g'
      );
      NEW.body := regexp_replace(
        NEW.body,
        '[1-5]-star[[:space:]]+',
        '',
        'g'
      );
      IF NEW.type = 'review.created' THEN
        NEW.body := 'Open it to read the review and reply.';
      END IF;
    END IF;
  END IF;

  v_guest_rating_valid :=
    v_is_portal
    AND NEW.payload ? 'guestRating'
    AND jsonb_typeof(NEW.payload->'guestRating') = 'number'
    AND NEW.payload->>'guestRating' IN ('1', '2', '3', '4', '5');
  IF NEW.payload ? 'guestRating' AND NOT v_guest_rating_valid THEN
    NEW.payload := NEW.payload - 'guestRating';
    NEW.title := regexp_replace(
      NEW.title,
      '[1-5]-star[[:space:]]+',
      '',
      'g'
    );
    NEW.body := regexp_replace(
      NEW.body,
      '[1-5]-star[[:space:]]+',
      '',
      'g'
    );
    IF NEW.type = 'review.created' THEN
      NEW.body := 'Open it to read the review and reply.';
    END IF;
  END IF;

  RETURN NEW;
END
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.protect_review_reply_state_revision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."reply_state_revision" IS DISTINCT FROM OLD."reply_state_revision"
    AND (
      pg_trigger_depth() < 2
      OR NEW."reply_state_revision" <> OLD."reply_state_revision" + 1
    )
  THEN
    RAISE EXCEPTION 'review reply state revision is trigger-owned';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.provision_organization_lifecycle_authority_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO "organization_lifecycle_authority" (
    "organization_id", "state", "revision", "reactivation_required",
    "last_transition_at", "last_actor_id", "last_reason_code",
    "last_support_evidence_ref"
  ) VALUES (
    NEW."id", 'active', 0, false, NEW."createdAt", 'system:organization',
    'provisioned', 'organization:create'
  );
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_ai_execution_control_head_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI execution control heads cannot be deleted';
  END IF;
  IF NEW.scope_key <> OLD.scope_key
    OR NEW.scope_kind <> OLD.scope_kind
    OR NEW.scope_value IS DISTINCT FROM OLD.scope_value
    OR NEW.control_id <> OLD.control_id
    OR NEW.generation <> OLD.generation + 1
    OR NEW.updated_at < OLD.updated_at
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_execution_control_transitions AS transition
      WHERE transition.control_id = NEW.control_id
        AND transition.generation = NEW.generation
        AND transition.predecessor_generation = OLD.generation
        AND transition.scope_key = NEW.scope_key
        AND transition.scope_kind = NEW.scope_kind
        AND transition.scope_value IS NOT DISTINCT FROM NEW.scope_value
        AND transition.execution_state = NEW.execution_state
        AND transition.admission_state = NEW.admission_state
        AND transition.occurred_at = NEW.updated_at
    )
  THEN
    RAISE EXCEPTION 'Invalid AI execution control head transition';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_backup_erasure_ledger_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_canonical_goal_append_only_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'goal_program_versions' AND TG_OP = 'UPDATE' THEN
    IF OLD."effective_to" IS NULL
      AND NEW."effective_to" IS NOT NULL
      AND NEW."effective_to" >= OLD."effective_from"
      AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to')
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_organization_lifecycle_event_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'organization_lifecycle_events is append-only';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_identity_lifecycle_evidence_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = TG_TABLE_NAME || ' is append-only';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_inbox_assignment_history_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_trigger_depth() > 1
     AND NOT EXISTS (
       SELECT 1 FROM public.inbox_items WHERE id = OLD.inbox_item_id
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'inbox assignment history is immutable';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_inbox_escalation_history_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_trigger_depth() > 1
     AND NOT EXISTS (
       SELECT 1 FROM public.inbox_items WHERE id = OLD.inbox_item_id
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'inbox escalation history is immutable';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_inbox_feedback_handling_outcome_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_trigger_depth() > 1
     AND NOT EXISTS (
       SELECT 1 FROM public.inbox_items WHERE id = OLD.inbox_item_id
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'private-feedback handling outcome history is immutable';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_inbox_handling_cycle_update_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'inbox Handling Cycle opening facts are immutable';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_inbox_response_target_truncate_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target history cannot be truncated';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_privacy_request_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be truncated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be deleted';
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.subject_ref <> OLD.subject_ref
     OR NEW.subject_type <> OLD.subject_type
     OR NEW.request_kind <> OLD.request_kind
     OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'privacy request subject binding is immutable';
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.state
    WHEN 'received' THEN NEW.state IN ('verified', 'refused')
    WHEN 'verified' THEN NEW.state IN ('in_progress', 'refused')
    WHEN 'in_progress' THEN NEW.state IN ('fulfilled', 'refused')
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'invalid privacy request transition ' || OLD.state || ' -> ' || NEW.state;
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_property_erase_authority_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be truncated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = TG_TABLE_NAME || ' evidence cannot be deleted';
  END IF;


  IF NEW.id <> OLD.id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.requested_by_user_id <> OLD.requested_by_user_id
     OR NEW.support_authorization_ref <> OLD.support_authorization_ref
     OR NEW.identity_verification_ref <> OLD.identity_verification_ref
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'property erase authorization binding is immutable';
  END IF;

  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  -- Cancellation is impossible once the purge has started. This is the whole
  -- point of the boundary.
  IF OLD.state IN ('purging', 'purged') AND NEW.state = 'cancelled' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'property erase is irreversible once purging has begun';
  END IF;

  allowed := CASE OLD.state
    WHEN 'requested' THEN NEW.state IN ('previewed', 'cancelled')
    WHEN 'previewed' THEN NEW.state IN ('previewed', 'confirmed', 'cancelled')
    WHEN 'confirmed' THEN NEW.state IN ('purge_pending', 'cancelled')
    WHEN 'purge_pending' THEN NEW.state IN ('purging', 'cancelled')
    WHEN 'purging' THEN NEW.state = 'purged'
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'invalid property erase transition ' || OLD.state || ' -> ' || NEW.state;
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_reply_publication_authorization_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'reply publication authorizations are immutable';
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.remove_review_provider_subject_hmac_key_v1(p_expected_retiring_version text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  retiring_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
BEGIN
  SELECT * INTO retiring_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_retiring_version
  FOR UPDATE;

  IF retiring_row."key_version" IS NULL OR retiring_row."state" <> 'retiring' THEN
    RAISE EXCEPTION 'review_provider_subject_retiring_key_mismatch'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."review_provider_subjects"
    WHERE "key_version" = p_expected_retiring_version
  ) THEN
    RAISE EXCEPTION 'review_provider_subject_key_still_referenced'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_retiring_version;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.retire_guest_contact_on_response_terminal_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  retired_at timestamp with time zone := COALESCE(
    NEW."feedback_withdrawn_at",
    NEW."deleted_at",
    NEW."updated_at",
    CURRENT_TIMESTAMP
  );
BEGIN
  IF NEW."status" = 'expired' THEN
    UPDATE "guest_contact_requests"
    SET "status" = 'expired',
        "consent_granted" = false,
        "encrypted_contact" = NULL,
        "withdrawn_at" = NULL,
        "purged_at" = retired_at,
        "updated_at" = retired_at
    WHERE "organization_id" = NEW."organization_id"
      AND "property_id" = NEW."property_id"
      AND "portal_id" = NEW."portal_id"
      AND "response_id" = NEW."id"
      AND "status" = 'active';
  ELSIF NEW."status" = 'deleted'
    OR NEW."deleted_at" IS NOT NULL
    OR (
      OLD."feedback_withdrawn_at" IS NULL
      AND NEW."feedback_withdrawn_at" IS NOT NULL
    ) THEN
    UPDATE "guest_contact_requests"
    SET "status" = 'withdrawn',
        "consent_granted" = false,
        "encrypted_contact" = NULL,
        "withdrawn_at" = retired_at,
        "purged_at" = NULL,
        "updated_at" = retired_at
    WHERE "organization_id" = NEW."organization_id"
      AND "property_id" = NEW."property_id"
      AND "portal_id" = NEW."portal_id"
      AND "response_id" = NEW."id"
      AND "status" = 'active';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rotate_review_provider_subject_hmac_key_v1(p_expected_active_version text, p_expected_trusted_next_version text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  active_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
  next_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
  captured_at timestamptz := transaction_timestamp();
BEGIN
  PERFORM 1
  FROM public."review_provider_subject_hmac_key_versions"
  ORDER BY "generation", "key_version"
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public."review_provider_subject_hmac_key_versions"
    WHERE "state" = 'retiring'
  ) THEN
    RAISE EXCEPTION 'review_provider_subject_rotation_in_progress' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO active_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_active_version AND "state" = 'active';
  SELECT * INTO next_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_trusted_next_version AND "state" = 'trusted_next';

  IF active_row."key_version" IS NULL OR next_row."key_version" IS NULL
    OR next_row."generation" <> active_row."generation" + 1
    OR (SELECT count(*) FROM public."review_provider_subject_hmac_key_versions") <> 2
  THEN
    RAISE EXCEPTION 'review_provider_subject_rotation_mismatch' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public."review_provider_subject_hmac_key_versions"
  SET "state" = 'retiring', "retiring_at" = captured_at
  WHERE "key_version" = p_expected_active_version;
  UPDATE public."review_provider_subject_hmac_key_versions"
  SET "state" = 'active', "activated_at" = captured_at
  WHERE "key_version" = p_expected_trusted_next_version;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v1(p_permit_id uuid, p_route_key text, p_route_catalog_version text, p_quota_policy_id text, p_authorization_vector jsonb, p_release_sha text)
 RETURNS TABLE(outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation_deadline_at timestamptz := v_now + interval '30 seconds';
BEGIN
  RETURN QUERY
  WITH candidate AS MATERIALIZED (
    SELECT permit.*,
      CASE
        WHEN permit.state <> 'admitted' THEN 'changed'
        WHEN permit.start_deadline_at <= v_now THEN 'expired'
        WHEN (
          permit.route_key <> 'oauth.revoke'
          AND EXISTS (
          SELECT 1
          FROM public.google_connections AS connection
          LEFT JOIN public.member AS member
            ON member."organizationId" = permit.organization_id
           AND member."userId" = permit.initiator_user_id
          LEFT JOIN public.permission_version AS permission
            ON permission.organization_id = permit.organization_id
          WHERE connection.id = permit.connection_id
            AND connection.organization_id = permit.organization_id
            AND (
              (
                permit.capability::text = 'property.import_gbp_v2'
                AND permit.initiator_user_id IS NOT NULL
                AND member.role = 'owner'
                AND permit.authorization_vector->>'principalKind' = 'user'
                AND permit.authorization_vector->>'role' = 'AccountAdmin'
                AND jsonb_typeof(
                  permit.authorization_vector->'permissionVersion'
                ) = 'number'
                AND permit.authorization_vector->>'permissionVersion' ~
                  '^(0|[1-9][0-9]*)$'
                AND permission.version::text =
                  permit.authorization_vector->>'permissionVersion'
              )
              OR (
                permit.capability::text = 'property.read_gbp_performance'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NOT NULL
                AND permit.route_key = 'performance.fetch'
                AND permit.authorization_vector->>'principalKind' = 'user'
                AND (
                  (member.role = 'owner'
                    AND permit.authorization_vector->>'role' = 'AccountAdmin')
                  OR (member.role = 'admin'
                    AND permit.authorization_vector->>'role' = 'PropertyManager')
                )
                AND jsonb_typeof(
                  permit.authorization_vector->'permissionVersion'
                ) = 'number'
                AND permit.authorization_vector->>'permissionVersion' ~
                  '^(0|[1-9][0-9]*)$'
                AND permission.version::text =
                  permit.authorization_vector->>'permissionVersion'
              )
              OR (
                permit.capability::text = 'property.connect_gbp'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NULL
                AND permit.route_key IN ('reviews.list', 'reviews.get')
                AND permit.authorization_vector->>'principalKind' = 'system'
                AND permit.authorization_vector->>'systemPrincipal' =
                  'review-sync-worker-v1'
                AND permit.authorization_vector->>'role' = 'System'
                AND permit.authorization_vector->'permissionVersion' = 'null'::jsonb
                AND permit.authorization_vector->>'permissionDigest' =
                  '65da4b7ff2904448056791e99cea6bcf83adee8507a501d9b22d042d41373899'
              )
              OR (
                permit.capability::text = 'property.publish_reply'
                AND permit.property_id IS NOT NULL
                AND permit.initiator_user_id IS NULL
                AND permit.route_key = 'reviews.reply'
                AND permit.authorization_vector->>'principalKind' = 'system'
                AND permit.authorization_vector->>'systemPrincipal' =
                  'reply-publication-worker-v1'
                AND permit.authorization_vector->>'role' = 'System'
                AND permit.authorization_vector->'permissionVersion' = 'null'::jsonb
                AND permit.authorization_vector->>'permissionDigest' =
                  '78f5439a163ad5264b40a99b8d1b02d3fe433b47ea838049ae5806d10b8bbfe3'
                AND EXISTS (
                  SELECT 1
                  FROM public.reply_publication_attempts AS publication_attempt
                  INNER JOIN public.reply_publication_authorizations AS publication_authorization
                    ON publication_authorization.organization_id =
                      publication_attempt.organization_id
                   AND publication_authorization.property_id =
                      publication_attempt.property_id
                   AND publication_authorization.review_id =
                      publication_attempt.review_id
                   AND publication_authorization.reply_id =
                      publication_attempt.reply_id
                   AND publication_authorization.publication_cycle =
                      publication_attempt.publication_cycle
                   AND publication_authorization.source_epoch =
                      publication_attempt.source_epoch
                   AND publication_authorization.material_review_revision =
                      publication_attempt.material_review_revision
                   AND publication_authorization.reply_state_revision =
                      publication_attempt.reply_state_revision
                   AND publication_authorization.normalization_version =
                      publication_attempt.normalization_version
                   AND publication_authorization.expected_reply_digest =
                      publication_attempt.expected_reply_digest
                  INNER JOIN public.replies AS publication_reply
                    ON publication_reply.organization_id =
                      publication_attempt.organization_id
                   AND publication_reply.review_id = publication_attempt.review_id
                   AND publication_reply.id = publication_attempt.reply_id
                  INNER JOIN public.reviews AS publication_review
                    ON publication_review.organization_id =
                      publication_attempt.organization_id
                   AND publication_review.property_id =
                      publication_attempt.property_id
                   AND publication_review.id = publication_attempt.review_id
                  INNER JOIN public.member AS confirming_member
                    ON confirming_member."organizationId" =
                      publication_authorization.organization_id
                   AND confirming_member."userId" =
                      publication_authorization.authorized_by_user_id
                  INNER JOIN public.permission_version AS confirming_permission
                    ON confirming_permission.organization_id =
                      publication_authorization.organization_id
                  WHERE publication_attempt.organization_id = permit.organization_id
                    AND publication_attempt.property_id = permit.property_id
                    AND publication_review.google_connection_id = permit.connection_id
                    AND publication_attempt.outcome = 'sending'
                    AND publication_reply.status = 'approved'
                    AND publication_reply.publication_state = 'sending'
                    AND publication_reply.publication_cycle =
                      publication_attempt.publication_cycle
                    AND publication_reply.publication_attempts =
                      publication_attempt.attempt_number
                    AND publication_review.source_content_state = 'active'
                    AND publication_review.source_epoch =
                      publication_attempt.source_epoch
                    AND publication_review.source_revision =
                      publication_attempt.material_review_revision
                    AND permit.authorization_vector->>'reviewId' =
                      publication_attempt.review_id::text
                    AND permit.authorization_vector->>'replyId' =
                      publication_attempt.reply_id::text
                    AND permit.authorization_vector->>'publicationCycle' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.publication_cycle::text =
                      permit.authorization_vector->>'publicationCycle'
                    AND permit.authorization_vector->>'publicationAttemptNumber' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.attempt_number::text =
                      permit.authorization_vector->>'publicationAttemptNumber'
                    AND permit.authorization_vector->>'materialReviewRevision' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.material_review_revision::text =
                      permit.authorization_vector->>'materialReviewRevision'
                    AND permit.authorization_vector->>'replyStateRevision' ~
                      '^[1-9][0-9]*$'
                    AND publication_attempt.reply_state_revision::text =
                      permit.authorization_vector->>'replyStateRevision'
                    AND permit.authorization_vector->>'baseObservationRevision' ~
                      '^(0|[1-9][0-9]*)$'
                    AND publication_attempt.base_observation_revision::text =
                      permit.authorization_vector->>'baseObservationRevision'
                    AND permit.authorization_vector->>'expectedReplyDigest' ~
                      '^[a-f0-9]{64}$'
                    AND publication_attempt.expected_reply_digest =
                      permit.authorization_vector->>'expectedReplyDigest'
                    AND permit.authorization_vector->>'confirmingActorUserId' =
                      publication_authorization.authorized_by_user_id
                    AND permit.authorization_vector->>'confirmingActorRole' = CASE
                      WHEN confirming_member.role = 'owner' THEN 'AccountAdmin'
                      WHEN confirming_member.role = 'admin' THEN 'PropertyManager'
                      ELSE ''
                    END
                    AND permit.authorization_vector->>'confirmingActorPermissionVersion' ~
                      '^(0|[1-9][0-9]*)$'
                    AND confirming_permission.version::text =
                      permit.authorization_vector->>'confirmingActorPermissionVersion'
                    AND (
                      confirming_member.role = 'owner'
                      OR (
                        confirming_member.role = 'admin'
                        AND EXISTS (
                          SELECT 1
                          FROM public.property_access_grant AS confirming_grant
                          WHERE confirming_grant.organization_id = permit.organization_id
                            AND confirming_grant.property_id = permit.property_id
                            AND confirming_grant.user_id =
                              publication_authorization.authorized_by_user_id
                            AND confirming_grant.revoked_at IS NULL
                            AND (
                              confirming_grant.expires_at IS NULL
                              OR confirming_grant.expires_at > v_now
                            )
                        )
                      )
                    )
                )
              )
            )
            AND permit.authorization_vector->>'permissionDigest' ~ '^[a-f0-9]{64}$'
            AND connection.status = 'active'
            AND connection.credential_use_state = 'active'
            AND permit.authorization_vector->>'connectionLifecycleVersion' ~
              '^[1-9][0-9]*$'
            AND connection.lifecycle_version::text =
              permit.authorization_vector->>'connectionLifecycleVersion'
            AND permit.authorization_vector->>'connectionAccessVersion' ~
              '^[1-9][0-9]*$'
            AND connection.access_version::text =
              permit.authorization_vector->>'connectionAccessVersion'
            AND permit.authorization_vector->>'credentialGeneration' ~
              '^[1-9][0-9]*$'
            AND connection.credential_generation::text =
              permit.authorization_vector->>'credentialGeneration'
            AND (
              permit.property_id IS NULL
              OR (
                (
                  member.role = 'owner'
                  OR permit.capability::text = 'property.connect_gbp'
                  OR permit.capability::text = 'property.publish_reply'
                  OR EXISTS (
                    SELECT 1
                    FROM public.property_access_grant AS access_grant
                    WHERE access_grant.organization_id = permit.organization_id
                      AND access_grant.property_id = permit.property_id
                      AND access_grant.user_id = permit.initiator_user_id
                      AND access_grant.revoked_at IS NULL
                      AND (
                        access_grant.expires_at IS NULL
                        OR access_grant.expires_at > v_now
                      )
                  )
                )
                AND EXISTS (
                  SELECT 1
                  FROM public.properties AS property
                  WHERE property.id = permit.property_id
                    AND property.organization_id = permit.organization_id
                    AND property.google_connection_id = permit.connection_id
                    AND property.gbp_location_id IS NOT NULL
                    AND property.deleted_at IS NULL
                    AND property.lifecycle_state = 'active'
                    AND property.google_binding_state = 'active'
                    AND permit.authorization_vector->>'propertySourceEpoch' ~
                      '^(0|[1-9][0-9]*)$'
                    AND property.source_epoch::text =
                      permit.authorization_vector->>'propertySourceEpoch'
                    AND permit.authorization_vector->>'propertyProfileVersion' ~
                      '^[1-9][0-9]*$'
                    AND property.profile_version::text =
                      permit.authorization_vector->>'propertyProfileVersion'
                    AND property.google_binding_state =
                      permit.authorization_vector->>'propertyBindingState'
                    AND property.lifecycle_state =
                      permit.authorization_vector->>'propertyLifecycleState'
                    AND property.profile_source =
                      permit.authorization_vector->>'propertyProfileSource'
                    AND (property.profile_confirmed_at IS NOT NULL)::text =
                      permit.authorization_vector->>'propertyTimezoneConfirmed'
                    AND (
                      permit.capability::text <> 'property.read_gbp_performance'
                      OR (
                        property.profile_source = 'tenant_confirmed'
                        AND property.profile_confirmed_at IS NOT NULL
                      )
                    )
                )
              )
            )
          )
        ) OR (
          -- Cleanup remains an already-authorized drain after ordinary work is
          -- killed, membership changes, or a credential enters cleanup_only.
          permit.route_key = 'oauth.revoke'
          AND permit.property_id IS NULL
          AND EXISTS (
            SELECT 1
            -- WP2.2: approval ceremony removed; see start_…_v1. The revoke
            -- state machine below is the whole point of this branch — a
            -- credential revocation may only be dispatched from a permit that
            -- names a live, dispatching, not-yet-terminal revoke record.
            FROM public.credential_revoke_permits AS revoke
            INNER JOIN public.google_credential_source_operations AS source
              ON source.id = revoke.source_operation_id
             AND source.guard_id = revoke.guard_id
            INNER JOIN public.google_subject_authority_guards AS guard
              ON guard.id = revoke.guard_id
            WHERE revoke.cleanup_work_permit_id = permit.id
              AND revoke.state = 'dispatching'
              AND revoke.cleanup_deadline_at > v_now
              AND revoke.activated_at IS NOT NULL
              AND revoke.dispatching_at IS NOT NULL
              AND revoke.terminal_at IS NULL
              AND revoke.token_hmac IS NULL
              AND revoke.token_hmac_key_version IS NULL
              AND revoke.send_authorization_expires_at IS NULL
              AND permit.admitted_at <= revoke.dispatching_at
              AND source.organization_id = permit.organization_id
              AND source.connection_id IS NOT DISTINCT FROM permit.connection_id
              AND source.source_work_permit_id <> permit.id
              AND source.state = 'terminal'
              AND source.provider_started_at IS NOT NULL
              AND source.terminal_at IS NOT NULL
              AND source.terminal_at <= revoke.dispatching_at
              AND guard.state = 'cleanup_pending'
              AND guard.active_source_operation_id IS NULL
              AND guard.source_cutoff_sequence = source.sequence
              AND guard.cleanup_deadline_at = revoke.cleanup_deadline_at
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
      AND candidate.route_key = p_route_key
      AND candidate.route_catalog_version = p_route_catalog_version
      AND candidate.quota_policy_id = p_quota_policy_id
      AND jsonb_typeof(p_authorization_vector) = 'object'
      AND (
        SELECT count(*) FROM jsonb_object_keys(p_authorization_vector)
      ) = 5
      AND p_authorization_vector ?& ARRAY[
        'requestBindingSha256',
        'credentialBinding',
        'projectFingerprint',
        'requestBodySha256',
        'requestBodyBytes'
      ]::text[]
      AND p_authorization_vector->>'requestBindingSha256' ~ '^[a-f0-9]{64}$'
      AND (
        p_authorization_vector->>'credentialBinding' = 'none'
        OR p_authorization_vector->>'credentialBinding' ~ '^[a-f0-9]{64}$'
      )
      AND p_authorization_vector->>'projectFingerprint' ~ '^[a-f0-9]{64}$'
      AND (
        p_authorization_vector->'requestBodySha256' = 'null'::jsonb
        OR p_authorization_vector->>'requestBodySha256' ~ '^[a-f0-9]{64}$'
      )
      AND jsonb_typeof(p_authorization_vector->'requestBodyBytes') = 'number'
      AND p_authorization_vector->>'requestBodyBytes' ~ '^(0|[1-9][0-9]*)$'
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v2(p_permit_id uuid, p_route_key text, p_route_catalog_version text, p_quota_policy_id text, p_authorization_vector jsonb, p_release_sha text)
 RETURNS TABLE(outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation_deadline_at timestamptz := v_now + interval '30 seconds';
BEGIN
  -- Preserve the established authority for every non-exchange route. The new
  -- branch is intentionally exact rather than a broader relaxation of v1.
  IF p_route_key <> 'oauth.token.exchange' THEN
    RETURN QUERY
    SELECT legacy.outcome
    FROM public.start_google_execution_permit_v1(
      p_permit_id,
      p_route_key,
      p_route_catalog_version,
      p_quota_policy_id,
      p_authorization_vector,
      p_release_sha
    ) AS legacy;
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
          AND permit.operation_key = 'provider.oauth.token.exchange'
          AND permit.route_key = 'oauth.token.exchange'
          AND EXISTS (
            SELECT 1
            -- WP2.2: approval ceremony removed; see start_…_v1. The member and
            -- permission joins stay — an OAuth exchange is only admissible when
            -- initiated by a member whose permission version matches.
            FROM public.member AS member
            INNER JOIN public.permission_version AS permission
              ON permission.organization_id = permit.organization_id
            LEFT JOIN public.google_connections AS connection
              ON connection.organization_id = permit.organization_id
             AND connection.id = permit.connection_id
            WHERE member."organizationId" = permit.organization_id
              AND member."userId" = permit.initiator_user_id
              AND member.role = 'owner'
              AND permit.authorization_vector->>'principalKind' = 'user'
              AND permit.authorization_vector->>'role' = 'AccountAdmin'
              AND permit.authorization_vector->>'permissionDigest' ~ '^[a-f0-9]{64}$'
              AND jsonb_typeof(
                permit.authorization_vector->'permissionVersion'
              ) = 'number'
              AND permit.authorization_vector->>'permissionVersion' ~
                '^(0|[1-9][0-9]*)$'
              AND permission.version::text =
                permit.authorization_vector->>'permissionVersion'
              AND (
                (
                  permit.authorization_vector->>'oauthCredentialOperation' =
                    'exchange_new'
                  AND connection.id IS NULL
                  AND permit.authorization_vector->'connectionLifecycleVersion' =
                    '0'::jsonb
                  AND permit.authorization_vector->'connectionAccessVersion' =
                    '0'::jsonb
                  AND permit.authorization_vector->'credentialGeneration' =
                    '0'::jsonb
                )
                OR (
                  permit.authorization_vector->>'oauthCredentialOperation' =
                    'exchange_existing'
                  AND connection.id IS NOT NULL
                  AND connection.status::text IN (
                    'active', 'degraded', 'reauth_required', 'disconnected'
                  )
                  AND connection.credential_use_state::text IN ('active', 'none')
                  AND connection.status::text =
                    permit.authorization_vector->>'connectionStatus'
                  AND connection.credential_use_state::text =
                    permit.authorization_vector->>'credentialUseState'
                  AND connection.lifecycle_version::text =
                    permit.authorization_vector->>'connectionLifecycleVersion'
                  AND connection.access_version::text =
                    permit.authorization_vector->>'connectionAccessVersion'
                  AND connection.credential_generation::text =
                    permit.authorization_vector->>'credentialGeneration'
                )
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
      AND candidate.route_key = p_route_key
      AND candidate.route_catalog_version = p_route_catalog_version
      AND candidate.quota_policy_id = p_quota_policy_id
      AND jsonb_typeof(p_authorization_vector) = 'object'
      AND (
        SELECT count(*) FROM jsonb_object_keys(p_authorization_vector)
      ) = 5
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.start_google_execution_permit_v3(p_permit_id uuid, p_route_key text, p_route_catalog_version text, p_quota_policy_id text, p_authorization_vector jsonb, p_release_sha text)
 RETURNS TABLE(outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation_deadline_at timestamptz := v_now + interval '30 seconds';
BEGIN
  IF p_route_key <> 'oauth.revoke' OR NOT EXISTS (
    SELECT 1
    FROM public.idempotency_receipts AS attempt
    WHERE attempt.scope = 'google_disconnect_revoke'
      AND attempt.payload->>'cleanupWorkPermitId' = p_permit_id::text
  ) THEN
    RETURN QUERY
    SELECT delegated.outcome
    FROM public.start_google_execution_permit_v2(
      p_permit_id,
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
            FROM public.idempotency_receipts AS attempt
            INNER JOIN public.google_connections AS connection
              ON connection.organization_id = attempt.payload->>'organizationId'
             AND connection.id::text = attempt.payload->>'connectionId'
            -- WP2.2: approval ceremony removed; see start_…_v1. Everything
            -- below is the disconnect-revoke state machine, which is exactly
            -- what this branch exists to prove.
            WHERE attempt.scope = 'google_disconnect_revoke'
              AND attempt.payload->>'cleanupWorkPermitId' = permit.id::text
              AND attempt.payload->>'organizationId' = permit.organization_id
              AND attempt.payload->>'connectionId' = permit.connection_id::text
              AND attempt.payload->>'initiatorUserId' = permit.initiator_user_id
              AND attempt.payload->>'state' = 'dispatching'
              AND (attempt.payload->>'cleanupDeadlineAt')::timestamptz > v_now
              AND attempt.payload->>'dispatchingAt' IS NOT NULL
              AND attempt.payload->>'terminalAt' IS NULL
              AND attempt.payload->>'credentialBinding' IS NULL
              AND permit.admitted_at <=
                (attempt.payload->>'dispatchingAt')::timestamptz
              AND connection.status = 'disconnecting'
              AND connection.credential_use_state = 'cleanup_only'
              AND connection.cleanup_material_deadline_at =
                (attempt.payload->>'cleanupDeadlineAt')::timestamptz
              AND connection.lifecycle_version =
                (attempt.payload->>'expectedLifecycleVersion')::bigint + 1
              AND connection.access_version =
                (attempt.payload->>'expectedAccessVersion')::bigint
              AND connection.credential_generation =
                (attempt.payload->>'expectedCredentialGeneration')::bigint
              AND permit.authorization_vector->>'connectionLifecycleVersion' =
                attempt.payload->>'expectedLifecycleVersion'
              AND permit.authorization_vector->>'connectionAccessVersion' =
                attempt.payload->>'expectedAccessVersion'
              AND permit.authorization_vector->>'credentialGeneration' =
                attempt.payload->>'expectedCredentialGeneration'
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tgr_bump_perm_app()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_permission_version(NEW.organization_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM bump_permission_version(OLD.organization_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM bump_permission_version(NEW.organization_id);
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      PERFORM bump_permission_version(OLD.organization_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.tgr_bump_perm_ba()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM bump_permission_version(NEW."organizationId");
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM bump_permission_version(OLD."organizationId");
  ELSIF TG_OP = 'UPDATE' THEN
    -- Org transfer bumps both the source and destination org.
    PERFORM bump_permission_version(NEW."organizationId");
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
      PERFORM bump_permission_version(OLD."organizationId");
    END IF;
  END IF;
  RETURN NULL;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.transition_ai_execution_control_v1(p_scope_key text, p_provider_deployment_profile_version text, p_expected_control_id uuid, p_expected_generation integer, p_execution_state text, p_admission_state text, p_reason_code text, p_actor_user_id text, p_ticket_reference text, p_candidate_release_sha text)
 RETURNS TABLE(scope_key character varying, scope_kind character varying, scope_value character varying, control_id uuid, generation integer, execution_state character varying, admission_state character varying, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_global public.ai_execution_control_heads%ROWTYPE;
  v_provider public.ai_execution_control_heads%ROWTYPE;
  v_target public.ai_execution_control_heads%ROWTYPE;
  v_replay public.ai_execution_control_transitions%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_is_capability_activation boolean;
BEGIN
  IF p_expected_control_id IS NULL
    OR p_expected_generation < 1
    OR p_execution_state NOT IN ('enabled', 'killed')
    OR p_admission_state NOT IN ('accepting', 'draining')
    OR p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
    OR p_ticket_reference IS NULL OR length(p_ticket_reference) NOT BETWEEN 1 AND 255
    OR (
      p_candidate_release_sha IS NOT NULL
      AND p_candidate_release_sha !~ '^[0-9a-f]{40}$'
    )
  THEN
    RAISE EXCEPTION 'Invalid AI execution control transition'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_global
  FROM public.ai_execution_control_heads
  WHERE ai_execution_control_heads.scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_scope_key = 'global' THEN
    v_target := v_global;
  ELSE
    IF p_provider_deployment_profile_version IS NULL
      OR p_provider_deployment_profile_version !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    THEN
      RETURN;
    END IF;
    SELECT *
    INTO v_provider
    FROM public.ai_execution_control_heads
    WHERE ai_execution_control_heads.scope_key =
      'provider:' || p_provider_deployment_profile_version
    FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    IF p_scope_key = 'provider:' || p_provider_deployment_profile_version THEN
      v_target := v_provider;
    ELSIF p_scope_key IN (
      'capability:review_analysis',
      'capability:reply_drafting',
      'capability:property_trends'
    ) THEN
      SELECT *
      INTO v_target
      FROM public.ai_execution_control_heads
      WHERE ai_execution_control_heads.scope_key = p_scope_key
      FOR UPDATE;
      IF NOT FOUND THEN RETURN; END IF;
    ELSE
      RETURN;
    END IF;
  END IF;

  IF v_target.control_id = p_expected_control_id
    AND v_target.generation = p_expected_generation + 1
  THEN
    SELECT *
    INTO v_replay
    FROM public.ai_execution_control_transitions
    WHERE ai_execution_control_transitions.control_id = v_target.control_id
      AND ai_execution_control_transitions.generation = v_target.generation;
    IF FOUND
      AND v_replay.predecessor_generation = p_expected_generation
      AND v_replay.execution_state = p_execution_state
      AND v_replay.admission_state = p_admission_state
      AND v_replay.reason_code = p_reason_code
      AND v_replay.actor_user_id IS NOT DISTINCT FROM p_actor_user_id
      AND v_replay.ticket_reference = p_ticket_reference
      AND v_replay.candidate_release_sha IS NOT DISTINCT FROM p_candidate_release_sha
    THEN
      scope_key := v_target.scope_key;
      scope_kind := v_target.scope_kind;
      scope_value := v_target.scope_value;
      control_id := v_target.control_id;
      generation := v_target.generation;
      execution_state := v_target.execution_state;
      admission_state := v_target.admission_state;
      updated_at := v_target.updated_at;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF v_target.control_id <> p_expected_control_id
    OR v_target.generation <> p_expected_generation
  THEN
    RETURN;
  END IF;

  v_is_capability_activation :=
    v_target.scope_kind = 'capability'
    AND p_execution_state = 'enabled'
    AND p_admission_state = 'accepting';
  IF v_is_capability_activation THEN
    IF p_candidate_release_sha IS NULL
      OR v_global.execution_state <> 'enabled'
      OR v_global.admission_state <> 'accepting'
      OR v_provider.execution_state <> 'enabled'
      OR v_provider.admission_state <> 'accepting'
    THEN
      RETURN;
    END IF;
  ELSIF p_candidate_release_sha IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_execution_control_transitions (
    control_id, generation, predecessor_generation,
    scope_key, scope_kind, scope_value,
    execution_state, admission_state, reason_code, actor_user_id,
    ticket_reference, candidate_release_sha, occurred_at
  ) VALUES (
    v_target.control_id, v_target.generation + 1, v_target.generation,
    v_target.scope_key, v_target.scope_kind, v_target.scope_value,
    p_execution_state, p_admission_state, p_reason_code, p_actor_user_id,
    p_ticket_reference, p_candidate_release_sha, v_now
  );
  UPDATE public.ai_execution_control_heads
  SET
    generation = v_target.generation + 1,
    execution_state = p_execution_state,
    admission_state = p_admission_state,
    updated_at = v_now
  WHERE ai_execution_control_heads.scope_key = v_target.scope_key;

  scope_key := v_target.scope_key;
  scope_kind := v_target.scope_kind;
  scope_value := v_target.scope_value;
  control_id := v_target.control_id;
  generation := v_target.generation + 1;
  execution_state := p_execution_state;
  admission_state := p_admission_state;
  updated_at := v_now;
  RETURN NEXT;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.trust_next_review_provider_subject_hmac_key_v1(p_expected_active_version text, p_trusted_next_version text, p_trusted_next_key_digest text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  active_row public."review_provider_subject_hmac_key_versions"%ROWTYPE;
BEGIN
  PERFORM 1
  FROM public."review_provider_subject_hmac_key_versions"
  ORDER BY "generation", "key_version"
  FOR UPDATE;

  SELECT * INTO active_row
  FROM public."review_provider_subject_hmac_key_versions"
  WHERE "key_version" = p_expected_active_version
    AND "state" = 'active';

  IF active_row."key_version" IS NULL
    OR (SELECT count(*) FROM public."review_provider_subject_hmac_key_versions") <> 1
    OR EXISTS (
      SELECT 1 FROM public."review_provider_subject_hmac_key_versions"
      WHERE "state" IN ('trusted_next', 'retiring')
    )
  THEN
    RAISE EXCEPTION 'review_provider_subject_trust_next_mismatch'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public."review_provider_subject_hmac_key_versions" (
    "key_version", "key_digest", "state", "generation"
  )
  VALUES (
    p_trusted_next_version,
    p_trusted_next_key_digest,
    'trusted_next',
    active_row."generation" + 1
  );
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_goal_result_revision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  result_status varchar(24);
  result_period_end timestamptz;
  prior_revision integer;
  prior_result_id uuid;
BEGIN
  SELECT "status", "period_end"
  INTO result_status, result_period_end
  FROM "goal_monthly_results"
  WHERE "organization_id" = NEW."organization_id"
    AND "property_id" = NEW."property_id"
    AND "id" = NEW."monthly_result_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal result revision target is unavailable'
      USING ERRCODE = '23503';
  END IF;
  IF result_status <> 'closed' THEN
    RAISE EXCEPTION 'only closed goal monthly results can be revised'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."source_complete_through" IS NOT NULL
    AND NEW."source_complete_through" > result_period_end
  THEN
    RAISE EXCEPTION 'goal result revision source watermark exceeds the result period'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."evaluation_state" IN ('eligible', 'insufficient_data')
    AND NEW."source_complete_through" IS DISTINCT FROM result_period_end
  THEN
    RAISE EXCEPTION 'eligible goal result revisions require exact source completeness'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" = 1 THEN
    IF NEW."supersedes_revision_id" IS NOT NULL THEN
      RAISE EXCEPTION 'first goal result revision cannot supersede another revision'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."supersedes_revision_id" IS NULL THEN
      RAISE EXCEPTION 'later goal result revisions must supersede the direct prior revision'
        USING ERRCODE = '23514';
    END IF;
    SELECT "revision", "monthly_result_id"
    INTO prior_revision, prior_result_id
    FROM "goal_result_revisions"
    WHERE "id" = NEW."supersedes_revision_id";
    IF NOT FOUND
      OR prior_result_id <> NEW."monthly_result_id"
      OR prior_revision <> NEW."revision" - 1
    THEN
      RAISE EXCEPTION 'goal result revision lineage must target the direct prior revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.validate_inbox_response_target_reminder_schedule_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  target_start timestamptz;
  target_due timestamptz;
  target_duration integer;
  target_eligibility varchar(32);
BEGIN
  SELECT start_at, due_at, duration_minutes, performance_eligibility
    INTO target_start, target_due, target_duration, target_eligibility
  FROM public.inbox_handling_cycle_response_targets
  WHERE inbox_item_id = NEW.inbox_item_id
    AND cycle_number = NEW.cycle_number
    AND organization_id = NEW.organization_id
    AND property_id = NEW.property_id
    AND target_kind = NEW.target_kind;

  IF NOT FOUND THEN
    RETURN NEW; -- The composite foreign key provides the canonical error.
  END IF;

  IF target_eligibility <> 'measured'
     OR (NEW.reminder_kind = 'halfway'
         AND NEW.scheduled_for <> target_start + make_interval(secs => target_duration * 30))
     OR (NEW.reminder_kind = 'target_passed' AND NEW.scheduled_for <> target_due) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Response Target reminder schedule does not match its snapshot';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.verify_organization_export_retrieval_issuance_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_exports AS authority
    WHERE authority.id = NEW.export_id
      AND authority.organization_id = NEW.organization_id
      AND authority.state = 'retrieval_issued'
      AND authority.revision = NEW.export_revision
      AND authority.retrieval_operation_id = NEW.operation_id
      AND authority.retrieval_token_digest = NEW.token_digest
      AND authority.retrieval_issued_at = NEW.issued_at
      AND authority.retrieval_expires_at = NEW.expires_at
  ) THEN
    RAISE EXCEPTION 'organization export retrieval issuance was not co-committed';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.google_execution_permit_revision_v1(p_permit authorization_execution_permits)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    p_permit.id,
    p_permit.route_key,
    p_permit.capability,
    p_permit.scope_schema_version,
    p_permit.organization_id,
    p_permit.property_id,
    p_permit.connection_id,
    p_permit.initiator_user_id,
    p_permit.operation_key,
    p_permit.route_catalog_version,
    p_permit.quota_policy_id,
    p_permit.authorization_vector,
    p_permit.admitted_at,
    p_permit.start_deadline_at
  )::text, 'UTF8')), 'hex')
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.load_google_execution_permit_v1(p_permit_id uuid)
 RETURNS TABLE(id uuid, capability text, route_key text, route_catalog_version text, quota_policy_id text, authorization_vector jsonb, state text, start_deadline_at timestamp with time zone, organization_id text, property_id uuid, connection_id uuid, initiator_user_id text, authority_revision text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    permit.id,
    permit.capability::text,
    permit.route_key::text,
    permit.route_catalog_version::text,
    permit.quota_policy_id::text,
    permit.authorization_vector,
    permit.state::text,
    permit.start_deadline_at,
    permit.organization_id::text,
    permit.property_id,
    permit.connection_id,
    permit.initiator_user_id::text,
    public.google_execution_permit_revision_v1(permit)
  FROM public.authorization_execution_permits AS permit
  WHERE permit.id = p_permit_id
  LIMIT 1
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.review_provider_subject_hmac_key_inventory_v1()
 RETURNS TABLE(key_version text, key_digest text, state text, generation bigint, reference_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    k."key_version"::text,
    k."key_digest"::text,
    k."state"::text,
    k."generation",
    count(s."key_version")::bigint
  FROM public."review_provider_subject_hmac_key_versions" k
  LEFT JOIN public."review_provider_subjects" s
    ON s."key_version" = k."key_version"
  GROUP BY k."key_version", k."key_digest", k."state", k."generation"
  ORDER BY k."generation", k."key_version"
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.single_us_beta_supported_country_v3(country_value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
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
$function$
;
--> statement-breakpoint
CREATE TRIGGER ai_execution_control_heads_transition_guard BEFORE DELETE OR UPDATE ON public.ai_execution_control_heads FOR EACH ROW EXECUTE FUNCTION reject_ai_execution_control_head_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER backup_erasure_ledger_truncate_guard BEFORE TRUNCATE ON public.backup_erasure_ledger FOR EACH STATEMENT EXECUTE FUNCTION reject_backup_erasure_ledger_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER backup_erasure_ledger_update_delete_guard BEFORE DELETE OR UPDATE ON public.backup_erasure_ledger FOR EACH ROW EXECUTE FUNCTION reject_backup_erasure_ledger_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER beta_feedback_triage_revision_guard BEFORE UPDATE ON public.beta_feedback_triage FOR EACH ROW EXECUTE FUNCTION guard_beta_feedback_triage_revision_v1();
--> statement-breakpoint
CREATE TRIGGER beta_feedback_triage_transition_truncate_guard BEFORE TRUNCATE ON public.beta_feedback_triage_transitions FOR EACH STATEMENT EXECUTE FUNCTION guard_beta_feedback_triage_transition_immutable_v1();
--> statement-breakpoint
CREATE TRIGGER beta_feedback_triage_transition_update_guard BEFORE DELETE OR UPDATE ON public.beta_feedback_triage_transitions FOR EACH ROW EXECUTE FUNCTION guard_beta_feedback_triage_transition_immutable_v1();
--> statement-breakpoint
CREATE TRIGGER goal_monthly_results_guard BEFORE INSERT OR DELETE OR UPDATE ON public.goal_monthly_results FOR EACH ROW EXECUTE FUNCTION guard_goal_monthly_result_v1();
--> statement-breakpoint
CREATE TRIGGER goal_program_versions_append_only BEFORE DELETE OR UPDATE ON public.goal_program_versions FOR EACH ROW EXECUTE FUNCTION reject_canonical_goal_append_only_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER goal_programs_transition_guard BEFORE UPDATE ON public.goal_programs FOR EACH ROW EXECUTE FUNCTION guard_goal_program_transition_v1();
--> statement-breakpoint
CREATE TRIGGER goal_result_revisions_append_only BEFORE DELETE OR UPDATE ON public.goal_result_revisions FOR EACH ROW EXECUTE FUNCTION reject_canonical_goal_append_only_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER goal_result_revisions_insert_guard BEFORE INSERT ON public.goal_result_revisions FOR EACH ROW EXECUTE FUNCTION validate_goal_result_revision_v1();
--> statement-breakpoint
CREATE TRIGGER guest_qualified_scans_staff_attribution_immutable BEFORE UPDATE OF attributed_staff_participant_id, attributed_staff_participation_id, attribution_responsibility_id, staff_attribution_effective_from, staff_attribution_effective_to ON public.guest_qualified_scans FOR EACH ROW EXECUTE FUNCTION guard_primary_staff_attribution_immutable_v1();
--> statement-breakpoint
CREATE TRIGGER guest_responses_retire_contact_request AFTER UPDATE OF status, deleted_at, feedback_withdrawn_at ON public.guest_responses FOR EACH ROW WHEN ((((old.status)::text IS DISTINCT FROM (new.status)::text) OR (old.deleted_at IS DISTINCT FROM new.deleted_at) OR (old.feedback_withdrawn_at IS DISTINCT FROM new.feedback_withdrawn_at))) EXECUTE FUNCTION retire_guest_contact_on_response_terminal_v1();
--> statement-breakpoint
CREATE TRIGGER guest_responses_staff_attribution_immutable BEFORE UPDATE OF attributed_staff_participant_id, attributed_staff_participation_id, attribution_responsibility_id, staff_attribution_effective_from, staff_attribution_effective_to ON public.guest_responses FOR EACH ROW EXECUTE FUNCTION guard_primary_staff_attribution_immutable_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_assignment_history_immutable BEFORE DELETE OR UPDATE ON public.inbox_assignment_history FOR EACH ROW EXECUTE FUNCTION reject_inbox_assignment_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_assignment_history_truncate_guard BEFORE TRUNCATE ON public.inbox_assignment_history FOR EACH STATEMENT EXECUTE FUNCTION reject_inbox_assignment_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_escalation_history_immutable BEFORE DELETE OR UPDATE ON public.inbox_escalation_history FOR EACH ROW EXECUTE FUNCTION reject_inbox_escalation_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_escalation_history_truncate_guard BEFORE TRUNCATE ON public.inbox_escalation_history FOR EACH STATEMENT EXECUTE FUNCTION reject_inbox_escalation_history_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_feedback_handling_outcomes_append_guard BEFORE INSERT ON public.inbox_feedback_handling_outcomes FOR EACH ROW EXECUTE FUNCTION enforce_inbox_feedback_handling_outcome_append_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_feedback_handling_outcomes_immutable BEFORE DELETE OR UPDATE ON public.inbox_feedback_handling_outcomes FOR EACH ROW EXECUTE FUNCTION reject_inbox_feedback_handling_outcome_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_feedback_handling_outcomes_truncate_guard BEFORE TRUNCATE ON public.inbox_feedback_handling_outcomes FOR EACH STATEMENT EXECUTE FUNCTION reject_inbox_feedback_handling_outcome_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_handling_cycle_response_targets_terminal_guard BEFORE DELETE OR UPDATE ON public.inbox_handling_cycle_response_targets FOR EACH ROW EXECUTE FUNCTION enforce_inbox_response_target_terminal_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_handling_cycle_response_targets_truncate_guard BEFORE TRUNCATE ON public.inbox_handling_cycle_response_targets FOR EACH STATEMENT EXECUTE FUNCTION reject_inbox_response_target_truncate_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_handling_cycles_immutable BEFORE UPDATE ON public.inbox_handling_cycles FOR EACH ROW EXECUTE FUNCTION reject_inbox_handling_cycle_update_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_response_target_reminders_schedule_guard BEFORE INSERT ON public.inbox_response_target_reminders FOR EACH ROW EXECUTE FUNCTION validate_inbox_response_target_reminder_schedule_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_response_target_reminders_terminal_guard BEFORE DELETE OR UPDATE ON public.inbox_response_target_reminders FOR EACH ROW EXECUTE FUNCTION enforce_inbox_response_target_reminder_terminal_v1();
--> statement-breakpoint
CREATE TRIGGER inbox_response_target_reminders_truncate_guard BEFORE TRUNCATE ON public.inbox_response_target_reminders FOR EACH STATEMENT EXECUTE FUNCTION reject_inbox_response_target_truncate_v1();
--> statement-breakpoint
CREATE TRIGGER member_fence_google_connector_departure BEFORE DELETE OR UPDATE OF role ON public.member FOR EACH ROW EXECUTE FUNCTION fence_google_connector_departure_v1();
--> statement-breakpoint
CREATE TRIGGER member_last_owner_del BEFORE DELETE ON public.member FOR EACH ROW EXECUTE FUNCTION guard_last_owner();
--> statement-breakpoint
CREATE TRIGGER member_last_owner_upd BEFORE UPDATE OF role, "organizationId" ON public.member FOR EACH ROW WHEN (((old.role IS DISTINCT FROM new.role) OR (old."organizationId" IS DISTINCT FROM new."organizationId"))) EXECUTE FUNCTION guard_last_owner();
--> statement-breakpoint
CREATE TRIGGER member_perm_ver_del AFTER DELETE ON public.member FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();
--> statement-breakpoint
CREATE TRIGGER member_perm_ver_ins AFTER INSERT ON public.member FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();
--> statement-breakpoint
CREATE TRIGGER member_perm_ver_upd AFTER UPDATE OF role, "organizationId" ON public.member FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();
--> statement-breakpoint
CREATE TRIGGER merchant_ai_consent_evidence_append_guard BEFORE INSERT OR DELETE OR UPDATE ON public.merchant_ai_consent_evidence FOR EACH ROW EXECUTE FUNCTION guard_merchant_ai_evidence_v1();
--> statement-breakpoint
CREATE TRIGGER merchant_ai_consent_evidence_truncate_guard BEFORE TRUNCATE ON public.merchant_ai_consent_evidence FOR EACH STATEMENT EXECUTE FUNCTION guard_merchant_ai_evidence_v1();
--> statement-breakpoint
CREATE TRIGGER merchant_ai_enablement_transition_guard BEFORE INSERT OR DELETE OR UPDATE ON public.merchant_ai_enablement FOR EACH ROW EXECUTE FUNCTION guard_merchant_ai_enablement_v1();
--> statement-breakpoint
CREATE TRIGGER merchant_ai_enablement_truncate_guard BEFORE TRUNCATE ON public.merchant_ai_enablement FOR EACH STATEMENT EXECUTE FUNCTION guard_merchant_ai_enablement_v1();
--> statement-breakpoint
CREATE TRIGGER metric_corrections_staff_attribution_immutable BEFORE UPDATE OF attributed_staff_participant_id, attributed_staff_participation_id, attribution_responsibility_id, staff_attribution_effective_from, staff_attribution_effective_to ON public.metric_corrections FOR EACH ROW EXECUTE FUNCTION guard_primary_staff_attribution_immutable_v1();
--> statement-breakpoint
CREATE TRIGGER metric_readings_staff_attribution_immutable BEFORE UPDATE OF attributed_staff_participant_id, attributed_staff_participation_id, attribution_responsibility_id, staff_attribution_effective_from, staff_attribution_effective_to ON public.metric_readings FOR EACH ROW EXECUTE FUNCTION guard_primary_staff_attribution_immutable_v1();
--> statement-breakpoint
CREATE TRIGGER notifications_normalize_source_content BEFORE INSERT OR UPDATE OF payload, title, body, type ON public.notifications FOR EACH ROW EXECUTE FUNCTION normalize_notification_source_content_v1();
--> statement-breakpoint
CREATE TRIGGER operational_action_history_heads_truncate_guard BEFORE TRUNCATE ON public.operational_action_history_heads FOR EACH STATEMENT EXECUTE FUNCTION guard_operational_action_history_head_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER operational_action_history_heads_update_guard BEFORE DELETE OR UPDATE ON public.operational_action_history_heads FOR EACH ROW EXECUTE FUNCTION guard_operational_action_history_head_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER operational_action_history_legal_holds_mutation_guard BEFORE DELETE OR UPDATE ON public.operational_action_history_legal_holds FOR EACH ROW EXECUTE FUNCTION guard_operational_action_history_hold_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER operational_action_history_legal_holds_truncate_guard BEFORE TRUNCATE ON public.operational_action_history_legal_holds FOR EACH STATEMENT EXECUTE FUNCTION guard_operational_action_history_hold_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER operational_action_history_records_mutation_guard BEFORE DELETE OR UPDATE ON public.operational_action_history_records FOR EACH ROW EXECUTE FUNCTION guard_operational_action_history_record_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER operational_action_history_records_truncate_guard BEFORE TRUNCATE ON public.operational_action_history_records FOR EACH STATEMENT EXECUTE FUNCTION guard_operational_action_history_record_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER organization_lifecycle_authority_provision AFTER INSERT ON public.organization FOR EACH ROW EXECUTE FUNCTION provision_organization_lifecycle_authority_v1();
--> statement-breakpoint
CREATE TRIGGER organization_lifecycle_events_append_only BEFORE DELETE OR TRUNCATE OR UPDATE ON public.organization_lifecycle_events FOR EACH STATEMENT EXECUTE FUNCTION reject_organization_lifecycle_event_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER organization_role_perm_ver_iud AFTER INSERT OR DELETE OR UPDATE ON public."organizationRole" FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_ba();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER organization_export_retrieval_issuance_commit_guard AFTER INSERT ON public.organization_export_retrieval_issuances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_organization_export_retrieval_issuance_v1();
--> statement-breakpoint
CREATE TRIGGER organization_export_retrieval_issuance_insert_guard BEFORE INSERT ON public.organization_export_retrieval_issuances FOR EACH ROW EXECUTE FUNCTION guard_organization_export_retrieval_issuance_v1();
--> statement-breakpoint
CREATE TRIGGER organization_export_retrieval_issuances_truncate_guard BEFORE TRUNCATE ON public.organization_export_retrieval_issuances FOR EACH STATEMENT EXECUTE FUNCTION reject_identity_lifecycle_evidence_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER organization_export_retrieval_issuances_update_delete_guard BEFORE DELETE OR UPDATE ON public.organization_export_retrieval_issuances FOR EACH ROW EXECUTE FUNCTION reject_identity_lifecycle_evidence_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER organization_export_revision_guard BEFORE UPDATE ON public.organization_exports FOR EACH ROW EXECUTE FUNCTION guard_organization_export_revision_v1();
--> statement-breakpoint
CREATE TRIGGER organization_lifecycle_revision_guard BEFORE UPDATE ON public.organization_lifecycle_authority FOR EACH ROW EXECUTE FUNCTION guard_organization_lifecycle_revision_v1();
--> statement-breakpoint
CREATE TRIGGER organization_role_policy_perm_ver_iud AFTER INSERT OR DELETE OR UPDATE ON public.organization_role_policy FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_app();
--> statement-breakpoint
CREATE TRIGGER portal_publication_activations_history_guard BEFORE UPDATE ON public.portal_publication_activations FOR EACH ROW EXECUTE FUNCTION guard_portal_publication_history_v1();
--> statement-breakpoint
CREATE TRIGGER portal_publication_snapshots_immutable BEFORE UPDATE ON public.portal_publication_snapshots FOR EACH ROW EXECUTE FUNCTION guard_portal_publication_history_v1();
--> statement-breakpoint
CREATE TRIGGER privacy_requests_transition_guard BEFORE DELETE OR UPDATE ON public.privacy_requests FOR EACH ROW EXECUTE FUNCTION reject_privacy_request_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER privacy_requests_truncate_guard BEFORE TRUNCATE ON public.privacy_requests FOR EACH STATEMENT EXECUTE FUNCTION reject_privacy_request_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER property_access_grant_perm_ver_iud AFTER INSERT OR DELETE OR UPDATE ON public.property_access_grant FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_app();
--> statement-breakpoint
CREATE TRIGGER property_erase_authorities_transition_guard BEFORE DELETE OR UPDATE ON public.property_erase_authorities FOR EACH ROW EXECUTE FUNCTION reject_property_erase_authority_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER property_erase_authorities_truncate_guard BEFORE TRUNCATE ON public.property_erase_authorities FOR EACH STATEMENT EXECUTE FUNCTION reject_property_erase_authority_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER replies_advance_state_revision_on_delete BEFORE DELETE ON public.replies FOR EACH ROW EXECUTE FUNCTION advance_review_reply_state_revision_on_delete_v1();
--> statement-breakpoint
CREATE TRIGGER replies_increment_state_revision BEFORE INSERT OR UPDATE ON public.replies FOR EACH ROW EXECUTE FUNCTION increment_reply_state_revision();
--> statement-breakpoint
CREATE TRIGGER replies_invalidate_ai_adoption AFTER DELETE OR UPDATE ON public.replies FOR EACH ROW EXECUTE FUNCTION invalidate_ai_reply_adoption_v1();
--> statement-breakpoint
CREATE TRIGGER reply_publication_authorizations_immutable BEFORE DELETE OR UPDATE ON public.reply_publication_authorizations FOR EACH ROW EXECUTE FUNCTION reject_reply_publication_authorization_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER reply_publication_authorizations_truncate_guard BEFORE TRUNCATE ON public.reply_publication_authorizations FOR EACH STATEMENT EXECUTE FUNCTION reject_reply_publication_authorization_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER review_lifecycle_recovery_executions_mutation_guard BEFORE DELETE OR UPDATE ON public.review_lifecycle_recovery_executions FOR EACH ROW EXECUTE FUNCTION guard_review_lifecycle_recovery_execution_v1();
--> statement-breakpoint
CREATE TRIGGER review_lifecycle_recovery_executions_truncate_guard BEFORE TRUNCATE ON public.review_lifecycle_recovery_executions FOR EACH STATEMENT EXECUTE FUNCTION guard_review_lifecycle_recovery_execution_v1();
--> statement-breakpoint
CREATE TRIGGER reviews_protect_reply_state_revision BEFORE UPDATE OF reply_state_revision ON public.reviews FOR EACH ROW EXECUTE FUNCTION protect_review_reply_state_revision_v1();
--> statement-breakpoint

-- ── Exclusion constraints ──────────────────────────────────────────────
--
-- btree_gist EXCLUDE constraints: no-overlap invariants over
-- tstzrange(effective_from, effective_to). drizzle-orm 0.45 has no DSL for
-- them, so they live here rather than in a pgTable declaration.

ALTER TABLE goal_program_versions ADD CONSTRAINT gpv_no_overlapping_effective_intervals EXCLUDE USING gist (organization_id WITH =, property_id WITH =, program_id WITH =, tstzrange(effective_from, effective_to, '[)'::text) WITH &&);
--> statement-breakpoint
ALTER TABLE goal_subject_assignments ADD CONSTRAINT gsa_no_overlapping_subject_metric_intervals EXCLUDE USING gist (organization_id WITH =, property_id WITH =, subject_kind WITH =, COALESCE(property_subject_id, portal_group_id, portal_id) WITH =, metric_key WITH =, tstzrange(effective_from, effective_to, '[)'::text) WITH &&);
--> statement-breakpoint
ALTER TABLE portal_group_memberships ADD CONSTRAINT pgm_no_overlapping_portal_intervals EXCLUDE USING gist (organization_id WITH =, property_id WITH =, portal_id WITH =, tstzrange(effective_from, effective_to, '[)'::text) WITH &&);
--> statement-breakpoint
ALTER TABLE portal_responsibilities ADD CONSTRAINT pr_no_overlapping_primary_intervals EXCLUDE USING gist (organization_id WITH =, property_id WITH =, portal_id WITH =, tstzrange(effective_from, effective_to, '[)'::text) WITH &&) WHERE ((kind = 'primary'::responsibility_kind));
--> statement-breakpoint
ALTER TABLE portal_responsibilities ADD CONSTRAINT pr_no_overlapping_responsibility_intervals EXCLUDE USING gist (organization_id WITH =, property_id WITH =, portal_id WITH =, staff_participation_id WITH =, kind WITH =, tstzrange(effective_from, effective_to, '[)'::text) WITH &&);
--> statement-breakpoint
