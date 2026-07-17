-- Migration 0012: Review refresh sweep run records (BQC-1.5)
-- One row per refresh sweep run: resume cursor, counts, oldest due expiry,
-- failures, and terminal state. `budget_exhausted` runs resume from their
-- cursor on the next run. Content-free: cursors/counts/state only.

CREATE TABLE "review_refresh_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,

  -- Keyset cursor (content_expires_at, review_id) the run stopped at
  "cursor_content_expires_at" timestamptz,
  "cursor_review_id" uuid,

  "batch_size" integer NOT NULL,
  "max_batches" integer NOT NULL,

  "batches_processed" integer NOT NULL DEFAULT 0,
  "candidates_seen" integer NOT NULL DEFAULT 0,
  "refresh_due_count" integer NOT NULL DEFAULT 0,
  "enqueued_count" integer NOT NULL DEFAULT 0,
  "enqueue_failed_count" integer NOT NULL DEFAULT 0,

  -- Oldest content_expires_at among refresh-due rows seen (alert input)
  "oldest_due_content_expires_at" timestamptz,

  "status" text NOT NULL DEFAULT 'running', -- running, completed, budget_exhausted, failed
  "failure_reason" text,
  "next_attempt_at" timestamptz
);

-- Recent runs first for operator inspection and latest-run resume lookup
CREATE INDEX "review_refresh_runs_started_at_idx"
  ON "review_refresh_runs" ("started_at");
