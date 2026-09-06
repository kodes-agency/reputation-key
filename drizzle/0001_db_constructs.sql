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
CREATE OR REPLACE FUNCTION public.acquire_ai_read_delivery_v1(p_organization_id text, p_property_id uuid, p_actor_user_id text)
 RETURNS TABLE(organization_generation integer, property_generation integer, actor_generation integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_organization_state text;
  v_property_state text;
  v_actor_state text;
BEGIN
  IF p_organization_id IS NULL OR length(p_organization_id) NOT BETWEEN 1 AND 255
    OR p_property_id IS NULL
    OR p_actor_user_id IS NULL OR length(p_actor_user_id) NOT BETWEEN 1 AND 255
  THEN
    RAISE EXCEPTION 'Invalid AI read delivery scope'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    'organization', p_organization_id, 'ai-read-barrier-v1', 1, 'open', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;
  SELECT generation, state
  INTO organization_generation, v_organization_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = 'organization' AND scope_id = p_organization_id
  FOR SHARE;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    'property', p_property_id::text, 'ai-read-barrier-v1', 1, 'open', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;
  SELECT generation, state
  INTO property_generation, v_property_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = 'property' AND scope_id = p_property_id::text
  FOR SHARE;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    'actor', p_actor_user_id, 'ai-read-barrier-v1', 1, 'open', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;
  SELECT generation, state
  INTO actor_generation, v_actor_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = 'actor' AND scope_id = p_actor_user_id
  FOR SHARE;

  IF v_organization_state <> 'open'
    OR v_property_state <> 'open'
    OR v_actor_state <> 'open'
  THEN
    RETURN;
  END IF;
  RETURN NEXT;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admit_ai_canary_v1(p_descriptor jsonb, p_request_binding_key_id character varying, p_request_binding_hmac character varying, p_grant_kid character varying)
 RETURNS TABLE(status text, code text, nonce text, issued_at_epoch_millis bigint, expires_at_epoch_millis bigint, reply_token_expires_at_epoch_millis bigint, reply_draft_expires_at_epoch_millis bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admit_ai_property_v1(p_descriptor jsonb, p_request_binding_key_id character varying, p_request_binding_hmac character varying, p_grant_kid character varying)
 RETURNS TABLE(status text, code text, nonce text, issued_at_epoch_millis bigint, expires_at_epoch_millis bigint, reply_token_expires_at_epoch_millis bigint, reply_draft_expires_at_epoch_millis bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    maximum_input_tokens::numeric * 200000::numeric +
    operation_profile_row.max_output_tokens::numeric * 1200000::numeric +
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
    OR p_descriptor->'binding' IS DISTINCT FROM (
      jsonb_build_object(
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
      || CASE
        WHEN route_name = 'reply-suggestion' THEN jsonb_build_object(
          'replyBrandProfileVersion', operation_row.reply_brand_profile_version,
          'replyBrandDisplayNameDigest',
            operation_row.reply_brand_display_name_digest
        )
        ELSE '{}'::jsonb
      END
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
    OR (
      route_name = 'reply-suggestion'
      AND (
        operation_row.reply_brand_profile_version IS NULL
        OR operation_row.reply_brand_display_name_digest IS NULL
        OR NOT public.is_current_portal_ai_reply_brand_profile_v1(
          operation_row.organization_id,
          operation_row.property_id,
          operation_row.reply_brand_profile_version,
          operation_row.reply_brand_display_name_digest
        )
      )
    )
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

  -- `organization_capability` is keyed by PURPOSE (`ai.generate_reply`), not by
  -- capability (`reply_drafting`); comparing it to `capability_name` could never
  -- match, so every AI operation was denied `authorization_changed`.
  -- `property_policy` rows are written only by setPropertyPolicy (the
  -- suspend/restore command), so a property that has never been suspended has NO
  -- row: requiring one to exist denied every such property. Deny only on an actual
  -- suspension.
  IF NOT EXISTS (
    SELECT 1 FROM organization_capability
    WHERE organization_id = operation_row.organization_id
      AND capability = operation_profile_row.purpose
  ) OR EXISTS (
    SELECT 1 FROM property_policy
    WHERE property_id = operation_row.property_id
      AND suspended_at IS NOT NULL
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

  -- Column 6 is reply_token_expires_at, column 7 is reply_draft_expires_at, and
  -- both the gateway (grantMatchesInvocation) and the signed grant contract
  -- (validateGrantFields in ai-internal-transport-contract.ts) require
  -- token <= draft: a request-scoped token must not outlive the draft it authorises.
  -- These two expressions were the wrong way round, so the token carried the review's
  -- content expiry (weeks out) while the draft carried the caller deadline (~70s),
  -- making token <= draft impossible. Every reply-suggestion grant was rejected as
  -- ambiguous before the connector was ever reached.
  RETURN QUERY SELECT 'admitted', NULL::text, permit_row.nonce::text,
    now_millis, caller_deadline_value,
    CASE WHEN route_name = 'reply-suggestion'
      THEN LEAST(observed_content_expiry, caller_deadline_value) ELSE NULL END,
    CASE WHEN route_name = 'reply-suggestion'
      THEN observed_content_expiry ELSE NULL END;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.advance_ai_aggregate_revision_v1(p_organization_id text, p_property_id uuid, p_source_epoch integer, p_review_analysis_epoch integer, p_analysis_sequence bigint, p_expected_aggregate_revision bigint)
 RETURNS TABLE(aggregate_revision bigint, applied_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cursor public.ai_review_event_cursors%ROWTYPE;
  v_outcome public.ai_review_analysis_outcomes%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id || ':' || p_property_id::text, 0)
  );
  SELECT *
  INTO v_cursor
  FROM public.ai_review_event_cursors
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT *
  INTO v_outcome
  FROM public.ai_review_analysis_outcomes
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
    AND analysis_sequence = p_analysis_sequence
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_outcome.applied_aggregate_revision IS NOT NULL THEN
    aggregate_revision := v_outcome.applied_aggregate_revision;
    applied_at := v_outcome.applied_at;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_outcome.state NOT IN ('ready', 'terminal_no_result')
    OR p_analysis_sequence <= v_cursor.analysis_start_sequence
    OR p_analysis_sequence > v_cursor.terminal_analysis_sequence
    OR EXISTS (
      SELECT 1
      FROM public.ai_review_analysis_outcomes AS prior
      WHERE prior.organization_id = p_organization_id
        AND prior.property_id = p_property_id
        AND prior.source_epoch = p_source_epoch
        AND prior.review_analysis_epoch = p_review_analysis_epoch
        AND prior.analysis_sequence > v_cursor.analysis_start_sequence
        AND prior.analysis_sequence < p_analysis_sequence
        AND prior.applied_aggregate_revision IS NULL
    )
    OR v_cursor.aggregate_revision <> p_expected_aggregate_revision
    OR v_cursor.aggregate_revision >= 9007199254740991
  THEN
    RETURN;
  END IF;
  UPDATE public.ai_review_analysis_outcomes
  SET
    applied_aggregate_revision = v_cursor.aggregate_revision + 1,
    applied_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
    AND analysis_sequence = p_analysis_sequence;
  UPDATE public.ai_review_event_cursors
  SET
    aggregate_revision = v_cursor.aggregate_revision + 1,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch;
  aggregate_revision := v_cursor.aggregate_revision + 1;
  applied_at := v_now;
  RETURN NEXT;
END;
$function$
;
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
CREATE OR REPLACE FUNCTION public.ai_advisory_lock_key_v1(p_scope text)
 RETURNS bigint
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF octet_length(p_scope) < 1
    OR octet_length(p_scope) > 2048
    OR p_scope !~ '^[ -~]+$'
    OR p_scope !~ '^(release-run|erasure-owner|provider-source|provider-snapshot|property-event|reply-adoption|provider-rate|deployment-concurrency|organization-concurrency|property-concurrency|operation-attempt|canary-release)\|'
  THEN
    RAISE EXCEPTION 'ai_advisory_lock_key_v1_invalid_scope' USING ERRCODE = '22023';
  END IF;
  RETURN hashtextextended(
    'ai-admission-scope-v1|' || octet_length(p_scope)::text || ':' || p_scope,
    5928232768719372617
  );
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
CREATE OR REPLACE FUNCTION public.ai_property_quota_adoption_v1(p_transition_anchor timestamp with time zone, p_timezone text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
CREATE OR REPLACE FUNCTION public.assert_ai_capability_set_executable_v1(p_capabilities text[], p_notice_version text, p_notice_digest text, p_provider_deployment_profile_version text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  canonical_capabilities text[];
  current_capability text;
  mapping record;
  result jsonb := '{}'::jsonb;
BEGIN
  IF p_notice_version <> 'merchant-ai-notice-2026-09-06.v1'
    OR p_notice_digest <> '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8'
    OR p_provider_deployment_profile_version <> 'private-beta-global-v1'
  THEN
    RAISE EXCEPTION 'merchant_ai_runtime_mapping_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(
    array_agg(catalogue.capability ORDER BY catalogue.ordinal),
    ARRAY[]::text[]
  )
  INTO canonical_capabilities
  FROM unnest(ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[])
    WITH ORDINALITY AS catalogue(capability, ordinal)
  WHERE catalogue.capability = ANY(coalesce(p_capabilities, ARRAY[]::text[]));

  IF cardinality(canonical_capabilities) = 0
    OR cardinality(canonical_capabilities) <> cardinality(p_capabilities)
    OR canonical_capabilities <> p_capabilities
    OR ('property_trends' = ANY(p_capabilities) AND NOT 'review_analysis' = ANY(p_capabilities))
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_capability_set' USING ERRCODE = 'P0001';
  END IF;

  FOREACH current_capability IN ARRAY canonical_capabilities
  LOOP
    SELECT *
    INTO STRICT mapping
    FROM public.resolve_ai_runtime_capability_v1(
      p_provider_deployment_profile_version,
      current_capability,
      '3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168'
    );

    IF mapping.notice_version IS DISTINCT FROM p_notice_version
      OR mapping.notice_digest IS DISTINCT FROM p_notice_digest
      OR mapping.resolved_catalogue_digest IS DISTINCT FROM
        '3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168'
    THEN
      RAISE EXCEPTION 'merchant_ai_runtime_mapping_unavailable'
        USING ERRCODE = 'P0001';
    END IF;

    result := result || jsonb_build_object(
      current_capability,
      mapping.runtime_profile_version
    );
  END LOOP;

  RETURN result;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_ai_property_calendar_authority_v1()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_authority public.ai_property_calendar_authorities%ROWTYPE;
  v_vector jsonb;
  v_actual date;
BEGIN
  SELECT *
  INTO v_authority
  FROM public.ai_property_calendar_authorities
  WHERE profile_version = 'property-calendar-v1';
  IF NOT FOUND
    OR public.resolve_ai_property_local_date_v1(
      '2026-01-01T00:00:00Z'::timestamp with time zone,
      'UTC',
      'property-calendar-v1'
    ) IS NULL
  THEN
    RETURN false;
  END IF;

  FOR v_vector IN
    SELECT value FROM jsonb_array_elements(v_authority.test_vectors)
  LOOP
    IF jsonb_typeof(v_vector) <> 'object'
      OR v_vector->>'reviewedAt' IS NULL
      OR v_vector->>'timezone' IS NULL
      OR v_vector->>'expectedLocalDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR (SELECT count(*) FROM jsonb_object_keys(v_vector)) <> 3
    THEN
      RETURN false;
    END IF;
    v_actual := public.resolve_ai_property_local_date_v1(
      (v_vector->>'reviewedAt')::timestamp with time zone,
      v_vector->>'timezone',
      'property-calendar-v1'
    );
    IF v_actual IS NULL OR v_actual::text <> v_vector->>'expectedLocalDate' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN RETURN false;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_current_ai_draft_binding_v1(organization_id_value text, reply_id_value uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  property_id_value uuid;
  review_id_value uuid;
  operation_id_value uuid;
  provider_profile_value text;
  reply_row record;
  review_row record;
  property_row record;
  profile_row record;
  authorization_row record;
  operation_row record;
  binding_is_current boolean;
BEGIN
  SELECT
    reply."review_id",
    review."property_id",
    reply."origin_operation_id",
    operation."provider_deployment_profile_version"
  INTO
    review_id_value,
    property_id_value,
    operation_id_value,
    provider_profile_value
  FROM "replies" AS reply
  JOIN "reviews" AS review
    ON review."id" = reply."review_id"
   AND review."organization_id" = reply."organization_id"
  LEFT JOIN "ai_operations" AS operation
    ON operation."id" = reply."origin_operation_id"
  WHERE reply."id" = reply_id_value
    AND reply."organization_id" = organization_id_value;

  IF NOT FOUND THEN RETURN 'not_ai'; END IF;

  PERFORM 1
  FROM "ai_execution_control_heads"
  WHERE "scope_key" IN (
    'global',
    'provider:' || COALESCE(provider_profile_value, ''),
    'capability:reply_drafting'
  )
  ORDER BY "scope_key"
  FOR UPDATE;

  SELECT
    property."organization_id",
    property."profile_version",
    property."source_epoch",
    property."lifecycle_state",
    property."deleted_at"
  INTO property_row
  FROM "properties" AS property
  WHERE property."id" = property_id_value
    AND property."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT profile.*
  INTO profile_row
  FROM "ai_property_processing_profiles" AS profile
  WHERE profile."property_id" = property_id_value
    AND profile."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT enablement.*
  INTO authorization_row
  FROM "merchant_ai_enablement" AS enablement
  WHERE enablement."property_id" = property_id_value
    AND enablement."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT
    review."property_id",
    review."source_epoch",
    review."source_revision",
    review."content_expires_at"
  INTO review_row
  FROM "reviews" AS review
  WHERE review."id" = review_id_value
    AND review."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT reply.*
  INTO reply_row
  FROM "replies" AS reply
  WHERE reply."id" = reply_id_value
    AND reply."organization_id" = organization_id_value
  FOR UPDATE;

  IF NOT FOUND OR reply_row."authorship" IS DISTINCT FROM 'ai_assisted' THEN
    RETURN 'not_ai';
  END IF;

  SELECT operation.*
  INTO operation_row
  FROM "ai_operations" AS operation
  WHERE operation."id" = reply_row."origin_operation_id"
  FOR UPDATE;

  binding_is_current :=
    property_row."organization_id" = organization_id_value
    AND property_row."deleted_at" IS NULL
    AND property_row."lifecycle_state" = 'active'
    AND property_row."source_epoch" = reply_row."origin_source_epoch"
    AND profile_row."organization_id" = organization_id_value
    AND profile_row."property_id" = property_id_value
    AND profile_row."lifecycle_state" = 'active'
    AND profile_row."source_epoch" = reply_row."origin_source_epoch"
    AND profile_row."profile_version" = reply_row."origin_property_profile_version"
    AND review_row."property_id" = property_id_value
    AND review_row."source_epoch" = reply_row."origin_source_epoch"
    AND review_row."source_revision" = reply_row."origin_source_revision"
    AND review_row."content_expires_at" > transaction_timestamp()
    AND reply_row."ai_draft_expires_at" > transaction_timestamp()
    AND authorization_row."organization_id" = organization_id_value
    AND authorization_row."property_id" = property_id_value
    AND authorization_row."state" = 'enabled'
    AND authorization_row."authorized_source_epoch" = reply_row."origin_source_epoch"
    AND authorization_row."reply_drafting_epoch" = reply_row."origin_reply_drafting_epoch"
    AND authorization_row."capabilities" @> ARRAY['reply_drafting']::text[]
    AND authorization_row."capability_runtime_profile_versions"->>'reply_drafting' = 'reply-drafting-runtime-v1'
    AND operation_row."id" = reply_row."origin_operation_id"
    AND operation_row."command" = 'reply'
    AND operation_row."capability" = 'reply_drafting'
    AND operation_row."organization_id" = organization_id_value
    AND operation_row."property_id" = property_id_value
    AND operation_row."review_id" = review_id_value
    AND operation_row."source_epoch" = reply_row."origin_source_epoch"
    AND operation_row."source_revision" = reply_row."origin_source_revision"
    AND operation_row."property_profile_version" = reply_row."origin_property_profile_version"
    AND operation_row."operation_profile_version" = 'reply-suggestion-v1'
    AND (
      (
        reply_row."origin_ai_profile_version" IN ('reply-suggestion-v1', 'reply-draft-v1')
        AND operation_row."reply_brand_profile_version" IS NULL
        AND operation_row."reply_brand_display_name_digest" IS NULL
      )
      OR (
        reply_row."origin_ai_profile_version" = 'reply-draft-v2'
        AND operation_row."reply_brand_profile_version" >= 1
        AND operation_row."reply_brand_display_name_digest" ~ '^[0-9a-f]{64}$'
      )
    )
    AND operation_row."capability_runtime_profile_version" = 'reply-drafting-runtime-v1'
    AND operation_row."provider_deployment_profile_version" = profile_row."provider_deployment_profile_version"
    AND operation_row."provider_deployment_profile_version" = authorization_row."provider_deployment_profile_version"
    AND operation_row."authorization_lineage_id" = authorization_row."authorization_lineage_id"
    AND operation_row."reply_adoption_disposition" = 'adopted'
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'global'
        AND head."control_id" = operation_row."global_control_id"
        AND head."generation" = operation_row."global_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    )
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'provider:' || operation_row."provider_deployment_profile_version"
        AND head."control_id" = operation_row."provider_control_id"
        AND head."generation" = operation_row."provider_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    )
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'capability:reply_drafting'
        AND head."control_id" = operation_row."capability_control_id"
        AND head."generation" = operation_row."capability_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    );

  IF binding_is_current THEN RETURN 'current'; END IF;

  DELETE FROM "replies"
  WHERE "id" = reply_id_value
    AND "organization_id" = organization_id_value
    AND "authorship" = 'ai_assisted'
    AND ("publication_state" IS NULL OR "publication_state" = 'authorized');

  IF FOUND THEN RETURN 'stale'; END IF;
  RETURN 'current';
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
CREATE OR REPLACE FUNCTION public.close_ai_read_barrier_v1(p_scope_kind text, p_scope_id text, p_expected_generation integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_generation integer;
  v_state text;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_scope_kind NOT IN ('organization', 'property', 'actor')
    OR p_scope_id IS NULL OR length(p_scope_id) NOT BETWEEN 1 AND 255
    OR p_expected_generation < 0
  THEN
    RAISE EXCEPTION 'Invalid AI read barrier close scope'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    p_scope_kind, p_scope_id, 'ai-read-barrier-v1', 1, 'closing', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;

  SELECT generation, state
  INTO v_generation, v_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = p_scope_kind AND scope_id = p_scope_id
  FOR UPDATE;

  IF v_state = 'closing' THEN
    IF p_expected_generation NOT IN (0, v_generation) THEN
      RAISE EXCEPTION 'AI read barrier generation conflict'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_generation;
  END IF;
  IF p_expected_generation <> v_generation THEN
    RAISE EXCEPTION 'AI read barrier generation conflict'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.ai_read_barrier_heads
  SET generation = v_generation + 1, state = 'closing', updated_at = v_now
  WHERE scope_kind = p_scope_kind AND scope_id = p_scope_id;
  RETURN v_generation + 1;
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
CREATE OR REPLACE FUNCTION public.consume_ai_admission_rate_v1(p_scope_key text, p_limit integer, p_window_seconds integer, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consume_ai_review_event_v1(p_organization_id text, p_property_id uuid, p_source_epoch integer, p_review_analysis_epoch integer, p_analysis_start_sequence bigint, p_analysis_sequence bigint, p_event_envelope_id uuid, p_disposition text)
 RETURNS TABLE(status text, consumed_sequence bigint, terminal_analysis_sequence bigint, expected_sequence bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cursor public.ai_review_event_cursors%ROWTYPE;
  v_outcome public.ai_review_analysis_outcomes%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_terminal bigint;
  v_next_state text;
BEGIN
  IF p_organization_id IS NULL OR length(p_organization_id) NOT BETWEEN 1 AND 255
    OR p_property_id IS NULL
    OR p_source_epoch < 0
    OR p_review_analysis_epoch < 1
    OR p_analysis_start_sequence NOT BETWEEN 0 AND 9007199254740991
    OR p_analysis_sequence NOT BETWEEN 1 AND 9007199254740991
    OR p_event_envelope_id IS NULL
    OR p_disposition NOT IN ('pending', 'source_expired', 'provider_deleted', 'policy_disabled')
  THEN
    RAISE EXCEPTION 'Invalid AI review event'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id || ':' || p_property_id::text, 0)
  );
  INSERT INTO public.ai_review_event_cursors (
    organization_id, property_id, source_epoch, review_analysis_epoch,
    analysis_start_sequence, consumed_sequence, terminal_analysis_sequence,
    aggregate_revision, last_consumed_event_id, created_at, updated_at
  ) VALUES (
    p_organization_id, p_property_id, p_source_epoch, p_review_analysis_epoch,
    p_analysis_start_sequence, p_analysis_start_sequence, p_analysis_start_sequence,
    0, NULL, v_now, v_now
  ) ON CONFLICT (
    organization_id, property_id, source_epoch, review_analysis_epoch
  ) DO NOTHING;

  SELECT *
  INTO v_cursor
  FROM public.ai_review_event_cursors
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
  FOR UPDATE;

  IF NOT FOUND OR v_cursor.analysis_start_sequence <> p_analysis_start_sequence THEN
    RETURN;
  END IF;

  IF p_analysis_sequence <= v_cursor.consumed_sequence THEN
    SELECT *
    INTO v_outcome
    FROM public.ai_review_analysis_outcomes
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch
      AND analysis_sequence = p_analysis_sequence;
    IF FOUND
      AND v_outcome.event_envelope_id = p_event_envelope_id
      AND (
        (p_disposition = 'pending' AND v_outcome.state = 'pending' AND v_outcome.disposition_code IS NULL)
        OR (
          p_disposition <> 'pending'
          AND v_outcome.state = 'terminal_no_result'
          AND v_outcome.disposition_code = p_disposition
        )
      )
    THEN
      status := 'duplicate';
      consumed_sequence := v_cursor.consumed_sequence;
      terminal_analysis_sequence := v_cursor.terminal_analysis_sequence;
      expected_sequence := NULL;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF p_analysis_sequence <> v_cursor.consumed_sequence + 1 THEN
    status := 'gap';
    consumed_sequence := NULL;
    terminal_analysis_sequence := NULL;
    expected_sequence := v_cursor.consumed_sequence + 1;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.ai_review_analysis_outcomes (
    organization_id, property_id, source_epoch, review_analysis_epoch,
    analysis_sequence, event_envelope_id, operation_id, state,
    disposition_code, created_at, updated_at
  ) VALUES (
    p_organization_id, p_property_id, p_source_epoch, p_review_analysis_epoch,
    p_analysis_sequence, p_event_envelope_id, NULL,
    CASE WHEN p_disposition = 'pending' THEN 'pending' ELSE 'terminal_no_result' END,
    CASE WHEN p_disposition = 'pending' THEN NULL ELSE p_disposition END,
    v_now, v_now
  );

  v_terminal := v_cursor.terminal_analysis_sequence;
  IF p_disposition <> 'pending' AND p_analysis_sequence = v_terminal + 1 THEN
    v_terminal := p_analysis_sequence;
  END IF;
  UPDATE public.ai_review_event_cursors
  SET
    consumed_sequence = p_analysis_sequence,
    terminal_analysis_sequence = v_terminal,
    last_consumed_event_id = p_event_envelope_id,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch;

  status := 'accepted';
  consumed_sequence := p_analysis_sequence;
  terminal_analysis_sequence := v_terminal;
  expected_sequence := NULL;
  RETURN NEXT;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enforce_ai_admission_cost_reservation_binding_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
CREATE OR REPLACE FUNCTION public.guard_ai_review_analysis_enrollment_membership_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting(
         'repkey.ai_review_enrollment_membership_writer',
         true
       ) IS DISTINCT FROM 'canonical-v1'
       OR NOT EXISTS (
         SELECT 1
         FROM "ai_review_analysis_enrollments" AS enrollment
         WHERE enrollment."id" = NEW."enrollment_id"
           AND enrollment."organization_id" = NEW."organization_id"
           AND enrollment."property_id" = NEW."property_id"
           AND enrollment."state" IN ('awaiting_assisted_approval', 'queued')
           AND enrollment."source_epoch" = NEW."source_epoch"
           AND NEW."ordinal" < enrollment."snapshot_revision_count"
           AND NEW."analysis_sequence" <= enrollment."analysis_start_sequence"
       ) THEN
      RAISE EXCEPTION 'Review Analysis membership may only be captured while opening its enrollment'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Review Analysis enrollment membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('repkey.ai_review_enrollment_eraser', true) = 'lifecycle-v1' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_enrollments" AS enrollment
    WHERE enrollment."id" = OLD."enrollment_id"
      AND enrollment."organization_id" = OLD."organization_id"
      AND enrollment."property_id" = OLD."property_id"
  ) THEN
    RAISE EXCEPTION 'Review Analysis enrollment membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_ai_review_analysis_enrollment_replay_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "ai_review_analysis_enrollments" AS enrollment
      JOIN "ai_review_analysis_backfill_runs" AS run
        ON run."id" = NEW."run_id"
       AND run."organization_id" = NEW."organization_id"
       AND run."property_id" = NEW."property_id"
      WHERE enrollment."id" = NEW."enrollment_id"
        AND enrollment."organization_id" = NEW."organization_id"
        AND enrollment."property_id" = NEW."property_id"
        AND enrollment."state" IN ('queued', 'running')
        AND run."state" = 'running'
        AND run."reason_code" = 'first_enablement_enrollment_v1'
        AND run."source_epoch" = enrollment."source_epoch"
        AND run."review_analysis_epoch" = enrollment."review_analysis_epoch"
        AND run."analysis_start_sequence" = enrollment."analysis_start_sequence"
    ) THEN
      RAISE EXCEPTION 'Review Analysis enrollment replay fence is invalid'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Review Analysis enrollment replay is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF current_setting('repkey.ai_review_enrollment_eraser', true) = 'lifecycle-v1' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_enrollments" AS enrollment
    WHERE enrollment."id" = OLD."enrollment_id"
  ) AND EXISTS (
    SELECT 1
    FROM "ai_review_analysis_backfill_runs" AS run
    WHERE run."id" = OLD."run_id"
  ) THEN
    RAISE EXCEPTION 'Review Analysis enrollment replay is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_ai_review_analysis_enrollment_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS DISTINCT FROM OLD."id"
       OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
       OR NEW."property_id" IS DISTINCT FROM OLD."property_id"
       OR NEW."authorization_lineage_id" IS DISTINCT FROM OLD."authorization_lineage_id"
       OR NEW."authorization_state_version" IS DISTINCT FROM OLD."authorization_state_version"
       OR NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
       OR NEW."review_analysis_epoch" IS DISTINCT FROM OLD."review_analysis_epoch"
       OR NEW."analysis_start_sequence" IS DISTINCT FROM OLD."analysis_start_sequence"
       OR NEW."provider_deployment_profile_version" IS DISTINCT FROM OLD."provider_deployment_profile_version"
       OR NEW."trigger_event_envelope_id" IS DISTINCT FROM OLD."trigger_event_envelope_id"
       OR NEW."snapshot_revision_count" IS DISTINCT FROM OLD."snapshot_revision_count"
       OR NEW."snapshot_revision_set_digest" IS DISTINCT FROM OLD."snapshot_revision_set_digest"
       OR NEW."snapshot_captured_at" IS DISTINCT FROM OLD."snapshot_captured_at"
       OR NEW."safety_ceiling" IS DISTINCT FROM OLD."safety_ceiling"
       OR NEW."assisted_approval_required" IS DISTINCT FROM OLD."assisted_approval_required"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Review Analysis enrollment authority is immutable'
        USING ERRCODE = '55000';
    END IF;

    IF OLD."state" IN ('caught_up', 'superseded', 'stalled') THEN
      RAISE EXCEPTION 'Terminal Review Analysis enrollment is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF (
      NEW."assisted_approved_at" IS DISTINCT FROM OLD."assisted_approved_at"
      OR NEW."assisted_approved_by" IS DISTINCT FROM OLD."assisted_approved_by"
      OR NEW."assisted_approval_evidence_digest"
        IS DISTINCT FROM OLD."assisted_approval_evidence_digest"
      OR NEW."assisted_approval_correlation_id"
        IS DISTINCT FROM OLD."assisted_approval_correlation_id"
    ) AND NOT (
      OLD."state" = 'awaiting_assisted_approval'
      AND NEW."state" = 'queued'
      AND OLD."assisted_approved_at" IS NULL
      AND OLD."assisted_approved_by" IS NULL
      AND OLD."assisted_approval_evidence_digest" IS NULL
      AND OLD."assisted_approval_correlation_id" IS NULL
      AND NEW."assisted_approved_at" IS NOT NULL
      AND NEW."assisted_approved_by" IS NOT NULL
      AND NEW."assisted_approval_evidence_digest" IS NOT NULL
      AND NEW."assisted_approval_correlation_id" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Review Analysis enrollment approval evidence is immutable'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."state" NOT IN (
         'awaiting_assisted_approval', 'queued', 'running', 'caught_up',
         'superseded', 'stalled'
       )
       OR (
         OLD."state" = 'awaiting_assisted_approval'
         AND NEW."state" NOT IN ('queued', 'superseded', 'stalled')
       )
       OR (
         OLD."state" <> 'awaiting_assisted_approval'
         AND NEW."state" = 'awaiting_assisted_approval'
       )
       OR (
         OLD."state" = 'awaiting_assisted_approval'
         AND NEW."state" = 'queued'
         AND (
           NEW."assisted_approved_at" IS NULL
           OR NEW."assisted_approved_by" IS NULL
           OR NEW."assisted_approval_evidence_digest" IS NULL
           OR NEW."assisted_approval_correlation_id" IS NULL
         )
       )
       OR (OLD."state" = 'running' AND NEW."state" = 'queued')
       OR NEW."enrolled_revision_count" < OLD."enrolled_revision_count"
       OR NEW."updated_at" < OLD."updated_at" THEN
      RAISE EXCEPTION 'Review Analysis enrollment transition is invalid'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('repkey.ai_review_enrollment_eraser', true) = 'lifecycle-v1' THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "properties" AS property
    WHERE property."organization_id" = OLD."organization_id"
      AND property."id" = OLD."property_id"
  ) THEN
    RAISE EXCEPTION 'Review Analysis enrollment may only be lifecycle-erased'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_ai_review_backfill_membership_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "ai_review_analysis_backfill_runs" AS run
      WHERE run."id" = NEW."run_id"
        AND run."organization_id" = NEW."organization_id"
        AND run."property_id" = NEW."property_id"
        AND run."state" = 'running'
        AND run."emitted_review_count" = 0
        AND run."skipped_review_count" = 0
        AND NEW."ordinal" < run."requested_review_count"
        AND (
          run."reason_code" <> 'first_enablement_enrollment_v1'
          OR NEW."source_revision" IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'AI review-analysis membership may only be enrolled while opening a run'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'AI review-analysis membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_review_analysis_backfill_runs" AS run
    WHERE run."id" = OLD."run_id"
      AND run."organization_id" = OLD."organization_id"
      AND run."property_id" = OLD."property_id"
  ) THEN
    RAISE EXCEPTION 'AI review-analysis membership is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
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
CREATE OR REPLACE FUNCTION public.guard_identity_invitation_fact_contract_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  active_version smallint;
  supplied_email text;
BEGIN
  IF NEW."event_type" <> 'identity.member.invited' THEN
    RETURN NEW;
  END IF;

  SELECT "issuance_version"
  INTO active_version
  FROM "identity_invitation_fact_contract"
  WHERE "singleton" = true
  FOR SHARE;

  IF active_version IS NULL THEN
    RAISE EXCEPTION 'identity invitation fact contract row is missing';
  END IF;
  IF jsonb_typeof(NEW."payload") <> 'object' THEN
    RAISE EXCEPTION 'identity invitation fact payload must be an object';
  END IF;

  supplied_email := NEW."payload" ->> 'email';
  IF active_version = 1 THEN
    NEW."event_version" := 1;
    NEW."payload" := jsonb_set(
      NEW."payload" - 'email',
      '{email}',
      to_jsonb('[redacted]'::text),
      true
    );
    RETURN NEW;
  END IF;

  IF supplied_email IS NOT NULL AND supplied_email <> '[redacted]' THEN
    RAISE EXCEPTION 'legacy identity invitation fact producer is not permitted after v2 cutover';
  END IF;
  NEW."event_version" := 2;
  NEW."payload" := NEW."payload" - 'email';
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
CREATE OR REPLACE FUNCTION public.guard_organization_lifecycle_policy_fence_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  target_organization_id text;
  attempts_to_clear boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_organization_id := OLD."organization_id";
    attempts_to_clear := true;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
      RAISE EXCEPTION 'organization policy cannot change tenant';
    END IF;
    target_organization_id := NEW."organization_id";
    attempts_to_clear := NEW."suspended_at" IS NULL;
  END IF;

  IF attempts_to_clear AND EXISTS (
    SELECT 1
    FROM "organization_lifecycle_authority" AS lifecycle
    WHERE lifecycle."organization_id" = target_organization_id
      AND (lifecycle."state" <> 'active' OR lifecycle."reactivation_required" = true)
  ) THEN
    RAISE EXCEPTION 'organization lifecycle fence requires explicit reactivation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
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
CREATE OR REPLACE FUNCTION public.issue_ai_canary_authorization_v1(p_release_sha text, p_canary_profile_version text, p_expected_head_generation integer, p_expected_stop_fence jsonb, p_nonce text, p_operator_user_id text)
 RETURNS TABLE(operation_id uuid, permit_id uuid, attempt_number integer, deadline_epoch_millis bigint, canary_authorization_id uuid, canary_authorization_generation integer, release_sha text, canary_profile_version text, safety_identifier_profile_version text, provider_deployment_profile_version text, operation_profile_version text, global_control_id uuid, global_generation integer, provider_control_id uuid, provider_generation integer, review_analysis_control_id uuid, review_analysis_generation integer, reply_drafting_control_id uuid, reply_drafting_generation integer, property_trends_control_id uuid, property_trends_generation integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_global public.ai_execution_control_heads%ROWTYPE;
  v_provider public.ai_execution_control_heads%ROWTYPE;
  v_review_analysis public.ai_execution_control_heads%ROWTYPE;
  v_reply_drafting public.ai_execution_control_heads%ROWTYPE;
  v_property_trends public.ai_execution_control_heads%ROWTYPE;
  v_head public.ai_canary_authorization_heads%ROWTYPE;
  v_current public.ai_canary_authorizations%ROWTYPE;
  v_operation public.ai_operations%ROWTYPE;
  v_attempt public.ai_operation_attempts%ROWTYPE;
  v_permit public.ai_execution_permits%ROWTYPE;
  v_stop_fence jsonb;
  v_predecessor_id uuid;
  v_authorization_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_permit_id uuid := gen_random_uuid();
  v_now timestamp with time zone := transaction_timestamp();
  v_authorization_expires_at timestamp with time zone;
  v_deadline timestamp with time zone;
  v_idempotency_scope text;
  v_idempotency_key text;
  v_profile_bytes bytea;
BEGIN
  IF p_release_sha IS NULL
    OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_canary_profile_version IS NULL
    OR p_canary_profile_version <> 'synthetic-canary-v1'
    OR p_expected_head_generation IS NULL
    OR p_expected_head_generation < 1
    OR p_expected_stop_fence IS NULL
    OR jsonb_typeof(p_expected_stop_fence) <> 'object'
    OR p_nonce IS NULL
    OR p_nonce !~ '^[0-9a-f]{64}$'
    OR p_operator_user_id IS NULL
    OR length(p_operator_user_id) NOT BETWEEN 1 AND 255
    OR p_operator_user_id !~ '^[A-Za-z0-9][-A-Za-z0-9._@:/+]{0,254}$'
  THEN
    RAISE EXCEPTION 'Invalid AI canary authorization request'
      USING ERRCODE = '22023';
  END IF;

  -- Operator authority is established before this database boundary by the
  -- sole ops:ai-canary entry point: --operator is byte-matched against the
  -- trimmed, non-empty OPS_OPERATOR_IDENTITIES allowlist, ExecutionPolicy
  -- authorizes the global operator action, and the decision audit is flushed
  -- before its database pool closes. This function stores only that canonical
  -- ASCII audit identity; it does not reinterpret it as an application user.

  PERFORM pg_advisory_xact_lock(public.ai_advisory_lock_key_v1(
    'canary-release|' || p_release_sha || '|' || p_canary_profile_version
  ));

  SELECT * INTO v_global
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_provider
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'provider:private-beta-global-v1'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_review_analysis
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:review_analysis'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_reply_drafting
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:reply_drafting'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_property_trends
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:property_trends'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_stop_fence := jsonb_build_object(
    'globalControlId', v_global.control_id,
    'globalGeneration', v_global.generation,
    'providerControlId', v_provider.control_id,
    'providerGeneration', v_provider.generation,
    'allCapabilityStopFences', jsonb_build_array(
      jsonb_build_object(
        'capability', 'review_analysis',
        'capabilityControlId', v_review_analysis.control_id,
        'capabilityGeneration', v_review_analysis.generation
      ),
      jsonb_build_object(
        'capability', 'reply_drafting',
        'capabilityControlId', v_reply_drafting.control_id,
        'capabilityGeneration', v_reply_drafting.generation
      ),
      jsonb_build_object(
        'capability', 'property_trends',
        'capabilityControlId', v_property_trends.control_id,
        'capabilityGeneration', v_property_trends.generation
      )
    )
  );
  IF p_expected_stop_fence IS DISTINCT FROM v_stop_fence
    OR v_global.execution_state <> 'enabled'
    OR v_global.admission_state <> 'accepting'
    OR v_provider.execution_state <> 'enabled'
    OR v_provider.admission_state <> 'accepting'
    OR v_review_analysis.execution_state <> 'killed'
    OR v_review_analysis.admission_state <> 'draining'
    OR v_reply_drafting.execution_state <> 'killed'
    OR v_reply_drafting.admission_state <> 'draining'
    OR v_property_trends.execution_state <> 'killed'
    OR v_property_trends.admission_state <> 'draining'
  THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ai_provider_deployment_profiles AS provider_profile
    WHERE provider_profile.profile_version = 'private-beta-global-v1'
      AND provider_profile.profile_digest =
        '6713cb00ea9b50f2f4bb2133b1a622466dce04c36ce1c6c6ae91b446ec026681'
      AND provider_profile.provider = 'openai'
      AND provider_profile.model_snapshot = 'gpt-5.6-luna'
  )
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_operation_profiles AS operation_profile
      WHERE operation_profile.profile_version = p_canary_profile_version
        AND operation_profile.profile_digest =
          'dd9997d6a1f88c11fb5b22bbaa8d449138345d05b2b7528f9f559ddad5b6fd17'
        AND operation_profile.command = 'synthetic_canary'
        AND operation_profile.capability IS NULL
        AND operation_profile.purpose = 'ai.synthetic_canary'
        AND operation_profile.source_route = 'synthetic-canary'
        AND operation_profile.gateway_path = 'internal:synthetic-canary'
        AND operation_profile.caller_role = 'release_canary'
        AND operation_profile.capability_runtime_profile_version IS NULL
        AND operation_profile.provider_deployment_profile_version =
          'private-beta-global-v1'
        AND operation_profile.artifact_attestations->>'canaryProfileVersion' =
          p_canary_profile_version
        AND operation_profile.artifact_attestations->
          'safetyIdentifierProfileVersion' =
          to_jsonb('synthetic-canary-safety-v1'::text)
        AND operation_profile.artifact_attestations->'promptCacheShard' = '0'::jsonb
        AND operation_profile.request_deadline_ms = 70000
    )
    OR (
      SELECT count(*)
      FROM public.ai_provider_deployment_capabilities AS membership
      WHERE membership.provider_deployment_profile_version =
          'private-beta-global-v1'
        AND membership.catalogue_digest =
          '3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168'
        AND (membership.capability, membership.runtime_profile_version) IN (
          ('review_analysis', 'review-analysis-runtime-v1'),
          ('reply_drafting', 'reply-drafting-runtime-v1'),
          ('property_trends', 'property-trends-runtime-v1')
        )
    ) <> 3
    OR (
      SELECT count(*)
      FROM public.ai_provider_deployment_capabilities AS membership
      WHERE membership.provider_deployment_profile_version =
        'private-beta-global-v1'
    ) <> 3
  THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_canary_authorization_heads (
    release_sha, canary_profile_version, head_id, transition_generation,
    next_authorization_generation, current_authorization_id,
    current_operation_id, current_permit_id, state, updated_at
  )
  SELECT
    p_release_sha, p_canary_profile_version, gen_random_uuid(), 1,
    1, NULL, NULL, NULL, 'eligible', v_now
  WHERE p_expected_head_generation = 1
  ON CONFLICT ON CONSTRAINT ai_canary_authorization_heads_pk DO NOTHING;

  SELECT * INTO v_head
  FROM public.ai_canary_authorization_heads AS authorization_head
  WHERE authorization_head.release_sha = p_release_sha
    AND authorization_head.canary_profile_version = p_canary_profile_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_head.state = 'issued' THEN
    IF p_expected_head_generation <> v_head.transition_generation - 1
    THEN RETURN; END IF;
    SELECT * INTO v_current
    FROM public.ai_canary_authorizations AS current_authorization
    WHERE current_authorization.id = v_head.current_authorization_id
    FOR UPDATE;
    v_profile_bytes := convert_to(p_canary_profile_version, 'UTF8');
    v_idempotency_scope := encode(sha256(
      convert_to('synthetic_canary', 'UTF8') || decode('00', 'hex') ||
      convert_to(p_release_sha, 'UTF8')
    ), 'hex');
    v_idempotency_key := encode(sha256(
      convert_to('ai-canary-operation-v1', 'UTF8') || decode('00', 'hex') ||
      decode(p_release_sha, 'hex') ||
      int2send(octet_length(v_profile_bytes)::smallint) ||
      v_profile_bytes ||
      int4send(v_current.authorization_generation)
    ), 'hex');
    SELECT * INTO v_operation
    FROM public.ai_operations AS current_operation
    WHERE current_operation.id = v_head.current_operation_id
    FOR UPDATE;
    SELECT * INTO v_attempt
    FROM public.ai_operation_attempts AS current_attempt
    WHERE current_attempt.operation_id = v_head.current_operation_id
      AND current_attempt.attempt = 1
    FOR UPDATE;
    SELECT * INTO v_permit
    FROM public.ai_execution_permits AS current_permit
    WHERE current_permit.id = v_head.current_permit_id
    FOR UPDATE;
    IF v_current.id IS NULL
      OR v_operation.id IS NULL
      OR v_attempt.operation_id IS NULL
      OR v_permit.id IS NULL
      OR v_current.state <> 'issued'
      OR v_current.nonce <> p_nonce
      OR v_head.next_authorization_generation <>
        v_current.authorization_generation + 1
      OR v_current.operator_user_id <> p_operator_user_id
      OR v_current.expires_at <> v_current.issued_at + interval '5 minutes'
      OR v_operation.command <> 'synthetic_canary'
      OR v_operation.state <> 'executing'
      OR v_operation.execution_attempt <> 1
      OR v_operation.canary_authorization_id <> v_current.id
      OR v_operation.canary_authorization_generation <>
        v_current.authorization_generation
      OR v_operation.release_sha <> p_release_sha
      OR v_operation.canary_profile_version <> p_canary_profile_version
      OR v_operation.provider_deployment_profile_version <>
        'private-beta-global-v1'
      OR v_operation.idempotency_scope <> v_idempotency_scope
      OR v_operation.idempotency_key <> v_idempotency_key
      OR v_operation.request_fingerprint <> v_idempotency_key
      OR v_operation.created_at <> v_current.issued_at
      OR (v_operation.expires_at > v_now
        AND v_operation.expires_at <> v_current.issued_at + interval '70 seconds')
      OR v_operation.operation_profile_version <> 'synthetic-canary-v1'
      OR v_operation.global_control_id <> v_global.control_id
      OR v_operation.global_control_generation <> v_global.generation
      OR v_operation.provider_control_id <> v_provider.control_id
      OR v_operation.provider_control_generation <> v_provider.generation
      OR v_operation.capability_fences <>
        v_stop_fence->'allCapabilityStopFences'
      OR v_attempt.state <> 'executing'
      OR v_attempt.started_at <> v_current.issued_at
      OR v_permit.operation_id <> v_operation.id
      OR v_permit.execution_attempt <> 1
      OR v_permit.global_control_id <> v_global.control_id
      OR v_permit.global_control_generation <> v_global.generation
      OR v_permit.provider_control_id <> v_provider.control_id
      OR v_permit.provider_control_generation <> v_provider.generation
      OR v_permit.capability_control_id IS NOT NULL
      OR v_permit.capability_control_generation IS NOT NULL
      OR v_permit.state <> 'issued'
      OR v_permit.route <> 'synthetic-canary'
      OR v_permit.admitted_at <> v_current.issued_at
      OR v_permit.expires_at <> v_operation.expires_at
    THEN
      RETURN;
    END IF;
    IF v_current.expires_at <= v_now
      OR v_operation.expires_at <= v_now
      OR v_permit.expires_at <= v_now
    THEN
      PERFORM public.terminalize_unconsumed_ai_canary_authorization_v1(
        v_current.id, v_head.transition_generation, 'expired'
      );
      RETURN;
    END IF;

    operation_id := v_operation.id;
    permit_id := v_permit.id;
    attempt_number := 1;
    deadline_epoch_millis := public.ai_epoch_millis_v1(v_operation.expires_at);
    canary_authorization_id := v_current.id;
    canary_authorization_generation := v_current.authorization_generation;
    release_sha := p_release_sha;
    canary_profile_version := p_canary_profile_version;
    safety_identifier_profile_version := 'synthetic-canary-safety-v1';
    provider_deployment_profile_version := 'private-beta-global-v1';
    operation_profile_version := 'synthetic-canary-v1';
    global_control_id := v_global.control_id;
    global_generation := v_global.generation;
    provider_control_id := v_provider.control_id;
    provider_generation := v_provider.generation;
    review_analysis_control_id := v_review_analysis.control_id;
    review_analysis_generation := v_review_analysis.generation;
    reply_drafting_control_id := v_reply_drafting.control_id;
    reply_drafting_generation := v_reply_drafting.generation;
    property_trends_control_id := v_property_trends.control_id;
    property_trends_generation := v_property_trends.generation;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_head.state <> 'eligible'
    OR v_head.transition_generation <> p_expected_head_generation
    OR v_head.next_authorization_generation > 3
  THEN
    RETURN;
  END IF;

  IF v_head.next_authorization_generation > 1 THEN
    SELECT prior.id INTO v_predecessor_id
    FROM public.ai_canary_authorizations AS prior
    WHERE prior.release_sha = p_release_sha
      AND prior.canary_profile_version = p_canary_profile_version
      AND prior.authorization_generation =
        v_head.next_authorization_generation - 1;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  v_profile_bytes := convert_to(p_canary_profile_version, 'UTF8');
  v_idempotency_scope := encode(sha256(
    convert_to('synthetic_canary', 'UTF8') || decode('00', 'hex') ||
    convert_to(p_release_sha, 'UTF8')
  ), 'hex');
  v_idempotency_key := encode(sha256(
    convert_to('ai-canary-operation-v1', 'UTF8') || decode('00', 'hex') ||
    decode(p_release_sha, 'hex') ||
    int2send(octet_length(v_profile_bytes)::smallint) ||
    v_profile_bytes ||
    int4send(v_head.next_authorization_generation)
  ), 'hex');
  IF EXISTS (
    SELECT 1
    FROM public.ai_operations AS existing_operation
    WHERE existing_operation.idempotency_scope = v_idempotency_scope
      AND existing_operation.idempotency_key = v_idempotency_key
    FOR UPDATE
  ) THEN
    RETURN;
  END IF;

  v_authorization_expires_at := v_now + interval '5 minutes';
  v_deadline := v_now + interval '70 seconds';
  INSERT INTO public.ai_canary_authorizations (
    id, release_sha, canary_profile_version, authorization_generation,
    predecessor_authorization_id, nonce, operator_user_id, state,
    issued_at, expires_at, settled_at
  ) VALUES (
    v_authorization_id, p_release_sha, p_canary_profile_version,
    v_head.next_authorization_generation, v_predecessor_id, p_nonce,
    p_operator_user_id, 'issued', v_now, v_authorization_expires_at, NULL
  );

  INSERT INTO public.ai_operations (
    id, idempotency_scope, idempotency_key, request_fingerprint,
    command, capability, organization_id, property_id, actor_user_id,
    system_principal, release_sha, canary_authorization_id,
    canary_authorization_generation, canary_profile_version,
    provider_deployment_profile_version, operation_profile_version,
    capability_runtime_profile_version, global_control_id,
    global_control_generation, provider_control_id,
    provider_control_generation, capability_control_id,
    capability_control_generation, capability_fences, state,
    execution_attempt, next_attempt_at, failure_code, created_at,
    updated_at, expires_at, delivered_at
  ) VALUES (
    v_operation_id, v_idempotency_scope, v_idempotency_key, v_idempotency_key,
    'synthetic_canary', NULL, NULL, NULL, NULL, 'release_canary',
    p_release_sha, v_authorization_id, v_head.next_authorization_generation,
    p_canary_profile_version, 'private-beta-global-v1',
    'synthetic-canary-v1', NULL, v_global.control_id, v_global.generation,
    v_provider.control_id, v_provider.generation, NULL, NULL,
    v_stop_fence->'allCapabilityStopFences', 'executing', 1, NULL, NULL,
    v_now, v_now, v_deadline, NULL
  );
  INSERT INTO public.ai_operation_attempts (
    operation_id, attempt, state, failure_code, started_at, settled_at,
    model_snapshot, input_tokens, output_tokens
  ) VALUES (
    v_operation_id, 1, 'executing', NULL, v_now, NULL, NULL, NULL, NULL
  );
  INSERT INTO public.ai_execution_permits (
    id, operation_id, execution_attempt, global_control_id,
    global_control_generation, provider_control_id,
    provider_control_generation, capability_control_id,
    capability_control_generation, admitted_at, expires_at, route
  ) VALUES (
    v_permit_id, v_operation_id, 1, v_global.control_id, v_global.generation,
    v_provider.control_id, v_provider.generation, NULL, NULL,
    v_now, v_deadline, 'synthetic-canary'
  );
  UPDATE public.ai_canary_authorization_heads
  SET
    transition_generation = v_head.transition_generation + 1,
    next_authorization_generation = v_head.next_authorization_generation + 1,
    current_authorization_id = v_authorization_id,
    current_operation_id = v_operation_id,
    current_permit_id = v_permit_id,
    state = 'issued',
    updated_at = v_now
  WHERE ai_canary_authorization_heads.release_sha = p_release_sha
    AND ai_canary_authorization_heads.canary_profile_version =
      p_canary_profile_version;

  operation_id := v_operation_id;
  permit_id := v_permit_id;
  attempt_number := 1;
  deadline_epoch_millis := public.ai_epoch_millis_v1(v_deadline);
  canary_authorization_id := v_authorization_id;
  canary_authorization_generation := v_head.next_authorization_generation;
  release_sha := p_release_sha;
  canary_profile_version := p_canary_profile_version;
  safety_identifier_profile_version := 'synthetic-canary-safety-v1';
  provider_deployment_profile_version := 'private-beta-global-v1';
  operation_profile_version := 'synthetic-canary-v1';
  global_control_id := v_global.control_id;
  global_generation := v_global.generation;
  provider_control_id := v_provider.control_id;
  provider_generation := v_provider.generation;
  review_analysis_control_id := v_review_analysis.control_id;
  review_analysis_generation := v_review_analysis.generation;
  reply_drafting_control_id := v_reply_drafting.control_id;
  reply_drafting_generation := v_reply_drafting.generation;
  property_trends_control_id := v_property_trends.control_id;
  property_trends_generation := v_property_trends.generation;
  RETURN NEXT;
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
CREATE OR REPLACE FUNCTION public.mirror_legacy_ai_review_backfill_memberships_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF cardinality(NEW."review_ids") > 0
     AND current_setting(
       'repkey.ai_review_backfill_membership_writer',
       true
     ) IS DISTINCT FROM 'canonical-v1' THEN
    INSERT INTO "ai_review_analysis_backfill_run_memberships" (
      "run_id", "organization_id", "property_id", "ordinal", "review_id", "created_at"
    )
    SELECT NEW."id", NEW."organization_id", NEW."property_id",
           pinned."ordinality" - 1, pinned."review_id", NEW."created_at"
    FROM unnest(NEW."review_ids")
      WITH ORDINALITY AS pinned("review_id", "ordinality");
  END IF;
  RETURN NEW;
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
CREATE OR REPLACE FUNCTION public.purge_ai_reply_drafts_for_authorization_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."state" IS DISTINCT FROM OLD."state"
    OR NEW."capabilities" IS DISTINCT FROM OLD."capabilities"
    OR NEW."capability_runtime_profile_versions" IS DISTINCT FROM OLD."capability_runtime_profile_versions"
    OR NEW."reply_drafting_epoch" IS DISTINCT FROM OLD."reply_drafting_epoch"
    OR NEW."authorized_source_epoch" IS DISTINCT FROM OLD."authorized_source_epoch"
    OR NEW."authorization_lineage_id" IS DISTINCT FROM OLD."authorization_lineage_id"
    OR NEW."provider_deployment_profile_version" IS DISTINCT FROM OLD."provider_deployment_profile_version"
  THEN
    DELETE FROM "replies" AS reply
    USING "reviews" AS review
    WHERE reply."review_id" = review."id"
      AND reply."organization_id" = review."organization_id"
      AND review."property_id" = NEW."property_id"
      AND review."organization_id" = NEW."organization_id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_ai_reply_drafts_for_control_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."control_id" IS DISTINCT FROM OLD."control_id"
    OR NEW."generation" IS DISTINCT FROM OLD."generation"
    OR NEW."execution_state" IS DISTINCT FROM OLD."execution_state"
    OR NEW."admission_state" IS DISTINCT FROM OLD."admission_state"
  THEN
    DELETE FROM "replies" AS reply
    USING "ai_operations" AS operation
    WHERE reply."origin_operation_id" = operation."id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized')
      AND (
        (NEW."scope_kind" = 'global')
        OR (
          NEW."scope_kind" = 'provider_deployment_profile'
          AND operation."provider_deployment_profile_version" = NEW."scope_value"
        )
        OR (
          NEW."scope_kind" = 'capability'
          AND NEW."scope_value" = 'reply_drafting'
          AND operation."capability" = 'reply_drafting'
        )
      );
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_ai_reply_drafts_for_profile_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
    OR NEW."profile_version" IS DISTINCT FROM OLD."profile_version"
    OR NEW."lifecycle_state" IS DISTINCT FROM OLD."lifecycle_state"
    OR NEW."provider_deployment_profile_version" IS DISTINCT FROM OLD."provider_deployment_profile_version"
  THEN
    DELETE FROM "replies" AS reply
    USING "reviews" AS review
    WHERE reply."review_id" = review."id"
      AND reply."organization_id" = review."organization_id"
      AND review."property_id" = NEW."property_id"
      AND review."organization_id" = NEW."organization_id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_ai_reply_drafts_for_property_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
    OR NEW."lifecycle_state" IS DISTINCT FROM OLD."lifecycle_state"
    OR NEW."deleted_at" IS DISTINCT FROM OLD."deleted_at"
  THEN
    DELETE FROM "replies" AS reply
    USING "reviews" AS review
    WHERE reply."review_id" = review."id"
      AND reply."organization_id" = review."organization_id"
      AND review."property_id" = NEW."id"
      AND review."organization_id" = NEW."organization_id"
      AND reply."authorship" = 'ai_assisted'
      AND (reply."publication_state" IS NULL OR reply."publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.purge_ai_reply_drafts_for_review_change_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW."source_epoch" IS DISTINCT FROM OLD."source_epoch"
    OR NEW."source_revision" IS DISTINCT FROM OLD."source_revision"
    OR NEW."content_expires_at" IS DISTINCT FROM OLD."content_expires_at"
  THEN
    DELETE FROM "replies"
    WHERE "review_id" = NEW."id"
      AND "organization_id" = NEW."organization_id"
      AND "authorship" = 'ai_assisted'
      AND ("publication_state" IS NULL OR "publication_state" = 'authorized');
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reap_expired_ai_canary_authorizations_v1(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_candidate record;
  v_reaped integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid AI canary reaper limit'
      USING ERRCODE = '22023';
  END IF;
  FOR v_candidate IN
    SELECT
      auth_row.id AS authorization_id,
      auth_head.transition_generation AS head_generation
    FROM public.ai_canary_authorizations AS auth_row
    INNER JOIN public.ai_canary_authorization_heads AS auth_head
      ON auth_head.release_sha = auth_row.release_sha
     AND auth_head.canary_profile_version = auth_row.canary_profile_version
     AND auth_head.current_authorization_id = auth_row.id
     AND auth_head.state = 'issued'
    INNER JOIN public.ai_operations AS operation_row
      ON operation_row.id = auth_head.current_operation_id
     AND operation_row.canary_authorization_id = auth_row.id
     AND operation_row.command = 'synthetic_canary'
     AND operation_row.state = 'executing'
    INNER JOIN public.ai_execution_permits AS permit_row
      ON permit_row.id = auth_head.current_permit_id
     AND permit_row.operation_id = operation_row.id
     AND permit_row.state = 'issued'
    WHERE auth_row.state = 'issued'
      AND (
        auth_row.expires_at <= transaction_timestamp()
        OR operation_row.expires_at <= transaction_timestamp()
        OR permit_row.expires_at <= transaction_timestamp()
      )
    ORDER BY LEAST(
      auth_row.expires_at, operation_row.expires_at, permit_row.expires_at
    ), auth_row.id
    LIMIT p_limit
  LOOP
    IF public.terminalize_unconsumed_ai_canary_authorization_v1(
      v_candidate.authorization_id,
      v_candidate.head_generation,
      'expired'
    ) = 'terminalized' THEN
      v_reaped := v_reaped + 1;
    END IF;
  END LOOP;
  RETURN v_reaped;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reap_expired_ai_execution_permits_v1(p_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_ai_canary_authorization_head_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI canary authorization heads cannot be deleted';
  END IF;
  IF NEW.release_sha <> OLD.release_sha
    OR NEW.canary_profile_version <> OLD.canary_profile_version
    OR NEW.head_id <> OLD.head_id
    OR NEW.transition_generation <> OLD.transition_generation + 1
    OR NEW.updated_at < OLD.updated_at
    OR NOT (
      (
        OLD.state = 'eligible'
        AND NEW.state = 'issued'
        AND NEW.next_authorization_generation = OLD.next_authorization_generation + 1
      )
      OR (
        OLD.state = 'issued'
        AND NEW.state IN ('eligible', 'in_flight')
        AND NEW.next_authorization_generation = OLD.next_authorization_generation
      )
      OR (
        OLD.state = 'in_flight'
        AND NEW.state IN ('eligible', 'passed', 'terminal_failed')
        AND NEW.next_authorization_generation = OLD.next_authorization_generation
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid AI canary authorization head transition';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_ai_canary_authorization_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI canary authorizations cannot be deleted';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.release_sha <> OLD.release_sha
    OR NEW.canary_profile_version <> OLD.canary_profile_version
    OR NEW.authorization_generation <> OLD.authorization_generation
    OR NEW.predecessor_authorization_id IS DISTINCT FROM OLD.predecessor_authorization_id
    OR NEW.nonce <> OLD.nonce
    OR NEW.operator_user_id <> OLD.operator_user_id
    OR NEW.issued_at <> OLD.issued_at
    OR NEW.expires_at <> OLD.expires_at
    OR NOT (
      (
        OLD.state = 'issued'
        AND NEW.state IN ('consumed', 'revoked', 'expired', 'released_no_dispatch')
      )
      OR (
        OLD.state = 'consumed'
        AND NEW.state IN ('released_no_dispatch', 'passed', 'terminal_failed')
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid AI canary authorization transition';
  END IF;
  RETURN NEW;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_ai_catalogue_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'AI catalogue and history rows are immutable';
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
CREATE OR REPLACE FUNCTION public.reject_ai_read_barrier_mutation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI read barrier heads cannot be deleted or truncated';
  END IF;
  IF NEW.scope_kind <> OLD.scope_kind
    OR NEW.scope_id <> OLD.scope_id
    OR NEW.domain_version <> OLD.domain_version
    OR NEW.created_at <> OLD.created_at
    OR OLD.state <> 'open'
    OR NEW.state <> 'closing'
    OR NEW.generation <> OLD.generation + 1
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Invalid AI read barrier transition';
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
CREATE OR REPLACE FUNCTION public.reject_context_lifecycle_receipt_mutation_v1()
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
  IF TG_TABLE_NAME = 'privacy_request_transitions' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'privacy_request_transitions is append-only';
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

  IF TG_TABLE_NAME = 'property_erase_context_receipts' THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'property_erase_context_receipts is append-only';
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
CREATE OR REPLACE FUNCTION public.reposition_merchant_ai_analysis_watermark_v1(p_organization_id character varying, p_property_id uuid, p_reason_code character varying, p_idempotency_key character varying, p_request_hash character varying, p_occurred_at timestamp with time zone)
 RETURNS TABLE(source_epoch integer, analysis_start_sequence bigint, review_analysis_epoch integer, state_version integer, consent_actor_user_id character varying)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  replay public.merchant_ai_consent_evidence%ROWTYPE;
  current_head public.merchant_ai_enablement%ROWTYPE;
  property_source_epoch integer;
  property_lifecycle_state text;
  property_binding_state text;
  property_deleted_at timestamp with time zone;
  review_head_sequence bigint;
  next_state_version integer;
  next_review_analysis_epoch integer;
  consent_actor_id varchar;
  actor_role text;
BEGIN
  IF p_organization_id IS NULL OR length(p_organization_id) NOT BETWEEN 1 AND 255
    OR p_property_id IS NULL
    OR p_reason_code IS NULL OR length(p_reason_code) NOT BETWEEN 1 AND 64
    OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128
    OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
    OR p_occurred_at IS NULL
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_transition_input' USING ERRCODE = '22023';
  END IF;

  -- Replay: the operator command retries are at-least-once, and a second
  -- reposition would burn a second epoch for no reason.
  SELECT * INTO replay
  FROM public.merchant_ai_consent_evidence
  WHERE merchant_ai_consent_evidence.organization_id = p_organization_id
    AND merchant_ai_consent_evidence.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF FOUND THEN
    IF replay.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'merchant_ai_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    source_epoch := replay.authorized_source_epoch;
    analysis_start_sequence := replay.analysis_start_sequence;
    review_analysis_epoch := replay.review_analysis_epoch;
    state_version := replay.state_version;
    consent_actor_user_id := replay.actor_user_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- FOR UPDATE, not FOR SHARE: `lock_review_ai_analysis_head_v1` takes the same
  -- row lock, so holding it for the caller's whole transaction is exactly what
  -- makes the sequences this backfill allocates an uninterrupted H+1..H+N run.
  -- Every column below is table-qualified on purpose: the RETURNS TABLE output
  -- parameters (`source_epoch`, `analysis_start_sequence`,
  -- `review_analysis_epoch`, `state_version`) share names with real columns,
  -- and plpgsql raises `column reference ... is ambiguous` on a bare reference.
  SELECT properties.lifecycle_state, properties.google_binding_state,
         properties.deleted_at, properties.source_epoch
  INTO property_lifecycle_state, property_binding_state, property_deleted_at,
       property_source_epoch
  FROM public.properties
  WHERE properties.organization_id = p_organization_id
    AND properties.id = p_property_id
  FOR UPDATE;
  IF NOT FOUND
    OR property_deleted_at IS NOT NULL
    OR property_lifecycle_state <> 'active'
    OR property_binding_state <> 'active'
  THEN
    RAISE EXCEPTION 'merchant_ai_property_inactive' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO current_head
  FROM public.merchant_ai_enablement
  WHERE merchant_ai_enablement.organization_id = p_organization_id
    AND merchant_ai_enablement.property_id = p_property_id
  FOR UPDATE;
  IF NOT FOUND
    OR current_head.state <> 'enabled'
    OR NOT ('review_analysis' = ANY (current_head.capabilities))
    OR current_head.authorized_source_epoch <> property_source_epoch
  THEN
    RAISE EXCEPTION 'merchant_ai_review_analysis_not_authorized' USING ERRCODE = '42501';
  END IF;

  -- The accountable actor, carried forward from the consent this replays: the
  -- LATEST genuine merchant consent decision at or below the locked head.
  -- `analysis_backfill` is excluded because it is not a decision — inheriting
  -- from one would let a single bad run poison every future run of an
  -- append-only lineage, which is exactly what it did.
  --
  -- Bounded by the head's `state_version` rather than unbounded, because the
  -- consent being spent is the one in force AT the head. Under this
  -- transaction's `FOR UPDATE` on the head no higher row can appear, so the
  -- bound is a statement of intent as much as a guard.
  --
  -- `state_version = 1` is always an 'enable' or a 'restore_reset', so a live
  -- lineage always has a qualifying row; the NOT FOUND branch is the guard for
  -- a future lineage change, not a reachable state today. Refusing is the only
  -- safe answer either way: with no prior consent decision there is nobody
  -- whose consent this backfill could be replaying.
  SELECT evidence.actor_user_id INTO consent_actor_id
  FROM public.merchant_ai_consent_evidence AS evidence
  WHERE evidence.authorization_lineage_id = current_head.authorization_lineage_id
    AND evidence.state_version <= current_head.state_version
    AND evidence.transition_kind IN ('enable', 'change', 'revoke', 'restore_reset')
  ORDER BY evidence.state_version DESC
  LIMIT 1
  FOR SHARE;
  IF NOT FOUND OR consent_actor_id IS NULL THEN
    RAISE EXCEPTION 'merchant_ai_backfill_consent_actor_absent' USING ERRCODE = '42501';
  END IF;

  -- Same predicate as consent-taking and admission: owner, or admin with a live
  -- grant on this property. An actor who fails here would be denied
  -- `authorization_changed` on every replayed operation, so refusing now costs
  -- an operator one message instead of a burnt epoch and N dead sequences.
  SELECT member.role INTO actor_role
  FROM public.member
  WHERE member."organizationId" = p_organization_id
    AND member."userId" = consent_actor_id
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
          SELECT 1
          FROM public.property_access_grant
          WHERE property_access_grant.organization_id = p_organization_id
            AND property_access_grant.property_id = p_property_id
            AND property_access_grant.user_id = consent_actor_id
            AND property_access_grant.revoked_at IS NULL
            AND (
              property_access_grant.expires_at IS NULL
              OR property_access_grant.expires_at > p_occurred_at
            )
        )
      )
    )
  THEN
    RAISE EXCEPTION 'merchant_ai_backfill_consent_actor_denied' USING ERRCODE = '42501';
  END IF;

  SELECT review_ai_analysis_heads.head_sequence INTO review_head_sequence
  FROM public.review_ai_analysis_heads
  WHERE review_ai_analysis_heads.organization_id = p_organization_id
    AND review_ai_analysis_heads.property_id = p_property_id
    AND review_ai_analysis_heads.source_epoch = property_source_epoch
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant_ai_review_head_unavailable' USING ERRCODE = '42501';
  END IF;

  next_state_version := current_head.state_version + 1;
  next_review_analysis_epoch := current_head.review_analysis_epoch + 1;

  PERFORM set_config('repkey.merchant_ai_transition', '1', true);
  INSERT INTO public.merchant_ai_consent_evidence (
    authorization_lineage_id, state_version, organization_id, property_id,
    transition_kind, state, capabilities, capability_runtime_profile_versions,
    review_analysis_epoch, reply_drafting_epoch, property_trends_epoch,
    authorized_source_epoch, analysis_start_sequence, notice_version, notice_digest,
    source_policy_id, routing_policy_version, processing_region,
    provider_deployment_profile_version, redaction_profile_family,
    actor_user_id, reason_code, idempotency_key, request_hash, occurred_at
  ) VALUES (
    current_head.authorization_lineage_id, next_state_version, p_organization_id,
    p_property_id, 'analysis_backfill', current_head.state, current_head.capabilities,
    current_head.capability_runtime_profile_versions,
    next_review_analysis_epoch, current_head.reply_drafting_epoch,
    current_head.property_trends_epoch, current_head.authorized_source_epoch,
    review_head_sequence, current_head.notice_version, current_head.notice_digest,
    current_head.source_policy_id, current_head.routing_policy_version,
    current_head.processing_region, current_head.provider_deployment_profile_version,
    current_head.redaction_profile_family, consent_actor_id, p_reason_code,
    p_idempotency_key, p_request_hash, p_occurred_at
  );

  UPDATE public.merchant_ai_enablement
  SET review_analysis_epoch = next_review_analysis_epoch,
      analysis_start_sequence = review_head_sequence,
      state_version = next_state_version,
      updated_by = consent_actor_id,
      updated_at = p_occurred_at
  WHERE merchant_ai_enablement.property_id = p_property_id
    AND merchant_ai_enablement.organization_id = p_organization_id;

  -- The caller keeps working in this transaction (allocating sequences,
  -- writing outbox rows); leaving the guard escape hatch open for the rest of
  -- it would let an unrelated statement edit the consent ledger unguarded.
  PERFORM set_config('repkey.merchant_ai_transition', '0', true);

  source_epoch := property_source_epoch;
  analysis_start_sequence := review_head_sequence;
  review_analysis_epoch := next_review_analysis_epoch;
  state_version := next_state_version;
  consent_actor_user_id := consent_actor_id;
  RETURN NEXT;
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.resolve_ai_property_local_date_v1(p_reviewed_at timestamp with time zone, p_timezone text, p_calendar_profile_version text)
 RETURNS date
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE STRICT
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_authority public.ai_property_calendar_authorities%ROWTYPE;
  v_epoch_millis_function_digest text;
  v_local_date_function_digest text;
  v_local_midnight_function_digest text;
  v_vector_digest text;
  v_postgres_major integer;
BEGIN
  IF p_calendar_profile_version <> 'property-calendar-v1' THEN RETURN NULL; END IF;
  SELECT *
  INTO v_authority
  FROM public.ai_property_calendar_authorities
  WHERE profile_version = p_calendar_profile_version;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_epoch_millis_function_digest := encode(
    sha256(convert_to(pg_get_functiondef(
      'public.ai_epoch_millis_v1(timestamptz)'::regprocedure
    ), 'UTF8')),
    'hex'
  );
  v_local_date_function_digest := encode(
    sha256(convert_to(pg_get_functiondef(
      'public.ai_property_local_date_v1(timestamptz,text)'::regprocedure
    ), 'UTF8')),
    'hex'
  );
  v_local_midnight_function_digest := encode(
    sha256(convert_to(pg_get_functiondef(
      'public.ai_property_local_midnight_v1(date,text)'::regprocedure
    ), 'UTF8')),
    'hex'
  );
  v_vector_digest := encode(
    sha256(convert_to(v_authority.test_vectors::text, 'UTF8')),
    'hex'
  );
  v_postgres_major := current_setting('server_version_num')::integer / 10000;
  IF v_authority.epoch_millis_function_name <> 'ai_epoch_millis_v1'
    OR v_authority.epoch_millis_function_digest <> v_epoch_millis_function_digest
    OR v_authority.local_date_function_name <> 'ai_property_local_date_v1'
    OR v_authority.local_date_function_digest <> v_local_date_function_digest
    OR v_authority.local_midnight_function_name <> 'ai_property_local_midnight_v1'
    OR v_authority.local_midnight_function_digest <> v_local_midnight_function_digest
    OR v_authority.image_digest <> '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20'
    OR v_authority.vector_digest <> v_vector_digest
    OR v_authority.vector_count <> jsonb_array_length(v_authority.test_vectors)
    OR v_authority.tested_postgres_major_versions <> ARRAY[16,17]::integer[]
    OR v_postgres_major NOT IN (16,17)
  THEN
    RETURN NULL;
  END IF;
  RETURN public.ai_property_local_date_v1(p_reviewed_at, p_timezone);
END;
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.resolve_ai_runtime_capability_v1(p_provider_deployment_profile_version text, p_capability text, p_catalogue_digest text)
 RETURNS TABLE(runtime_profile_version character varying, operation_profile_version character varying, gateway_profile_version character varying, notice_version character varying, notice_digest character varying, resolved_catalogue_digest character varying)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_provider_count integer;
  v_routing_count integer;
  v_operation_count integer;
  v_runtime_count integer;
  v_membership_count integer;
BEGIN
  SELECT count(*) INTO v_provider_count FROM public.ai_provider_deployment_profiles;
  SELECT count(*) INTO v_routing_count FROM public.ai_routing_policies;
  SELECT count(*) INTO v_operation_count FROM public.ai_operation_profiles;
  SELECT count(*) INTO v_runtime_count FROM public.ai_runtime_capability_profiles;
  SELECT count(*) INTO v_membership_count FROM public.ai_provider_deployment_capabilities;

  IF v_provider_count <> 1
    OR v_routing_count <> 1
    OR v_operation_count <> 4
    OR v_runtime_count <> 3
    OR v_membership_count <> 3
  THEN
    RAISE EXCEPTION 'AI runtime catalogue is incomplete'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    runtime_profile.runtime_profile_version,
    runtime_profile.operation_profile_version,
    runtime_profile.gateway_profile_version,
    runtime_profile.notice_version,
    runtime_profile.notice_digest,
    runtime_profile.catalogue_digest
  FROM public.ai_provider_deployment_capabilities AS membership
  INNER JOIN public.ai_runtime_capability_profiles AS runtime_profile
    ON runtime_profile.provider_deployment_profile_version = membership.provider_deployment_profile_version
   AND runtime_profile.capability = membership.capability
   AND runtime_profile.runtime_profile_version = membership.runtime_profile_version
  INNER JOIN public.ai_operation_profiles AS operation_profile
    ON operation_profile.profile_version = runtime_profile.operation_profile_version
   AND operation_profile.capability = runtime_profile.capability
   AND operation_profile.capability_runtime_profile_version = runtime_profile.runtime_profile_version
   AND operation_profile.provider_deployment_profile_version = runtime_profile.provider_deployment_profile_version
  INNER JOIN public.ai_provider_deployment_profiles AS provider_profile
    ON provider_profile.profile_version = runtime_profile.provider_deployment_profile_version
  INNER JOIN public.ai_routing_policies AS routing_policy
    ON routing_policy.provider_deployment_profile_version = provider_profile.profile_version
  WHERE membership.provider_deployment_profile_version = p_provider_deployment_profile_version
    AND membership.capability = p_capability
    AND membership.catalogue_digest = p_catalogue_digest
    AND runtime_profile.catalogue_digest = p_catalogue_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI runtime capability is unavailable'
      USING ERRCODE = 'P0001';
  END IF;
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
CREATE OR REPLACE FUNCTION public.settle_ai_execution_v1(p_request jsonb, p_receipt_kid character varying)
 RETURNS TABLE(status text, code text, grant_kid text, request_binding_hmac text, disposition text, usage_known boolean, provider_retryable boolean, input_tokens integer, cached_input_tokens integer, output_tokens integer, reasoning_tokens integer, cost_micros bigint, settled_at_epoch_millis bigint, settlement_state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.settle_ai_review_analysis_outcome_v1(p_organization_id text, p_property_id uuid, p_source_epoch integer, p_review_analysis_epoch integer, p_analysis_sequence bigint, p_state text, p_operation_id uuid, p_disposition_code text)
 RETURNS TABLE(terminal_analysis_sequence bigint, aggregate_revision bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_cursor public.ai_review_event_cursors%ROWTYPE;
  v_outcome public.ai_review_analysis_outcomes%ROWTYPE;
  v_terminal bigint;
  v_next_state text;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_state NOT IN ('ready', 'terminal_no_result')
    OR (p_state = 'ready' AND (p_operation_id IS NULL OR p_disposition_code IS NOT NULL))
    OR (
      p_state = 'terminal_no_result'
      AND p_disposition_code NOT IN (
        'language_not_supported', 'source_expired', 'provider_deleted', 'policy_disabled'
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid AI review analysis outcome'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id || ':' || p_property_id::text, 0)
  );
  SELECT *
  INTO v_cursor
  FROM public.ai_review_event_cursors
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT *
  INTO v_outcome
  FROM public.ai_review_analysis_outcomes
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
    AND analysis_sequence = p_analysis_sequence
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_outcome.state = 'pending' THEN
    UPDATE public.ai_review_analysis_outcomes
    SET
      state = p_state,
      operation_id = p_operation_id,
      disposition_code = p_disposition_code,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch
      AND analysis_sequence = p_analysis_sequence;
  ELSIF v_outcome.state <> p_state
    OR v_outcome.operation_id IS DISTINCT FROM p_operation_id
    OR v_outcome.disposition_code IS DISTINCT FROM p_disposition_code
  THEN
    RETURN;
  END IF;

  v_terminal := v_cursor.terminal_analysis_sequence;
  LOOP
    SELECT state
    INTO v_next_state
    FROM public.ai_review_analysis_outcomes
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch
      AND analysis_sequence = v_terminal + 1;
    EXIT WHEN NOT FOUND OR v_next_state = 'pending';
    v_terminal := v_terminal + 1;
  END LOOP;

  IF v_terminal <> v_cursor.terminal_analysis_sequence THEN
    UPDATE public.ai_review_event_cursors
    SET terminal_analysis_sequence = v_terminal, updated_at = v_now
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch;
  END IF;

  terminal_analysis_sequence := v_terminal;
  aggregate_revision := v_cursor.aggregate_revision;
  RETURN NEXT;
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
            AND NOT EXISTS (
              SELECT 1
              FROM public.organization_policy AS organization_policy
              WHERE organization_policy.organization_id = permit.organization_id
                AND organization_policy.suspended_at IS NOT NULL
            )
            AND (
              permit.capability::text IN ('property.connect_gbp', 'property.publish_reply')
              OR EXISTS (
                SELECT 1
                FROM public.organization_capability AS organization_capability
                WHERE organization_capability.organization_id = permit.organization_id
                  AND organization_capability.capability = permit.capability::text
              )
            )
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
                NOT EXISTS (
                  SELECT 1
                  FROM public.property_policy AS property_policy
                  WHERE property_policy.property_id = permit.property_id
                    AND property_policy.suspended_at IS NOT NULL
                )
                AND (
                  permit.capability::text IN ('property.connect_gbp', 'property.publish_reply')
                  OR EXISTS (
                    SELECT 1
                    FROM public.property_capability AS property_capability
                    WHERE property_capability.property_id = permit.property_id
                      AND property_capability.capability = permit.capability::text
                  )
                )
                AND (
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
              AND NOT EXISTS (
                SELECT 1
                FROM public.organization_policy AS organization_policy
                WHERE organization_policy.organization_id = permit.organization_id
                  AND organization_policy.suspended_at IS NOT NULL
              )
              AND EXISTS (
                SELECT 1
                FROM public.organization_capability AS organization_capability
                WHERE organization_capability.organization_id = permit.organization_id
                  AND organization_capability.capability = permit.capability::text
              )
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
    FROM public.google_disconnect_revoke_attempts AS attempt
    WHERE attempt.cleanup_work_permit_id = p_permit_id
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
            FROM public.google_disconnect_revoke_attempts AS attempt
            INNER JOIN public.google_connections AS connection
              ON connection.organization_id = attempt.organization_id
             AND connection.id = attempt.connection_id
            -- WP2.2: approval ceremony removed; see start_…_v1. Everything
            -- below is the disconnect-revoke state machine, which is exactly
            -- what this branch exists to prove.
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
CREATE OR REPLACE FUNCTION public.terminalize_unconsumed_ai_canary_authorization_v1(p_authorization_id uuid, p_expected_head_generation integer, p_terminal_state text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_discovered record;
  v_head public.ai_canary_authorization_heads%ROWTYPE;
  v_authorization public.ai_canary_authorizations%ROWTYPE;
  v_operation public.ai_operations%ROWTYPE;
  v_attempt public.ai_operation_attempts%ROWTYPE;
  v_permit public.ai_execution_permits%ROWTYPE;
  v_now timestamp with time zone := transaction_timestamp();
  v_failure_code text;
  v_control public.ai_execution_control_heads%ROWTYPE;
BEGIN
  IF p_authorization_id IS NULL
    OR p_expected_head_generation IS NULL
    OR p_expected_head_generation < 1
    OR p_terminal_state IS NULL
    OR p_terminal_state NOT IN ('revoked', 'expired')
  THEN
    RAISE EXCEPTION 'Invalid AI canary terminal request'
      USING ERRCODE = '22023';
  END IF;

  SELECT release_sha, canary_profile_version
  INTO v_discovered
  FROM public.ai_canary_authorizations
  WHERE id = p_authorization_id;
  IF NOT FOUND THEN RETURN 'denied'; END IF;

  PERFORM pg_advisory_xact_lock(public.ai_advisory_lock_key_v1(
    'canary-release|' || v_discovered.release_sha || '|' ||
      v_discovered.canary_profile_version
  ));
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'provider:private-beta-global-v1'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:review_analysis'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:reply_drafting'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:property_trends'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;

  SELECT * INTO v_head
  FROM public.ai_canary_authorization_heads
  WHERE release_sha = v_discovered.release_sha
    AND canary_profile_version = v_discovered.canary_profile_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_authorization
  FROM public.ai_canary_authorizations
  WHERE id = p_authorization_id
    AND release_sha = v_head.release_sha
    AND canary_profile_version = v_head.canary_profile_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_operation
  FROM public.ai_operations
  WHERE canary_authorization_id = v_authorization.id
    AND canary_authorization_generation =
      v_authorization.authorization_generation
    AND command = 'synthetic_canary'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_attempt
  FROM public.ai_operation_attempts
  WHERE operation_id = v_operation.id AND attempt = 1
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_permit
  FROM public.ai_execution_permits
  WHERE operation_id = v_operation.id AND execution_attempt = 1
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;

  IF v_authorization.state = p_terminal_state THEN
    IF v_head.state = 'eligible'
      AND v_head.transition_generation = p_expected_head_generation + 1
      AND v_head.current_authorization_id IS NULL
      AND v_head.current_operation_id IS NULL
      AND v_head.current_permit_id IS NULL
      AND v_operation.state = 'cancelled'
      AND v_attempt.state = 'cancelled'
      AND v_permit.state = 'released'
    THEN
      RETURN 'replayed';
    END IF;
    RETURN 'denied';
  END IF;
  IF v_head.transition_generation <> p_expected_head_generation
    OR v_head.state <> 'issued'
    OR v_head.current_authorization_id <> v_authorization.id
    OR v_head.current_operation_id <> v_operation.id
    OR v_head.current_permit_id <> v_permit.id
    OR v_authorization.state <> 'issued'
    OR (
      p_terminal_state = 'expired'
      AND v_authorization.expires_at > v_now
      AND v_operation.expires_at > v_now
      AND v_permit.expires_at > v_now
    )
    OR v_operation.state <> 'executing'
    OR v_operation.execution_attempt <> 1
    OR v_attempt.state <> 'executing'
    OR v_permit.state <> 'issued'
    OR v_permit.route <> 'synthetic-canary'
  THEN
    RETURN 'denied';
  END IF;

  v_failure_code := CASE p_terminal_state
    WHEN 'revoked' THEN 'canary_authorization_revoked'
    ELSE 'canary_authorization_expired'
  END;
  UPDATE public.ai_operation_attempts
  SET state = 'cancelled', failure_code = v_failure_code, settled_at = v_now
  WHERE operation_id = v_operation.id AND attempt = 1 AND state = 'executing';
  UPDATE public.ai_operations
  SET state = 'cancelled', failure_code = v_failure_code,
    next_attempt_at = NULL, updated_at = v_now
  WHERE id = v_operation.id AND state = 'executing';
  UPDATE public.ai_execution_permits
  SET state = 'released'
  WHERE id = v_permit.id AND state = 'issued';
  UPDATE public.ai_canary_authorizations
  SET state = p_terminal_state, settled_at = v_now
  WHERE id = v_authorization.id AND state = 'issued';
  UPDATE public.ai_canary_authorization_heads
  SET
    transition_generation = v_head.transition_generation + 1,
    current_authorization_id = NULL,
    current_operation_id = NULL,
    current_permit_id = NULL,
    state = 'eligible',
    updated_at = v_now
  WHERE release_sha = v_head.release_sha
    AND canary_profile_version = v_head.canary_profile_version
    AND transition_generation = v_head.transition_generation
    AND state = 'issued';
  RETURN CASE WHEN FOUND THEN 'terminalized' ELSE 'denied' END;
END;
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
  v_canary_state text;
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
    SELECT authorization_head.state
    INTO v_canary_state
    FROM public.ai_canary_authorization_heads AS authorization_head
    WHERE authorization_head.release_sha = p_candidate_release_sha
      AND authorization_head.canary_profile_version = 'synthetic-canary-v1'
      AND EXISTS (
        SELECT 1
        FROM public.ai_operations AS canary_operation
        WHERE canary_operation.id = authorization_head.current_operation_id
          AND canary_operation.command = 'synthetic_canary'
          AND canary_operation.state = 'succeeded'
          AND canary_operation.provider_deployment_profile_version =
            p_provider_deployment_profile_version
      )
    FOR UPDATE;
    IF NOT FOUND OR v_canary_state <> 'passed' THEN RETURN; END IF;
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
CREATE OR REPLACE FUNCTION public.assert_ai_read_delivery_v1(p_organization_id text, p_property_id uuid, p_actor_user_id text, p_organization_generation integer, p_property_generation integer, p_actor_generation integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.ai_read_barrier_heads
      WHERE scope_kind = 'organization'
        AND scope_id = p_organization_id
        AND generation = p_organization_generation
        AND state = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM public.ai_read_barrier_heads
      WHERE scope_kind = 'property'
        AND scope_id = p_property_id::text
        AND generation = p_property_generation
        AND state = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM public.ai_read_barrier_heads
      WHERE scope_kind = 'actor'
        AND scope_id = p_actor_user_id
        AND generation = p_actor_generation
        AND state = 'open'
    );
$function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.assert_ai_runtime_catalogue_ready_v1(p_provider_deployment_profile_version text, p_provider_deployment_profile_digest text, p_runtime_capability_catalogue_digest text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    p_provider_deployment_profile_version = 'private-beta-global-v1'
    AND p_provider_deployment_profile_digest = '6713cb00ea9b50f2f4bb2133b1a622466dce04c36ce1c6c6ae91b446ec026681'
    AND p_runtime_capability_catalogue_digest = '3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168'
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_provider_deployment_profiles AS row_value) = '[{"profile_version":"private-beta-global-v1","region":"global","provider":"openai","model_snapshot":"gpt-5.6-luna","reasoning_effort":"route-profile-effort","service_tier":"default","store":false,"response_api_version":"responses-v1","deployment_contract":{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"24h","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","evidence":{"retrievalDate":"2026-08-19","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.6-luna","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"pricing":{"catalogueId":"openai-gpt-5.6-luna-standard-2026-08-19","modelSnapshot":"gpt-5.6-luna","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":200000,"cachedInputMicros":20000,"outputMicros":1200000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-19"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}},"profile_digest":"6713cb00ea9b50f2f4bb2133b1a622466dce04c36ce1c6c6ae91b446ec026681"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY version), '[]'::jsonb) FROM public.ai_routing_policies AS row_value) = '[{"version":1,"region":"global","provider_deployment_profile_version":"private-beta-global-v1","policy_digest":"8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"}},"artifact_attestations_digest":"1c047ce51c7a3e22e1f01f351d31fc143931d39afe7ee733fc68b2264521298d","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"ef4e9c260475568d60c94766411f1bb441352ab03c40f93a0f49ed53ab22570f"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"f9a503bf9283e43cc73f5cc4a0592cd1b780003703c66d49ee53e7d16b9fecf7","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v2","personalizedReplyProfileDigest":"6694c03ef6ad41a8d590a6302f5d73c7185a1c30daca02f156c87c3e777cf540"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"}},"artifact_attestations_digest":"cd70af3bce770fee59afa47ec0bcc1d6ff5854e552bfa21cd1502fd505e9bb76","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1562,"static_token_bearing_digest":"22e13e6b90a157522d472d4f3e614c7d6a963f8bdce3966a95f1aafc08dfc72c","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"1483e274bbc3c7371fa45fedcdb977d2766e6c26fc5cb46d2785fe50d4db11cf"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"df34437016d742e69ebfce7376b8c32601e24198c74f95ad02ea0f0c7a17863e","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"c7ef222537cb4f3dd1352da672f28ad3ab089fab0503d5f4a9f67c4e8207b82a","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1253,"static_token_bearing_digest":"f4920f0c542d1eef653599d6dbfcd03759a7f8b5580032b23000db2e9ed8f0bf","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"fcc91b9580ee1abce4ef32da094168fc8d0cef6dc2b575beb72bf3e66a066963"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"}},"artifact_attestations_digest":"c70948b7f461c8c8128346cbae55c9128bdd1bc51a135df06200538a6334ab22","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":512,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"dd9997d6a1f88c11fb5b22bbaa8d449138345d05b2b7528f9f559ddad5b6fd17"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY runtime_profile_version), '[]'::jsonb) FROM public.ai_runtime_capability_profiles AS row_value) = '[{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-09-06.v1","notice_digest":"7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8","catalogue_digest":"3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168"},{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-09-06.v1","notice_digest":"7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8","catalogue_digest":"3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168"},{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-09-06.v1","notice_digest":"7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8","catalogue_digest":"3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY capability), '[]'::jsonb) FROM public.ai_provider_deployment_capabilities AS row_value) = '[{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"3f3ba2b3ee92d0a96411f316fac683f546101c15e7cb689879bb47909eb4e168"}]'::jsonb;
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
CREATE OR REPLACE FUNCTION public.revoke_ai_canary_authorization_v1(p_authorization_id uuid, p_expected_head_generation integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT public.terminalize_unconsumed_ai_canary_authorization_v1(
    p_authorization_id, p_expected_head_generation, 'revoked'
  ) IN ('terminalized', 'replayed');
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
CREATE TRIGGER ai_admission_cost_reservations_binding_guard BEFORE INSERT OR UPDATE ON public.ai_admission_cost_reservations FOR EACH ROW EXECUTE FUNCTION enforce_ai_admission_cost_reservation_binding_v1();
--> statement-breakpoint
CREATE TRIGGER ai_canary_authorization_heads_no_truncate BEFORE TRUNCATE ON public.ai_canary_authorization_heads FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_canary_authorization_heads_transition_guard BEFORE DELETE OR UPDATE ON public.ai_canary_authorization_heads FOR EACH ROW EXECUTE FUNCTION reject_ai_canary_authorization_head_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_canary_authorizations_no_truncate BEFORE TRUNCATE ON public.ai_canary_authorizations FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_canary_authorizations_transition_guard BEFORE DELETE OR UPDATE ON public.ai_canary_authorizations FOR EACH ROW EXECUTE FUNCTION reject_ai_canary_authorization_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_execution_control_heads_transition_guard BEFORE DELETE OR UPDATE ON public.ai_execution_control_heads FOR EACH ROW EXECUTE FUNCTION reject_ai_execution_control_head_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_execution_controls_purge_ai_reply_drafts AFTER UPDATE ON public.ai_execution_control_heads FOR EACH ROW EXECUTE FUNCTION purge_ai_reply_drafts_for_control_change_v1();
--> statement-breakpoint
CREATE TRIGGER ai_control_history_immutable BEFORE DELETE OR UPDATE ON public.ai_execution_control_transitions FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_control_history_no_truncate BEFORE TRUNCATE ON public.ai_execution_control_transitions FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_governance_policies_immutable BEFORE DELETE OR UPDATE ON public.ai_governance_policies FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_governance_policies_no_truncate BEFORE TRUNCATE ON public.ai_governance_policies FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_operation_profiles_immutable BEFORE DELETE OR UPDATE ON public.ai_operation_profiles FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_operation_profiles_no_truncate BEFORE TRUNCATE ON public.ai_operation_profiles FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_property_calendar_catalogues_immutable BEFORE DELETE OR UPDATE ON public.ai_property_calendar_authorities FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_property_calendar_catalogues_no_truncate BEFORE TRUNCATE ON public.ai_property_calendar_authorities FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_property_profiles_purge_ai_reply_drafts AFTER UPDATE ON public.ai_property_processing_profiles FOR EACH ROW EXECUTE FUNCTION purge_ai_reply_drafts_for_profile_change_v1();
--> statement-breakpoint
CREATE TRIGGER ai_provider_deployment_capabilities_immutable BEFORE DELETE OR UPDATE ON public.ai_provider_deployment_capabilities FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_provider_deployment_capabilities_no_truncate BEFORE TRUNCATE ON public.ai_provider_deployment_capabilities FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_provider_profiles_immutable BEFORE DELETE OR UPDATE ON public.ai_provider_deployment_profiles FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_provider_profiles_no_truncate BEFORE TRUNCATE ON public.ai_provider_deployment_profiles FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_read_barrier_heads_no_truncate BEFORE TRUNCATE ON public.ai_read_barrier_heads FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_read_barrier_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_read_barrier_heads_transition_guard BEFORE DELETE OR UPDATE ON public.ai_read_barrier_heads FOR EACH ROW EXECUTE FUNCTION reject_ai_read_barrier_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_review_backfill_membership_immutable BEFORE INSERT OR DELETE OR UPDATE ON public.ai_review_analysis_backfill_run_memberships FOR EACH ROW EXECUTE FUNCTION guard_ai_review_backfill_membership_v1();
--> statement-breakpoint
CREATE TRIGGER ai_review_backfill_legacy_membership_mirror AFTER INSERT ON public.ai_review_analysis_backfill_runs FOR EACH ROW EXECUTE FUNCTION mirror_legacy_ai_review_backfill_memberships_v1();
--> statement-breakpoint
CREATE TRIGGER ai_review_analysis_enrollment_membership_guard BEFORE INSERT OR DELETE OR UPDATE ON public.ai_review_analysis_enrollment_memberships FOR EACH ROW EXECUTE FUNCTION guard_ai_review_analysis_enrollment_membership_v1();
--> statement-breakpoint
CREATE TRIGGER ai_review_analysis_enrollment_replay_guard BEFORE INSERT OR DELETE OR UPDATE ON public.ai_review_analysis_enrollment_replays FOR EACH ROW EXECUTE FUNCTION guard_ai_review_analysis_enrollment_replay_v1();
--> statement-breakpoint
CREATE TRIGGER ai_review_analysis_enrollment_guard BEFORE DELETE OR UPDATE ON public.ai_review_analysis_enrollments FOR EACH ROW EXECUTE FUNCTION guard_ai_review_analysis_enrollment_v1();
--> statement-breakpoint
CREATE TRIGGER ai_routing_policies_immutable BEFORE DELETE OR UPDATE ON public.ai_routing_policies FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_routing_policies_no_truncate BEFORE TRUNCATE ON public.ai_routing_policies FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_runtime_capability_profiles_immutable BEFORE DELETE OR UPDATE ON public.ai_runtime_capability_profiles FOR EACH ROW EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER ai_runtime_capability_profiles_no_truncate BEFORE TRUNCATE ON public.ai_runtime_capability_profiles FOR EACH STATEMENT EXECUTE FUNCTION reject_ai_catalogue_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER backup_erasure_hold_releases_truncate_guard BEFORE TRUNCATE ON public.backup_erasure_hold_releases FOR EACH STATEMENT EXECUTE FUNCTION reject_backup_erasure_ledger_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER backup_erasure_hold_releases_update_delete_guard BEFORE DELETE OR UPDATE ON public.backup_erasure_hold_releases FOR EACH ROW EXECUTE FUNCTION reject_backup_erasure_ledger_mutation_v1();
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
CREATE TRIGGER context_organization_lifecycle_receipts_truncate_guard BEFORE TRUNCATE ON public.context_organization_lifecycle_receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_context_lifecycle_receipt_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER context_organization_lifecycle_receipts_update_delete_guard BEFORE DELETE OR UPDATE ON public.context_organization_lifecycle_receipts FOR EACH ROW EXECUTE FUNCTION reject_context_lifecycle_receipt_mutation_v1();
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
CREATE TRIGGER identity_organization_lifecycle_receipts_truncate_guard BEFORE TRUNCATE ON public.identity_organization_lifecycle_receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_identity_lifecycle_evidence_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER identity_organization_lifecycle_receipts_update_delete_guard BEFORE DELETE OR UPDATE ON public.identity_organization_lifecycle_receipts FOR EACH ROW EXECUTE FUNCTION reject_identity_lifecycle_evidence_mutation_v1();
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
CREATE TRIGGER merchant_ai_enablement_purge_ai_reply_drafts AFTER UPDATE ON public.merchant_ai_enablement FOR EACH ROW EXECUTE FUNCTION purge_ai_reply_drafts_for_authorization_change_v1();
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
CREATE TRIGGER organization_lifecycle_policy_fence BEFORE INSERT OR DELETE OR UPDATE ON public.organization_policy FOR EACH ROW EXECUTE FUNCTION guard_organization_lifecycle_policy_fence_v1();
--> statement-breakpoint
CREATE TRIGGER organization_role_policy_perm_ver_iud AFTER INSERT OR DELETE OR UPDATE ON public.organization_role_policy FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_app();
--> statement-breakpoint
CREATE TRIGGER identity_invitation_fact_contract_guard BEFORE INSERT OR UPDATE OF event_type, event_version, payload ON public.outbox_events FOR EACH ROW EXECUTE FUNCTION guard_identity_invitation_fact_contract_v1();
--> statement-breakpoint
CREATE TRIGGER portal_publication_activations_history_guard BEFORE UPDATE ON public.portal_publication_activations FOR EACH ROW EXECUTE FUNCTION guard_portal_publication_history_v1();
--> statement-breakpoint
CREATE TRIGGER portal_publication_snapshots_immutable BEFORE UPDATE ON public.portal_publication_snapshots FOR EACH ROW EXECUTE FUNCTION guard_portal_publication_history_v1();
--> statement-breakpoint
CREATE TRIGGER privacy_request_transitions_mutation_guard BEFORE DELETE OR UPDATE ON public.privacy_request_transitions FOR EACH ROW EXECUTE FUNCTION reject_privacy_request_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER privacy_request_transitions_truncate_guard BEFORE TRUNCATE ON public.privacy_request_transitions FOR EACH STATEMENT EXECUTE FUNCTION reject_privacy_request_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER privacy_requests_transition_guard BEFORE DELETE OR UPDATE ON public.privacy_requests FOR EACH ROW EXECUTE FUNCTION reject_privacy_request_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER privacy_requests_truncate_guard BEFORE TRUNCATE ON public.privacy_requests FOR EACH STATEMENT EXECUTE FUNCTION reject_privacy_request_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER properties_purge_ai_reply_drafts AFTER UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION purge_ai_reply_drafts_for_property_change_v1();
--> statement-breakpoint
CREATE TRIGGER property_access_grant_perm_ver_iud AFTER INSERT OR DELETE OR UPDATE ON public.property_access_grant FOR EACH ROW EXECUTE FUNCTION tgr_bump_perm_app();
--> statement-breakpoint
CREATE TRIGGER property_erase_authorities_transition_guard BEFORE DELETE OR UPDATE ON public.property_erase_authorities FOR EACH ROW EXECUTE FUNCTION reject_property_erase_authority_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER property_erase_authorities_truncate_guard BEFORE TRUNCATE ON public.property_erase_authorities FOR EACH STATEMENT EXECUTE FUNCTION reject_property_erase_authority_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER property_erase_context_receipts_mutation_guard BEFORE DELETE OR UPDATE ON public.property_erase_context_receipts FOR EACH ROW EXECUTE FUNCTION reject_property_erase_authority_mutation_v1();
--> statement-breakpoint
CREATE TRIGGER property_erase_context_receipts_truncate_guard BEFORE TRUNCATE ON public.property_erase_context_receipts FOR EACH STATEMENT EXECUTE FUNCTION reject_property_erase_authority_mutation_v1();
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
CREATE TRIGGER reviews_purge_ai_reply_drafts AFTER UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION purge_ai_reply_drafts_for_review_change_v1();
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
