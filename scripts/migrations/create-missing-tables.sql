-- Create missing tables: notifications (Phase 16.1) + badges/leaderboards (Phase 16.2).
-- These were never applied to the dev DB. Generated from current Drizzle schemas.
-- Uses IF NOT EXISTS so it's safe to re-run.

-- ── Notifications ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "type" varchar(64) NOT NULL,
  "priority" varchar(16) NOT NULL DEFAULT 'normal',
  "status" varchar(16) NOT NULL DEFAULT 'unread',
  "resource_type" varchar(50) NOT NULL,
  "resource_id" varchar(255) NOT NULL,
  "event_id" varchar(255) NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_event_unique" ON "notifications" ("user_id", "type", "resource_id", "event_id");
CREATE INDEX IF NOT EXISTS "notifications_user_status_idx" ON "notifications" ("user_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_org_idx" ON "notifications" ("organization_id", "created_at");

CREATE TABLE IF NOT EXISTS "notification_email_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "notification_id" uuid NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "priority" varchar(16) NOT NULL DEFAULT 'normal',
  "sent_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "retry_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_queue_status_priority_idx" ON "notification_email_queue" ("status", "priority", "organization_id");
CREATE INDEX IF NOT EXISTS "email_queue_urgent_idx" ON "notification_email_queue" ("status", "priority", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "email_queue_notification_unique" ON "notification_email_queue" ("notification_id");

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "type" varchar(64) NOT NULL,
  "email_enabled" boolean NOT NULL DEFAULT true,
  "in_app_enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_prefs_user_type_unique" ON "notification_preferences" ("user_id", "organization_id", "type");

-- ── Badges ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "badge_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(100) NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "icon" varchar(50) NOT NULL DEFAULT 'award',
  "target_scope" varchar(20) NOT NULL,
  "criteria_version" integer NOT NULL DEFAULT 1,
  "criteria_json" jsonb NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "badge_definitions_key_unique" ON "badge_definitions" ("key");
CREATE INDEX IF NOT EXISTS "badge_definitions_target_scope_idx" ON "badge_definitions" ("target_scope");

CREATE TABLE IF NOT EXISTS "organization_badge_enablements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "badge_definition_id" uuid NOT NULL REFERENCES "badge_definitions"("id") ON DELETE cascade,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_badge_enablements_org_definition_unique" ON "organization_badge_enablements" ("organization_id", "badge_definition_id");
CREATE INDEX IF NOT EXISTS "org_badge_enablements_org_idx" ON "organization_badge_enablements" ("organization_id");

CREATE TABLE IF NOT EXISTS "badge_awards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "badge_definition_id" uuid NOT NULL REFERENCES "badge_definitions"("id") ON DELETE cascade,
  "criteria_version" integer NOT NULL,
  "target_type" varchar(20) NOT NULL,
  "target_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "portal_id" uuid REFERENCES "portals"("id") ON DELETE set null,
  "portal_group_id" uuid REFERENCES "portal_groups"("id") ON DELETE set null,
  "awarded_at" timestamp with time zone NOT NULL,
  "unique_key" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "badge_awards_unique_key_unique" ON "badge_awards" ("unique_key");
CREATE INDEX IF NOT EXISTS "badge_awards_org_property_idx" ON "badge_awards" ("organization_id", "property_id");
CREATE INDEX IF NOT EXISTS "badge_awards_target_idx" ON "badge_awards" ("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "badge_awards_portal_idx" ON "badge_awards" ("portal_id");
CREATE INDEX IF NOT EXISTS "badge_awards_group_idx" ON "badge_awards" ("portal_group_id");

-- ── Leaderboards ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "leaderboard_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "period" varchar(30) NOT NULL,
  "scope" varchar(20) NOT NULL,
  "metric_key" varchar(100) NOT NULL,
  "score_key" varchar(100) NOT NULL DEFAULT 'overall',
  "last_updated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "leaderboard_snapshots_key_unique" ON "leaderboard_snapshots" ("property_id", "period", "scope", "metric_key", "score_key");
CREATE INDEX IF NOT EXISTS "leaderboard_snapshots_property_idx" ON "leaderboard_snapshots" ("property_id");

CREATE TABLE IF NOT EXISTS "leaderboard_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_id" uuid NOT NULL REFERENCES "leaderboard_snapshots"("id") ON DELETE cascade,
  "rank" integer NOT NULL,
  "target_type" varchar(20) NOT NULL,
  "target_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "score" real NOT NULL,
  "metric_value" real NOT NULL,
  "normalized_score" real NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "leaderboard_entries_snapshot_rank_idx" ON "leaderboard_entries" ("snapshot_id", "rank");
CREATE INDEX IF NOT EXISTS "leaderboard_entries_target_idx" ON "leaderboard_entries" ("target_type", "target_id");
