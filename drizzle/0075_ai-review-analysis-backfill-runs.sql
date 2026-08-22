-- Make an operator backfill a durable RUN that emits one review at a time,
-- instead of a fan-out of N events allocated up front.
--
-- 0072 allocated `H+1 … H+N` in one transaction and emitted N outbox rows. Two
-- separate order dependencies then destroyed the run, and only the first showed
-- up in the worker log:
--
--   1. `consume_ai_review_event_v1` accepts only `consumed_sequence + 1`. The
--      relay publishes to a concurrency-20 dispatcher, so the N events arrive
--      interleaved and most answer `gap`. Noisy, but self-correcting.
--
--   2. `storeAnalysis` refuses unless `review_ai_analysis_heads.head_sequence`
--      still EQUALS the sequence being stored — the analysis plane must be
--      caught up with the allocator. A batch moves the head to `H+N` before the
--      first event is ever consumed, so `H+1 … H+N-1` can NEVER be stored. They
--      return `generation_changed`, the dispatcher writes an `obsolete` receipt,
--      redelivery stops, and the operation is left `executing` with the provider
--      already paid.
--
-- (2) is invisible at N=1 (`H+1 = H+N`), which is why single runs were clean and
-- why `--batch-size 5` burned five provider calls to deliver one analysis.
-- Ordering delivery alone does not fix it: nothing may allocate the next
-- sequence until the previous one has settled.
--
-- So the run becomes state. `ops:ai-reanalyze` bumps the epoch ONCE, opens a run
-- row pinning the reviews it selected, and emits exactly one event; each settled
-- item allocates and emits the next. One event is in flight per property at any
-- moment, so ordering is structural rather than promised, and the whole batch
-- lands inside the single `review_analysis_epoch` the run opened — which is the
-- requirement, because `ai_property_aggregate_heads` and
-- `ai_property_daily_aggregates` are epoch-keyed and reads pin to the
-- enablement's CURRENT epoch. N sequential one-review runs would leave N-1
-- epochs of orphaned, unreadable analyses.
--
-- The row is what makes completion a guarantee rather than a hope: a broken
-- chain (crashed worker, exhausted dispatch budget) leaves a `running` row that
-- the advance sweep re-drives, and an item that can never settle terminates
-- visibly at a named sequence instead of halting the run in silence.

CREATE TABLE "ai_review_analysis_backfill_runs" (
  "id" uuid PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  -- The three coordinates the run is fenced to. Any drift means the world moved
  -- under the run, and replaying into a generation nothing reads is worse than
  -- stopping.
  "source_epoch" integer NOT NULL,
  "review_analysis_epoch" integer NOT NULL,
  "analysis_start_sequence" bigint NOT NULL,
  -- The run's candidate set, PINNED and ordered at open. Recomputing
  -- eligibility per item would silently redefine the batch mid-run, and no
  -- predicate over `reviews.analysis_sequence` can name this set: a stored
  -- sequence is only the sequence of a review's LAST analysis event, so it is
  -- not a membership marker (0072's own fixture holds 0, 5, 5, 900 and 256
  -- against a head of 256, deliberately).
  "review_ids" uuid[] NOT NULL,
  "requested_review_count" integer NOT NULL,
  "emitted_review_count" integer DEFAULT 0 NOT NULL,
  -- Pinned reviews that were no longer eligible when their turn came (content
  -- expired or repointed under the run). They consume no sequence.
  "skipped_review_count" integer DEFAULT 0 NOT NULL,
  -- Emitted items whose outcome could never settle and which the sweep
  -- terminal-settled so the rest of the run could proceed. Reported, never
  -- silent.
  "recovered_review_count" integer DEFAULT 0 NOT NULL,
  "current_analysis_sequence" bigint,
  "current_review_id" uuid,
  "current_emitted_at" timestamptz,
  "state" varchar(16) NOT NULL,
  "terminal_reason" varchar(64),
  "terminal_at" timestamptz,
  "reason_code" varchar(64) NOT NULL,
  "correlation_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "ai_review_analysis_backfill_runs_tenant_fk"
    FOREIGN KEY ("organization_id", "property_id")
    REFERENCES "properties" ("organization_id", "id") ON DELETE CASCADE,
  CONSTRAINT "ai_review_analysis_backfill_runs_state_valid"
    CHECK ("state" IN ('running', 'completed', 'superseded', 'stalled')),
  CONSTRAINT "ai_review_analysis_backfill_runs_terminal_valid"
    CHECK (
      ("state" = 'running' AND "terminal_at" IS NULL AND "terminal_reason" IS NULL)
      OR ("state" <> 'running' AND "terminal_at" IS NOT NULL)
    ),
  -- The in-flight item is one fact in three columns; a partially written
  -- pointer would leave the sweep unable to tell "nothing emitted yet" from
  -- "emitted and lost".
  CONSTRAINT "ai_review_analysis_backfill_runs_cursor_valid"
    CHECK (
      ("current_analysis_sequence" IS NULL) = ("current_review_id" IS NULL)
      AND ("current_analysis_sequence" IS NULL) = ("current_emitted_at" IS NULL)
    ),
  CONSTRAINT "ai_review_analysis_backfill_runs_counts_valid"
    CHECK (
      "requested_review_count" BETWEEN 1 AND 10000
      AND cardinality("review_ids") = "requested_review_count"
      AND "emitted_review_count" >= 0
      AND "skipped_review_count" >= 0
      AND "emitted_review_count" + "skipped_review_count" <= "requested_review_count"
      AND "recovered_review_count" BETWEEN 0 AND "emitted_review_count"
    ),
  CONSTRAINT "ai_review_analysis_backfill_runs_sequences_safe"
    CHECK (
      "source_epoch" BETWEEN 0 AND 2147483647
      AND "review_analysis_epoch" BETWEEN 1 AND 2147483647
      AND "analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint
      AND (
        "current_analysis_sequence" IS NULL
        OR (
          "current_analysis_sequence" >= "analysis_start_sequence" + 1
          AND "current_analysis_sequence" <= '9007199254740991'::bigint
        )
      )
    )
);
--> statement-breakpoint
-- One run per property at a time. Two concurrent runs would each bump the epoch
-- and each strand the other's analyses in a generation no read follows, which
-- is precisely the orphaning this design exists to prevent.
CREATE UNIQUE INDEX "ai_review_analysis_backfill_runs_one_active_idx"
  ON "ai_review_analysis_backfill_runs" ("organization_id", "property_id")
  WHERE "state" = 'running';
--> statement-breakpoint
-- The sweep's only scan: every run still owed work, oldest first.
CREATE INDEX "ai_review_analysis_backfill_runs_running_idx"
  ON "ai_review_analysis_backfill_runs" ("created_at")
  WHERE "state" = 'running';
