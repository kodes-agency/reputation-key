-- Operator-driven AI review-analysis backfill (ops:ai-reanalyze).
--
-- Reprocessing reviews the merchant has ALREADY authorized needs two things
-- the consent surface deliberately cannot express:
--
--   1. a fresh `review_analysis_epoch`, so re-analysing a review does not add a
--      SECOND `ai_property_aggregate_contributions` row for it (the PK carries
--      `analysis_sequence`, so a re-run inside the live epoch double-counts the
--      review in `ai_property_daily_aggregates`);
--   2. `analysis_start_sequence` repositioned to the CURRENT review-analysis
--      head, so `consume_ai_review_event_v1` lazily creates the new epoch's
--      cursor at that head and expects `head + 1` next. Bumping the epoch
--      without moving the watermark would create the cursor at the OLD start
--      and stall it forever waiting for sequences that already flowed under the
--      previous epoch.
--
-- `apply_merchant_ai_transition_v1` cannot do this: 'change' refuses unless
-- capability membership, the execution contract or the source epoch actually
-- moved, it resets the watermark only on those same conditions, and it demands
-- an owner/admin MEMBER as the actor. An operator is not a member, and no
-- merchant setting is changing here.
--
-- This function therefore adds one narrow transition — and NOTHING else. It
-- copies every consent-bearing column (state, capabilities, runtime profiles,
-- notice version/digest, source policy, routing, region, provider profile,
-- redaction family) from the live head verbatim. It cannot enable anything, it
-- cannot add a capability, and it refuses unless the merchant is already
-- `enabled` for `review_analysis` on the property's current source epoch.
-- Consent stays the merchant's; this only replays what they already granted.
--
-- The transition is recorded in `merchant_ai_consent_evidence` under its own
-- kind, `analysis_backfill`, rather than being disguised as a merchant
-- 'change': the evidence ledger is the compliance record of who decided what,
-- and an operator reprocessing run must not read back as a merchant decision.
ALTER TABLE "merchant_ai_consent_evidence"
  DROP CONSTRAINT "merchant_ai_consent_evidence_transition_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence"
  ADD CONSTRAINT "merchant_ai_consent_evidence_transition_valid"
  CHECK ("transition_kind" IN ('enable', 'change', 'revoke', 'restore_reset', 'analysis_backfill'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reposition_merchant_ai_analysis_watermark_v1"(
  p_organization_id varchar,
  p_property_id uuid,
  p_actor_user_id varchar,
  p_reason_code varchar,
  p_idempotency_key varchar,
  p_request_hash varchar,
  p_occurred_at timestamp with time zone
)
RETURNS TABLE (
  source_epoch integer,
  analysis_start_sequence bigint,
  review_analysis_epoch integer,
  state_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
BEGIN
  IF p_organization_id IS NULL OR length(p_organization_id) NOT BETWEEN 1 AND 255
    OR p_property_id IS NULL
    OR p_actor_user_id IS NULL OR length(p_actor_user_id) NOT BETWEEN 1 AND 255
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
    current_head.redaction_profile_family, p_actor_user_id, p_reason_code,
    p_idempotency_key, p_request_hash, p_occurred_at
  );

  UPDATE public.merchant_ai_enablement
  SET review_analysis_epoch = next_review_analysis_epoch,
      analysis_start_sequence = review_head_sequence,
      state_version = next_state_version,
      updated_by = p_actor_user_id,
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
  RETURN NEXT;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "reposition_merchant_ai_analysis_watermark_v1"(varchar, uuid, varchar, varchar, varchar, varchar, timestamp with time zone) FROM PUBLIC;
