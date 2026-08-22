-- Make the review-analysis backfill record the MEMBER who consented, not the
-- operator who replayed it.
--
-- `merchant_ai_consent_evidence.actor_user_id` is resolved as a
-- `member."userId"` — `admit_ai_property_v1` reads it as the accountable actor
-- for any operation whose own `actor_user_id` is NULL (every system-run
-- analysis), and denies `authorization_changed` unless it resolves to a member
-- with authority over the property:
--
--   effective_actor_id := operation_row.actor_user_id;          -- NULL, system op
--   IF effective_actor_id IS NULL THEN
--     SELECT actor_user_id INTO effective_actor_id
--     FROM merchant_ai_consent_evidence
--     WHERE authorization_lineage_id = operation_row.authorization_lineage_id
--       AND state_version = enablement_row.state_version;       -- the backfill row
--   END IF;
--   SELECT role INTO actor_role FROM member WHERE "userId" = effective_actor_id;
--   IF NOT FOUND OR ... THEN -- denied: authorization_changed
--
-- 0072 passed the OPS OPERATOR's identity into that column. An operator is not
-- a member — that is the whole point of an operator — so the lookup could never
-- resolve, and because the backfill also bumps `state_version`, ITS row is the
-- one the fallback lands on. Every backfilled review was therefore denied at
-- admission and never reached the provider. The gateway maps that denial to
-- `capability_epoch_changed`, so the recorded symptom named the epoch while
-- every epoch actually matched.
--
-- The admission check is right, and is deliberately left alone: it insists the
-- accountable actor is a real member with authority over the property. The
-- writer was wrong.
--
-- A backfill grants NO new consent — it replays under consent that already
-- exists — so the accountable actor is the member who consented: the
-- `actor_user_id` of the evidence row at the CURRENT head's `state_version`.
-- This function now derives that actor itself and no longer accepts one, which
-- makes passing an operator identity unrepresentable rather than merely
-- discouraged. The operator behind the replay is recorded where an operator
-- belongs: `reason_code = 'operator_review_analysis_backfill'`, plus the ops
-- harness's own audit (operator identity, ticket, correlation id) in
-- `policy_decision_audit`.
--
-- Refuse rather than guess. If the carried-forward actor no longer resolves to
-- a member with authority over the property, the reposition raises instead of
-- writing: substituting the operator, or picking an arbitrary owner, would
-- forge the consent record. The predicate is exactly the one
-- `apply_merchant_ai_transition_v1` applies when consent is TAKEN and
-- `admit_ai_property_v1` applies when it is SPENT — owner, or admin holding an
-- unrevoked, unexpired `property_access_grant` — so an actor this function
-- accepts is an actor admission accepts.
DROP FUNCTION IF EXISTS "reposition_merchant_ai_analysis_watermark_v1"(
  varchar, uuid, varchar, varchar, varchar, varchar, timestamp with time zone
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reposition_merchant_ai_analysis_watermark_v1"(
  p_organization_id varchar,
  p_property_id uuid,
  p_reason_code varchar,
  p_idempotency_key varchar,
  p_request_hash varchar,
  p_occurred_at timestamp with time zone
)
RETURNS TABLE (
  source_epoch integer,
  analysis_start_sequence bigint,
  review_analysis_epoch integer,
  state_version integer,
  consent_actor_user_id varchar
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

  -- The accountable actor, carried forward from the consent this replays.
  -- `merchant_ai_enablement_evidence_head_fk` points (lineage, state_version)
  -- at the evidence PK, so this row exists for every live head; the NOT FOUND
  -- branch is the guard for a future lineage change, not a reachable state
  -- today. Refusing is the only safe answer either way: with no prior actor
  -- there is nobody whose consent this backfill could be replaying.
  SELECT evidence.actor_user_id INTO consent_actor_id
  FROM public.merchant_ai_consent_evidence AS evidence
  WHERE evidence.authorization_lineage_id = current_head.authorization_lineage_id
    AND evidence.state_version = current_head.state_version
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "reposition_merchant_ai_analysis_watermark_v1"(varchar, uuid, varchar, varchar, varchar, timestamp with time zone) FROM PUBLIC;
