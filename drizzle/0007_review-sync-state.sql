-- Migration 0007: Review sync state and run history (PRE17B)
-- Tracks incremental sync cursors per property/source and bounded
-- operational history for review synchronization.
-- ADR 0026: Targeted, bounded, resumable sync replaces full-fetch.

-- ── review_sync_state: one row per property/source ─────────────────
-- Tracks the incremental cursor (watermark) and scheduling state.
CREATE TABLE "review_sync_state" (
  "property_id" varchar(255) NOT NULL,
  "source" text NOT NULL DEFAULT 'google',
  "connection_id" varchar(255),
  "source_epoch" integer NOT NULL DEFAULT 0,

  -- Incremental cursor
  "watermark_updated_at" timestamptz,
  "watermark_source_name" text,
  "overlap_duration_ms" bigint DEFAULT 300000, -- 5 min overlap by default

  -- Complete inventory state
  "generation_id" uuid,
  "page_token" text,
  "inventory_started_at" timestamptz,
  "inventory_completed_at" timestamptz,
  "inventory_status" text DEFAULT 'idle', -- idle, running, completed, failed

  -- Scheduling
  "next_incremental_at" timestamptz,
  "next_inventory_at" timestamptz,
  "lease_owner" text,
  "lease_until" timestamptz,

  -- Freshness tracking
  "last_notification_at" timestamptz,
  "last_success_at" timestamptz,
  "last_terminal_error_at" timestamptz,

  -- Error (sanitized — no upstream body)
  "error_class" text,
  "error_retry_at" timestamptz,

  "updated_at" timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY ("property_id", "source")
);

-- Find properties due for incremental sync
CREATE INDEX "review_sync_state_due_incremental_idx"
  ON "review_sync_state" ("next_incremental_at")
  WHERE "next_incremental_at" IS NOT NULL;

-- Find properties with expired leases (reconciliation)
CREATE INDEX "review_sync_state_lease_expired_idx"
  ON "review_sync_state" ("lease_until")
  WHERE "lease_until" IS NOT NULL;

-- ── review_sync_runs: bounded operational history ──────────────────
-- One row per sync execution. Retained 30 days. No review IDs or payloads.
CREATE TABLE "review_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "property_id" varchar(255) NOT NULL,
  "source" text NOT NULL DEFAULT 'google',
  "mode" text NOT NULL, -- incremental, inventory, webhook
  "source_epoch" integer,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "page_count" integer DEFAULT 0,
  "review_count" integer DEFAULT 0,
  "created_count" integer DEFAULT 0,
  "updated_count" integer DEFAULT 0,
  "deleted_count" integer DEFAULT 0,
  "failed_count" integer DEFAULT 0,
  "result" text, -- success, partial, failed
  "error_class" text -- sanitized — no upstream body
);

-- Retention: 30 days
CREATE INDEX "review_sync_runs_started_at_idx"
  ON "review_sync_runs" ("started_at");

-- ── inbound_webhook_receipts: dedup for Google Pub/Sub ─────────────
CREATE TABLE "inbound_webhook_receipts" (
  "provider" text NOT NULL DEFAULT 'google',
  "topic" text NOT NULL,
  "message_id" text NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "accepted_at" timestamptz,
  "notification_kind" text,
  "resolved_property_id" varchar(255),
  "outcome" text, -- processed, duplicate, rejected, error
  PRIMARY KEY ("provider", "topic", "message_id")
);
