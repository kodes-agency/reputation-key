ALTER TABLE "merchant_ai_consent_evidence"
  ADD CONSTRAINT "merchant_ai_consent_evidence_review_head_fk"
  FOREIGN KEY ("organization_id", "property_id", "authorized_source_epoch")
  REFERENCES "public"."review_ai_analysis_heads"("organization_id", "property_id", "source_epoch")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement"
  ADD CONSTRAINT "merchant_ai_enablement_review_head_fk"
  FOREIGN KEY ("organization_id", "property_id", "authorized_source_epoch")
  REFERENCES "public"."review_ai_analysis_heads"("organization_id", "property_id", "source_epoch")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence"
  ADD CONSTRAINT "merchant_ai_consent_evidence_analysis_sequence_safe"
  CHECK ("analysis_start_sequence" BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement"
  ADD CONSTRAINT "merchant_ai_enablement_analysis_sequence_safe"
  CHECK ("analysis_start_sequence" BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "apply_merchant_ai_transition_v1"(
  p_authorization_lineage_id uuid,
  p_expected_state_version integer,
  p_state_version integer,
  p_organization_id varchar,
  p_property_id uuid,
  p_transition_kind text,
  p_state text,
  p_capabilities text[],
  p_runtime_profiles jsonb,
  p_review_analysis_epoch integer,
  p_reply_drafting_epoch integer,
  p_property_trends_epoch integer,
  p_authorized_source_epoch integer,
  p_analysis_start_sequence bigint,
  p_notice_version varchar,
  p_notice_digest varchar,
  p_source_policy_id varchar,
  p_routing_policy_version integer,
  p_processing_region varchar,
  p_provider_deployment_profile_version varchar,
  p_redaction_profile_family varchar,
  p_actor_user_id varchar,
  p_reason_code varchar,
  p_idempotency_key varchar,
  p_request_hash varchar,
  p_occurred_at timestamp with time zone
) RETURNS merchant_ai_consent_evidence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
    OR p_authorized_source_epoch < 1
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "apply_merchant_ai_transition_v1"(
  uuid, integer, integer, varchar, uuid, text, text, text[], jsonb,
  integer, integer, integer, integer, bigint, varchar, varchar, varchar,
  integer, varchar, varchar, varchar, varchar, varchar, varchar, varchar,
  timestamp with time zone
) FROM PUBLIC;
