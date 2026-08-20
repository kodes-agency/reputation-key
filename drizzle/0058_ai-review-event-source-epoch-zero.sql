-- 0058: consume_ai_review_event_v1 accepted no property at source epoch 0.
--
-- `properties.source_epoch` defaults to 0 and only advances on a region move,
-- and every other constraint in the schema agrees that 0 is valid
-- (reviews_source_epoch_safe, review_ai_analysis_heads_source_epoch_safe,
-- property_operation_receipts_generations_valid, and the registered
-- review.created payload schema, which defaults sourceEpoch to 0). This guard
-- alone demanded >= 1, so every review event for a freshly imported property
-- raised 'Invalid AI review event' (22023) and the durable consumer retried it
-- forever: a 256-review import in google-closed-beta produced zero analyses.
-- Forward-only replacement; body otherwise identical to 0048.
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
