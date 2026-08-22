-- Derive the backfill's accountable actor from the most recent merchant CONSENT
-- DECISION in the lineage, never from another `analysis_backfill` row.
--
-- 0073 fixed the writer — a backfill records the member who consented, not the
-- operator who replayed it — but it read that member from the evidence row at
-- the enablement's CURRENT `state_version`, i.e. the lineage head. On the live
-- closed-beta property that head is the row the first, broken pilot wrote:
--
--   state_version | transition_kind    | actor_user_id      | reason_code
--   1             | enable             | <owner>            | merchant_enabled
--   2             | change             | <owner>            | capabilities_changed
--   3             | change             | <owner>            | capabilities_changed
--   4             | revoke             | <owner>            | merchant_revoked
--   5             | enable             | <owner>            | merchant_enabled
--   6             | analysis_backfill  | <ops operator>     | operator_review_analysis_backfill
--
-- So the reposition read an operator identity out of row 6, correctly concluded
-- that admission would deny it, and refused
-- `merchant_ai_backfill_consent_actor_denied`. The refusal was right. The rule
-- that produced the dependency was wrong.
--
-- Row 6 cannot be corrected: `merchant_ai_history_is_append_only` and
-- `merchant_ai_head_requires_transition_function` see to that, correctly. And
-- no operator can mint a replacement, because a genuine merchant transition
-- through `apply_merchant_ai_transition_v1` demands an owner/admin MEMBER with
-- a password. Reading the head therefore made this property permanently
-- un-backfillable — a design dead end, not a data problem.
--
-- A backfill is not a consent decision, so it must not inherit from another
-- backfill. An `analysis_backfill` row records that a REPLAY happened; the
-- merchant decided nothing when it was written, and its actor is only ever a
-- copy of some earlier decision's actor (or, from 0072, an operator). The
-- accountable actor is the actor of the most recent row whose `transition_kind`
-- is a genuine merchant consent decision — 'enable', 'change', 'revoke' or
-- 'restore_reset' — at or below the locked head.
--
-- On the rows above that resolves to state_version 5, the owner, which is
-- materially correct: the consent this backfill replays IS the owner's `enable`
-- at 5. The function then writes that same member forward onto its own new row,
-- so the row `admit_ai_property_v1` reads (the evidence row at
-- `enablement.state_version`) always holds a real member, and the lineage
-- self-heals from the next run onward without touching history.
--
-- Ordering is well defined. `guard_merchant_ai_evidence_v1` admits a row only
-- when `state_version = 1` with no predecessor, or when
-- `NEW.state_version = prior.state_version + 1` for the same lineage, and
-- `merchant_ai_consent_evidence_pk` is (lineage, state_version). Within a
-- lineage `state_version` is therefore a dense, strictly increasing sequence,
-- so `ORDER BY state_version DESC LIMIT 1` names exactly one row.
--
-- A revoke between two enables (rows 4 and 5) is exactly why the rule takes the
-- HIGHEST qualifying version rather than any consent decision: the consent in
-- force is the later `enable`, and that is the one being spent. A revoke can
-- never BE the selected row in practice — it leaves `state = 'revoked'` with no
-- capabilities, and the head check above raises
-- `merchant_ai_review_analysis_not_authorized` before this block is reached, as
-- it must: there is no live consent to replay under a revocation.
--
-- Nothing else changes. The function still accepts no actor, so an operator
-- identity remains unrepresentable; it still applies the same authority
-- predicate as consent-taking and admission (owner, or admin holding an
-- unrevoked, unexpired `property_access_grant`); and it still refuses rather
-- than guess.
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
$$;
