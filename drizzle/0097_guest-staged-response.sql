ALTER TABLE "guest_responses"
  ADD COLUMN "private_feedback_threshold" integer,
  ADD COLUMN "feedback_submitted_at" timestamp with time zone;

ALTER TABLE "guest_responses"
  ADD CONSTRAINT "guest_responses_private_feedback_threshold_valid"
  CHECK (
    "private_feedback_threshold" IS NULL
    OR "private_feedback_threshold" BETWEEN 1 AND 5
  );
