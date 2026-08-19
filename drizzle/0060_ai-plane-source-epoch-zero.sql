-- 0060: the AI plane adopts the property domain's source-epoch numbering.
--
-- `properties.source_epoch` is a 0-based source generation: it starts at 0 on
-- creation and advances on a timezone change, a soft delete, or a region move.
-- The review domain agrees (reviews_source_epoch_safe, review_ai_analysis_heads
-- and the registered review.created payload all accept 0), but the AI plane
-- required >= 1 in eleven CHECK constraints and two functions. The effect: AI
-- review analysis, aggregates, trends, reply provenance and the merchant-AI
-- opt-in were all unreachable for any property whose epoch had never been
-- bumped by an unrelated edit. A 256-review import in google-closed-beta
-- produced zero analyses and retried until the events quarantined; the only
-- property that ever worked qualified because someone had changed its timezone.
--
-- Epoch is an opaque generation tag used for keying and fencing, so 0 is a
-- legitimate value and the AI plane now says so. No data changes: every stored
-- row already satisfies >= 0, and no primary key or column type moves.
--
-- 0058 loosened the consume guard alone and the failure just relocated to the
-- cursor CHECK; 0059 restored it. This migration changes the whole domain at
-- once, which is why it supersedes both.

ALTER TABLE public."ai_operations" DROP CONSTRAINT "ai_operations_branch_valid";--> statement-breakpoint
ALTER TABLE public."ai_operations" ADD CONSTRAINT "ai_operations_branch_valid" CHECK (((((command)::text = 'analysis'::text) AND ((capability)::text = 'review_analysis'::text) AND (organization_id IS NOT NULL) AND (property_id IS NOT NULL) AND (actor_user_id IS NULL) AND ((system_principal)::text = 'review_event_consumer'::text) AND (review_id IS NOT NULL) AND (origin_event_id IS NOT NULL) AND ((subject_hmac)::text ~ '^[0-9a-f]{64}$'::text) AND (subject_hmac_key_version IS NOT NULL) AND (source_epoch >= 0) AND (source_revision >= 1) AND (analysis_sequence >= 1) AND ((operation_profile_version)::text = 'review-analysis-v1'::text) AND ((capability_runtime_profile_version)::text = 'review-analysis-runtime-v1'::text)) OR (((command)::text = 'reply'::text) AND ((capability)::text = 'reply_drafting'::text) AND (organization_id IS NOT NULL) AND (property_id IS NOT NULL) AND (actor_user_id IS NOT NULL) AND (system_principal IS NULL) AND (review_id IS NOT NULL) AND (source_epoch >= 0) AND (source_revision >= 1) AND ((tone)::text = ANY ((ARRAY['professional'::character varying, 'friendly'::character varying, 'casual'::character varying])::text[])) AND (base_reply_state_revision >= 0) AND ((operation_profile_version)::text = 'reply-suggestion-v1'::text) AND ((capability_runtime_profile_version)::text = 'reply-drafting-runtime-v1'::text)) OR (((command)::text = 'trend'::text) AND ((capability)::text = 'property_trends'::text) AND (organization_id IS NOT NULL) AND (property_id IS NOT NULL) AND (actor_user_id IS NULL) AND ((system_principal)::text = 'property_trend_coordinator'::text) AND (source_epoch >= 0) AND (due_local_date IS NOT NULL) AND (terminal_analysis_sequence >= 0) AND (aggregate_revision >= 0) AND ((operation_profile_version)::text = 'property-trend-v1'::text) AND ((capability_runtime_profile_version)::text = 'property-trends-runtime-v1'::text)) OR (((command)::text = 'synthetic_canary'::text) AND (capability IS NULL) AND (organization_id IS NULL) AND (property_id IS NULL) AND (actor_user_id IS NULL) AND ((system_principal)::text = 'release_canary'::text) AND ((release_sha)::text ~ '^[0-9a-f]{40}$'::text) AND (canary_authorization_id IS NOT NULL) AND ((canary_authorization_generation >= 1) AND (canary_authorization_generation <= 3)) AND (canary_profile_version IS NOT NULL) AND ((operation_profile_version)::text = 'synthetic-canary-v1'::text) AND (capability_runtime_profile_version IS NULL))));--> statement-breakpoint
ALTER TABLE public."ai_property_aggregate_contributions" DROP CONSTRAINT "ai_property_aggregate_contributions_values_valid";--> statement-breakpoint
ALTER TABLE public."ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_values_valid" CHECK (((source_epoch >= 0) AND ((source_revision >= 1) AND (source_revision <= '9007199254740991'::bigint)) AND ((analysis_sequence >= 1) AND (analysis_sequence <= '9007199254740991'::bigint)) AND (review_analysis_epoch >= 1) AND (property_profile_version >= 1) AND ((rating >= 1) AND (rating <= 5)) AND ((applied_aggregate_revision >= 1) AND (applied_aggregate_revision <= '9007199254740991'::bigint))));--> statement-breakpoint
ALTER TABLE public."ai_property_aggregate_heads" DROP CONSTRAINT "ai_property_aggregate_heads_versions_valid";--> statement-breakpoint
ALTER TABLE public."ai_property_aggregate_heads" ADD CONSTRAINT "ai_property_aggregate_heads_versions_valid" CHECK (((source_epoch >= 0) AND (review_analysis_epoch >= 1) AND (property_profile_version >= 1) AND ((aggregate_revision >= 0) AND (aggregate_revision <= '9007199254740991'::bigint)) AND ((terminal_analysis_sequence >= 0) AND (terminal_analysis_sequence <= '9007199254740991'::bigint))));--> statement-breakpoint
ALTER TABLE public."ai_property_daily_aggregates" DROP CONSTRAINT "ai_property_daily_aggregates_versions_valid";--> statement-breakpoint
ALTER TABLE public."ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_versions_valid" CHECK (((source_epoch >= 0) AND (review_analysis_epoch >= 1) AND (property_profile_version >= 1) AND ((aggregate_revision >= 0) AND (aggregate_revision <= '9007199254740991'::bigint)) AND ((terminal_analysis_sequence >= 0) AND (terminal_analysis_sequence <= '9007199254740991'::bigint))));--> statement-breakpoint
ALTER TABLE public."ai_property_processing_profiles" DROP CONSTRAINT "ai_property_profiles_versions_valid";--> statement-breakpoint
ALTER TABLE public."ai_property_processing_profiles" ADD CONSTRAINT "ai_property_profiles_versions_valid" CHECK (((source_epoch >= 0) AND (profile_version >= 1)));--> statement-breakpoint
ALTER TABLE public."ai_property_trend_schedules" DROP CONSTRAINT "ai_property_trend_schedules_versions_valid";--> statement-breakpoint
ALTER TABLE public."ai_property_trend_schedules" ADD CONSTRAINT "ai_property_trend_schedules_versions_valid" CHECK (((source_epoch >= 0) AND (review_analysis_epoch >= 1) AND (property_trends_epoch >= 1) AND (property_profile_version >= 1) AND ((terminal_analysis_sequence >= 0) AND (terminal_analysis_sequence <= '9007199254740991'::bigint)) AND ((aggregate_revision >= 0) AND (aggregate_revision <= '9007199254740991'::bigint)) AND ((scheduler_generation >= 1) AND (scheduler_generation <= '9007199254740991'::bigint)) AND ((timezone)::text ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'::text)));--> statement-breakpoint
ALTER TABLE public."ai_review_analyses" DROP CONSTRAINT "ai_review_analyses_versions_valid";--> statement-breakpoint
ALTER TABLE public."ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_versions_valid" CHECK (((source_epoch >= 0) AND ((source_revision >= 1) AND (source_revision <= '9007199254740991'::bigint)) AND ((analysis_sequence >= 1) AND (analysis_sequence <= '9007199254740991'::bigint)) AND (review_analysis_epoch >= 1) AND (property_profile_version >= 1)));--> statement-breakpoint
ALTER TABLE public."ai_review_event_cursors" DROP CONSTRAINT "ai_review_event_cursors_sequences_valid";--> statement-breakpoint
ALTER TABLE public."ai_review_event_cursors" ADD CONSTRAINT "ai_review_event_cursors_sequences_valid" CHECK (((source_epoch >= 0) AND (review_analysis_epoch >= 1) AND ((analysis_start_sequence >= 0) AND (analysis_start_sequence <= '9007199254740991'::bigint)) AND ((consumed_sequence >= analysis_start_sequence) AND (consumed_sequence <= '9007199254740991'::bigint)) AND ((terminal_analysis_sequence >= analysis_start_sequence) AND (terminal_analysis_sequence <= consumed_sequence)) AND ((aggregate_revision >= 0) AND (aggregate_revision <= '9007199254740991'::bigint))));--> statement-breakpoint
ALTER TABLE public."merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_versions_valid";--> statement-breakpoint
ALTER TABLE public."merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_versions_valid" CHECK (((state_version >= 1) AND (review_analysis_epoch >= 1) AND (reply_drafting_epoch >= 1) AND (property_trends_epoch >= 1) AND (authorized_source_epoch >= 0) AND (analysis_start_sequence >= 0) AND (routing_policy_version >= 1)));--> statement-breakpoint
ALTER TABLE public."merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_versions_valid";--> statement-breakpoint
ALTER TABLE public."merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_versions_valid" CHECK (((state_version >= 1) AND (review_analysis_epoch >= 1) AND (reply_drafting_epoch >= 1) AND (property_trends_epoch >= 1) AND (authorized_source_epoch >= 0) AND (analysis_start_sequence >= 0) AND (routing_policy_version >= 1)));--> statement-breakpoint
ALTER TABLE public."replies" DROP CONSTRAINT "replies_ai_provenance_valid";--> statement-breakpoint
ALTER TABLE public."replies" ADD CONSTRAINT "replies_ai_provenance_valid" CHECK ((((authorship = 'ai_assisted'::reply_authorship) AND (origin_operation_id IS NOT NULL) AND (origin_source_epoch >= 0) AND (origin_source_revision >= 1) AND ((origin_base_reply_state_revision >= 0) AND (origin_base_reply_state_revision <= '9007199254740991'::bigint)) AND (origin_reply_drafting_epoch >= 1) AND (origin_property_profile_version >= 1) AND ((origin_ai_profile_version)::text = 'reply-suggestion-v1'::text) AND ((origin_reply_template_id)::text = ANY ((ARRAY['appreciation_positive'::character varying, 'appreciation_neutral'::character varying, 'recovery_service'::character varying, 'acknowledge_concern'::character varying])::text[])) AND ((origin_reply_template_catalogue_version)::text = 'gbp-reply-template-catalogue-v1'::text) AND ((origin_reply_template_catalogue_digest)::text = 'dc0e767cfe8aa4694e2b37870e1f9510fe1b56ed4eea0ed91af4655ea3404f33'::text) AND ((origin_template_group)::text = ANY ((ARRAY['en-Latn'::character varying, 'es-Latn'::character varying, 'fr-Latn'::character varying, 'de-Latn'::character varying, 'pt-Latn'::character varying, 'it-Latn'::character varying, 'nl-Latn'::character varying, 'pl-Latn'::character varying, 'tr-Latn'::character varying, 'uk-Cyrl'::character varying, 'ru-Cyrl'::character varying, 'ar-Arab'::character varying, 'he-Hebr'::character varying, 'hi-Deva'::character varying, 'bn-Beng'::character varying, 'ta-Taml'::character varying, 'th-Thai'::character varying, 'vi-Latn'::character varying, 'id-Latn'::character varying, 'zh-Hans'::character varying, 'zh-Hant'::character varying, 'ja-Jpan'::character varying, 'ko-Kore'::character varying])::text[])) AND (((origin_concrete_language_tag)::text = (origin_template_group)::text) OR ((origin_concrete_language_tag)::text ~~ ((origin_template_group)::text || '-%'::text))) AND (ai_draft_expires_at IS NOT NULL)) OR ((origin_operation_id IS NULL) AND (origin_source_epoch IS NULL) AND (origin_source_revision IS NULL) AND (origin_base_reply_state_revision IS NULL) AND (origin_reply_drafting_epoch IS NULL) AND (origin_property_profile_version IS NULL) AND (origin_ai_profile_version IS NULL) AND (origin_reply_template_id IS NULL) AND (origin_reply_template_catalogue_version IS NULL) AND (origin_reply_template_catalogue_digest IS NULL) AND (origin_concrete_language_tag IS NULL) AND (origin_template_group IS NULL) AND (ai_draft_expires_at IS NULL))));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "consume_ai_review_event_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_source_epoch integer,
  p_review_analysis_epoch integer,
  p_analysis_start_sequence bigint,
  p_analysis_sequence bigint,
  p_event_envelope_id uuid,
  p_disposition text
)
RETURNS TABLE (
  status text,
  consumed_sequence bigint,
  terminal_analysis_sequence bigint,
  expected_sequence bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
$$;--> statement-breakpoint
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
$$;--> statement-breakpoint
