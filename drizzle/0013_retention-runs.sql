-- Migration 0013: Retention/deletion evidence runs (BQC-1.6)
-- One row per retention subject per sweep. Content-free evidence only:
-- subject, timestamps, counts, outcome, error code, policy version.
-- No deleted content, no payload copies.

CREATE TABLE "retention_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "subject" text NOT NULL, -- e.g. 'outbox_events.published', 'reviews.purge'
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "batch_size" integer NOT NULL,
  "batches" integer NOT NULL DEFAULT 0,
  "rows_deleted" integer NOT NULL DEFAULT 0,
  "outcome" text NOT NULL DEFAULT 'completed', -- completed, failed
  "error_code" text,
  "policy_version" integer NOT NULL DEFAULT 1
);

-- Per-subject recent history for operators and restore-time review
CREATE INDEX "retention_runs_subject_started_idx"
  ON "retention_runs" ("subject", "started_at");
