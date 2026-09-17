-- Let a Bug report point at an error monitoring already recorded.
--
-- When someone reports that something broke, the useful artifact usually
-- already exists: the browser SDK captured the exception seconds earlier. This
-- column carries the opaque event id linking the two, so triage can open the
-- exact failure instead of guessing from prose.
--
-- The CHECK is the point. Only 32 lowercase hex characters are admitted, so no
-- message, stack frame or payload can reach the table through this column, and
-- only a Bug may carry one — a Suggestion has no error to attach. The report's
-- own words continue to live in monitoring and nowhere else.
ALTER TABLE "beta_feedback_triage"
  ADD COLUMN "client_error_event_id" char(32);
--> statement-breakpoint
ALTER TABLE "beta_feedback_triage"
  ADD CONSTRAINT "beta_feedback_triage_client_error_shape" CHECK (
    "beta_feedback_triage"."client_error_event_id" IS NULL
    OR (
      "beta_feedback_triage"."client_error_event_id" ~ '^[a-f0-9]{32}$'
      AND "beta_feedback_triage"."feedback_type" = 'bug'
    )
  );
