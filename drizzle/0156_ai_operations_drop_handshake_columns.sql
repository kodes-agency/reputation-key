-- migrate:contract cd6a8505e4a56ddef8a087018dfe86adb354cdda
-- Drops the four handshake columns of ai_operations that no code declares,
-- reads or writes any more, then retires the trend branch from the CHECKs that
-- still name it. Historical rows keep non-null values in the columns, so the
-- guard does not ask for them to be empty: they are history and go with the
-- columns. No constraint, index or function names them.
DO $guard$
DECLARE
  v_named bigint;
BEGIN
  SELECT count(*) INTO v_named
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.ai_operations'::regclass
      AND c.contype IN ('c', 'f', 'u', 'p', 'x')
      AND pg_catalog.pg_get_constraintdef(c.oid) ~
        '(admission_nonce|request_binding_key_id|request_binding_hmac|grant_kid)';
  IF v_named > 0 THEN
    RAISE EXCEPTION 'Cannot drop the handshake columns: % constraints still name them', v_named;
  END IF;
  SELECT count(*) INTO v_named
    FROM pg_catalog.pg_indexes i
    WHERE i.schemaname = 'public'
      AND i.tablename = 'ai_operations'
      AND i.indexdef ~ '(admission_nonce|request_binding_key_id|request_binding_hmac|grant_kid)';
  IF v_named > 0 THEN
    RAISE EXCEPTION 'Cannot drop the handshake columns: % indexes still name them', v_named;
  END IF;
END;
$guard$;
--> statement-breakpoint
ALTER TABLE "ai_operations" DROP COLUMN "admission_nonce";--> statement-breakpoint
ALTER TABLE "ai_operations" DROP COLUMN "request_binding_key_id";--> statement-breakpoint
ALTER TABLE "ai_operations" DROP COLUMN "request_binding_hmac";--> statement-breakpoint
ALTER TABLE "ai_operations" DROP COLUMN "grant_kid";--> statement-breakpoint
-- Each CHECK is tightened only while no trend row exists. The tightened CHECK is
-- added NOT VALID, which scans nothing, and validated in its own statement,
-- which takes only a share lock that lets writers through.
DO $tighten$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_operations
      WHERE command = 'trend' OR capability = 'property_trends'
  ) THEN
    ALTER TABLE public.ai_operations DROP CONSTRAINT ai_operations_branch_valid;
    ALTER TABLE public.ai_operations ADD CONSTRAINT ai_operations_branch_valid CHECK (
      (
        (command = 'analysis' AND capability = 'review_analysis' AND actor_user_id IS NULL AND system_principal = 'review_event_consumer' AND review_id IS NOT NULL AND origin_event_id IS NOT NULL AND subject_hmac ~ '^[0-9a-f]{64}$' AND subject_hmac_key_version IS NOT NULL AND source_epoch >= 0 AND source_revision >= 1 AND analysis_sequence >= 1)
        OR (command = 'reply' AND capability = 'reply_drafting' AND actor_user_id IS NOT NULL AND system_principal IS NULL AND review_id IS NOT NULL AND source_epoch >= 0 AND source_revision >= 1 AND tone IN ('professional', 'friendly', 'casual') AND base_reply_state_revision >= 0)
      )
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_execution_control_heads WHERE scope_value = 'property_trends'
  ) THEN
    ALTER TABLE public.ai_execution_control_heads DROP CONSTRAINT ai_execution_control_heads_scope_valid;
    ALTER TABLE public.ai_execution_control_heads ADD CONSTRAINT ai_execution_control_heads_scope_valid CHECK (
      (
        (scope_kind = 'global' AND scope_key = 'global' AND scope_value IS NULL)
        OR (scope_kind = 'provider_deployment_profile' AND scope_value ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND scope_value NOT IN ('openai', 'anthropic') AND scope_key = 'provider:' || scope_value)
        OR (scope_kind = 'provider' AND scope_value IS NOT NULL AND scope_value IN ('openai', 'anthropic') AND scope_key = 'provider:' || scope_value)
        OR (scope_kind = 'capability' AND scope_value IN ('review_analysis', 'reply_drafting') AND scope_key = 'capability:' || scope_value)
      )
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_execution_control_transitions WHERE scope_value = 'property_trends'
  ) THEN
    ALTER TABLE public.ai_execution_control_transitions DROP CONSTRAINT ai_execution_control_transitions_scope_valid;
    ALTER TABLE public.ai_execution_control_transitions ADD CONSTRAINT ai_execution_control_transitions_scope_valid CHECK (
      (
        (scope_kind = 'global' AND scope_key = 'global' AND scope_value IS NULL)
        OR (scope_kind = 'provider_deployment_profile' AND scope_value ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND scope_value NOT IN ('openai', 'anthropic') AND scope_key = 'provider:' || scope_value)
        OR (scope_kind = 'provider' AND scope_value IS NOT NULL AND scope_value IN ('openai', 'anthropic') AND scope_key = 'provider:' || scope_value)
        OR (scope_kind = 'capability' AND scope_value IN ('review_analysis', 'reply_drafting') AND scope_key = 'capability:' || scope_value)
      )
    ) NOT VALID;
  END IF;
END;
$tighten$;
--> statement-breakpoint
DO $validate$
DECLARE
  v_pending record;
BEGIN
  FOR v_pending IN
    SELECT c.conrelid::regclass AS table_name, c.conname
      FROM pg_catalog.pg_constraint c
      WHERE c.conname IN (
        'ai_operations_branch_valid',
        'ai_execution_control_heads_scope_valid',
        'ai_execution_control_transitions_scope_valid'
      )
        AND c.conrelid IN (
          'public.ai_operations'::regclass,
          'public.ai_execution_control_heads'::regclass,
          'public.ai_execution_control_transitions'::regclass
        )
        AND NOT c.convalidated
  LOOP
    EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %I', v_pending.table_name, v_pending.conname);
  END LOOP;
END;
$validate$;
