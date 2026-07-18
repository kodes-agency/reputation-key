-- Migration 0015: Reply publication state machine (BQC-3.8)
-- Durable state for manual Google reply publication (phase BQC-3 §3.8):
--   requested → authorized → sending → published
--                                  ↘ terminal (provider rejected / retry budget spent)
--                                  ↘ ambiguous (outcome unknown → reconciliation required)
--                                  ↘ cancelled (policy/disconnect)
-- publication_state persists the saga's external-interaction overlay
-- (src/contexts/review/domain/reply-publication-workflow.ts) on replies;
-- publication_attempts counts provider send attempts;
-- publication_last_error_class records the classified failure class;
-- reconcile_due_at schedules the ambiguous-outcome reconciliation sweep
-- (reconcile-ambiguous-publications job).

ALTER TABLE "replies"
  ADD COLUMN IF NOT EXISTS "publication_state" text,
  ADD COLUMN IF NOT EXISTS "publication_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "publication_last_error_class" text,
  ADD COLUMN IF NOT EXISTS "reconcile_due_at" timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'replies_publication_state_check'
  ) THEN
    ALTER TABLE "replies" ADD CONSTRAINT "replies_publication_state_check"
      CHECK ("publication_state" IN (
        'requested', 'authorized', 'sending', 'published', 'terminal', 'ambiguous', 'cancelled'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'replies_publication_last_error_class_check'
  ) THEN
    ALTER TABLE "replies" ADD CONSTRAINT "replies_publication_last_error_class_check"
      CHECK ("publication_last_error_class" IN ('terminal_rejection', 'retryable', 'ambiguous'));
  END IF;
END $$;

-- Backfill pre-0015 rows into the machine: published / publish_failed /
-- approved map to their honest persisted states; every other status has no
-- active publication workflow (NULL).
UPDATE "replies" SET "publication_state" = 'published'
  WHERE "status" = 'published' AND "publication_state" IS NULL;
UPDATE "replies" SET "publication_state" = 'terminal'
  WHERE "status" = 'publish_failed' AND "publication_state" IS NULL;
UPDATE "replies" SET "publication_state" = 'authorized'
  WHERE "status" = 'approved' AND "publication_state" IS NULL;

-- Ambiguous-outcome reconciliation sweep lookup
-- (reconcile-ambiguous-publications job: due rows per organization).
CREATE INDEX IF NOT EXISTS "replies_publication_reconcile_idx"
  ON "replies" ("organization_id", "reconcile_due_at")
  WHERE "publication_state" = 'ambiguous' AND "reconcile_due_at" IS NOT NULL;
