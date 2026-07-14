-- Migration 0005: Transactional outbox and consumer receipts (PRE17A A3)
-- Replaces the in-process event bus with durable PostgreSQL-backed delivery.
-- Business writes and events commit atomically; BullMQ delivery is at-least-once;
-- database receipts make consumers idempotent.
-- ADR 0024: Transactional outbox and idempotent consumers.

-- ── outbox_events ──────────────────────────────────────────────────
-- One row per domain event emitted by a use case. The relay claims unpublished
-- rows with SKIP LOCKED, publishes to BullMQ, and marks published_at.
-- Payload is identifier-only — no review text, reviewer identity, prompt
-- content, or provider output (ADR 0030).

CREATE TABLE "outbox_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "event_version" integer NOT NULL DEFAULT 1,
  "payload" jsonb NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" varchar(255),
  "source_context" text NOT NULL,
  "source_aggregate_id" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  "lease_owner" text,
  "leased_at" timestamptz,
  "lease_expires_at" timestamptz
);

-- Relay claims unpublished, unleased (or expired lease) rows.
CREATE INDEX "outbox_events_unpublished_idx"
  ON "outbox_events" ("created_at")
  WHERE "published_at" IS NULL AND "lease_expires_at" IS NULL;

-- Reconciliation finds expired leases.
CREATE INDEX "outbox_events_lease_expires_idx"
  ON "outbox_events" ("lease_expires_at")
  WHERE "published_at" IS NULL AND "lease_expires_at" IS NOT NULL;

-- Tenant-scoped queries (debugging, admin).
CREATE INDEX "outbox_events_org_created_idx"
  ON "outbox_events" ("organization_id", "created_at" DESC);

-- ── event_consumer_receipts ────────────────────────────────────────
-- One row per (event, consumer) pair. The receipt commits in the same
-- transaction as the consuming context's state change. A duplicate event
-- sees the receipt and no-ops. A missing/deleted source commits 'obsolete'.

CREATE TABLE "event_consumer_receipts" (
  "event_id" uuid NOT NULL REFERENCES "outbox_events" ("id") ON DELETE CASCADE,
  "consumer_name" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('applied', 'duplicate', 'obsolete')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("event_id", "consumer_name")
);

-- Consumer lookup: "has this consumer processed this event?"
-- The PK index handles this. No additional index needed.

-- ── Retention ──────────────────────────────────────────────────────
-- Outbox rows: retain 7 days after publication (configuration, not magic).
-- Receipts: retain 90 days (configuration).
-- Purge with bounded cursor batches via a scheduled job.
-- These are documented defaults; the purge job reads them from config.
