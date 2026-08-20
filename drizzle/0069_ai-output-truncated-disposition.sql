-- Give a truncated provider answer its own disposition.
--
-- A truncated response is a successful, fully-billed provider call that returns
-- an empty body, so the output schema parse fails and the route reported a bare
-- `output_invalid` -- indistinguishable from a malformed answer. That is what hid
-- a global reasoning-effort fault: every tenant route spent its entire output
-- budget on reasoning and returned nothing, while the operator saw only four
-- words. The condition was already detected and logged as
-- `openai_output_truncated`; it simply had nowhere to be recorded.
--
-- `settle_ai_execution_v1` does NOT validate the disposition vocabulary -- it
-- reads `p_request->>'disposition'` verbatim. The vocabulary is enforced solely
-- by this CHECK, so an un-widened constraint would not produce a clean denial:
-- the settlement would raise a CHECK violation and abort the transaction. The
-- constraint therefore has to move before the gateway can ever send the value.
--
-- Nothing else in the function needs to move, and this was checked rather than
-- assumed:
--   * state_value CASE falls to ELSE 'settled'. Correct: the call was billed.
--   * terminal_state CASE falls to ELSE 'failed'. Correct: no answer was
--     delivered.
--   * the provider circuit breaker keys on 'provider_unavailable',
--     'deadline_exceeded' and 'transport_ambiguous', so truncation does not trip
--     it. Correct: a truncated answer says nothing about provider availability.
--   * the usage_valid arms name 'success', 'no_dispatch' and
--     'transport_ambiguous' only, and the provider_retryable arm requires a
--     reported disposition of 'rate_limited' or 'provider_unavailable'.
--     Truncation is billed, non-retryable and reports 'success', so every arm
--     passes unchanged.
--
-- Widening a CHECK constraint accepts strictly more rows, so no existing row can
-- violate the new form and no backfill is required.
ALTER TABLE "ai_execution_permit_settlements" DROP CONSTRAINT "ai_execution_permit_settlements_state_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD CONSTRAINT "ai_execution_permit_settlements_state_valid" CHECK ("ai_execution_permit_settlements"."terminal_state" IN ('completed', 'failed', 'cancelled')
        AND "ai_execution_permit_settlements"."settlement_state" IN ('settled', 'released', 'ambiguous')
        AND "ai_execution_permit_settlements"."disposition" IN ('success', 'no_dispatch', 'provider_refused', 'output_invalid', 'output_truncated', 'rate_limited', 'provider_unavailable', 'caller_aborted', 'deadline_exceeded', 'transport_ambiguous', 'source_stale', 'policy_denied')
        AND "ai_execution_permit_settlements"."reported_disposition" IN ('success', 'no_dispatch', 'provider_refused', 'output_invalid', 'output_truncated', 'rate_limited', 'provider_unavailable', 'caller_aborted', 'deadline_exceeded', 'transport_ambiguous', 'source_stale', 'policy_denied'));--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_execution_permit_settlements_state_valid'
      AND pg_get_constraintdef(oid) LIKE '%output_truncated%'
  ) THEN
    RAISE EXCEPTION 'ai_execution_permit_settlements_state_valid did not accept output_truncated';
  END IF;
END $$;
