ALTER TABLE "guest_responses"
  ADD COLUMN "feedback_withdrawn_at" timestamp with time zone;

ALTER TABLE "guest_responses"
  ADD CONSTRAINT "guest_responses_feedback_withdrawal_valid"
  CHECK (
    "feedback_withdrawn_at" IS NULL
    OR (
      "feedback_submitted_at" IS NOT NULL
      AND "response_text" IS NULL
      AND "text_consent" = false
      AND "feedback_source_event_id" IS NULL
    )
  );
