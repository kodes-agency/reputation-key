-- NTF-01: keep the bounded provider-acceptance health scan index-backed.
-- Intentional quiet-hours/policy holds are excluded from the metric and from
-- this partial index. The ordering matches the repository's newest-first,
-- deterministic bounded scan.

CREATE INDEX "notification_email_queue_immediate_acceptance_health_idx"
  ON "notification_email_queue" ("created_at" DESC, "id")
  WHERE "cadence" = 'immediate' AND "not_before" IS NULL;
