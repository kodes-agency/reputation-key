-- Swap the reply-suggestion grant expiries in `admit_ai_property_v1`.
--
-- The function returned the review's content expiry as reply_token_expires_at and
-- LEAST(content_expiry, caller_deadline) as reply_draft_expires_at. Both consumers
-- require the opposite ordering:
--
--   services/ai-egress-gateway/service.ts  grantMatchesInvocation
--     replyTokenExpiresAtEpochMillis <= replyDraftExpiresAtEpochMillis
--   src/shared/ai-internal-transport-contract.ts  validateGrantFields
--     token > draft  ->  'grant fields are inconsistent'
--
-- With a content expiry weeks in the future and a caller deadline ~70s out, the
-- ordering could never hold, so every reply suggestion was refused with
-- `operation_ambiguous` before the connector ran — no provider call, no log, and a
-- `no_dispatch` settlement written by the request's finally block.
--
-- Semantics restored: the token is request-scoped (bounded by the caller deadline),
-- the draft lives until the source content expires.
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
$$;
