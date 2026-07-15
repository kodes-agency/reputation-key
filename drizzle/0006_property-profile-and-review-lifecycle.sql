-- Migration 0006: Property processing profile and review source lifecycle (PRE17B)
-- Adds property routing fields (country, timezone, processing region) and
-- review source lifecycle fields (fetched timestamps, content expiry, hash).
-- ADR 0026: Property is the routing unit.
-- ADR 0031: Source content policy (30-day TTL, refresh before 25 days).

-- ── Property processing profile ────────────────────────────────────
ALTER TABLE "properties" ADD COLUMN "country_code" varchar(2);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "country_source" text DEFAULT 'organization_default';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "timezone_source" text DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "timezone_resolved_at" timestamptz;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "processing_region" text DEFAULT 'unresolved';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "processing_region_source" text DEFAULT 'country_default';--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "routing_policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "processing_region_resolved_at" timestamptz;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "source_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Index for finding properties needing region backfill
CREATE INDEX "properties_routing_backfill_idx"
  ON "properties" ("routing_policy_version", "id")
  WHERE "processing_region" = 'unresolved' AND "deleted_at" IS NULL;--> statement-breakpoint

-- ── Review source lifecycle ────────────────────────────────────────
-- Google's createTime/updateTime for incremental sync and content expiry.
ALTER TABLE "reviews" ADD COLUMN "source_created_at" timestamptz;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_updated_at" timestamptz;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "first_fetched_at" timestamptz;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "last_fetched_at" timestamptz;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "content_expires_at" timestamptz;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "source_seen_generation" uuid;--> statement-breakpoint

-- Backfill source_created_at from existing reviewed_at
UPDATE "reviews" SET "source_created_at" = "reviewed_at" WHERE "source_created_at" IS NULL;--> statement-breakpoint
UPDATE "reviews" SET "first_fetched_at" = "created_at" WHERE "first_fetched_at" IS NULL;--> statement-breakpoint
UPDATE "reviews" SET "last_fetched_at" = "updated_at" WHERE "last_fetched_at" IS NULL;--> statement-breakpoint

-- Cursor indexes for incremental sync (do NOT include text in covering indexes)
CREATE INDEX "reviews_property_updated_cursor_idx"
  ON "reviews" ("property_id", "source_updated_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reviews_property_created_cursor_idx"
  ON "reviews" ("property_id", "source_created_at" DESC, "id" DESC)
  WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reviews_content_expires_idx"
  ON "reviews" ("content_expires_at", "id")
  WHERE "content_expires_at" IS NOT NULL;--> statement-breakpoint
