CREATE TYPE "public"."connection_status" AS ENUM('active', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."connection_visibility" AS ENUM('private', 'organization');--> statement-breakpoint
CREATE TYPE "public"."gbp_cache_data_type" AS ENUM('location');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('queued', 'in_progress', 'completed', 'failed', 'completed_with_skips', 'completed_with_failures');--> statement-breakpoint
CREATE TYPE "public"."reply_source" AS ENUM('google_sync', 'internal');--> statement-breakpoint
CREATE TYPE "public"."reply_status" AS ENUM('draft', 'pending_approval', 'approved', 'published', 'rejected', 'publish_failed');--> statement-breakpoint
CREATE TYPE "public"."review_platform" AS ENUM('google');--> statement-breakpoint
CREATE TYPE "public"."inbox_source_type" AS ENUM('review', 'feedback');--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('new', 'read', 'addressed', 'escalated', 'archived');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"details" jsonb,
	"success" boolean DEFAULT true NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"gbp_place_id" varchar(500),
	"google_connection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"team_lead_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"team_id" uuid,
	"portal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_group_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_link_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"title" varchar(100) NOT NULL,
	"sort_key" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"label" varchar(100) NOT NULL,
	"url" varchar(500) NOT NULL,
	"icon_key" varchar(50),
	"sort_key" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"entity_type" varchar(20) DEFAULT 'property' NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" varchar(500),
	"hero_image_url" varchar(500),
	"theme" jsonb DEFAULT '{}'::jsonb,
	"smart_routing_enabled" boolean DEFAULT false NOT NULL,
	"smart_routing_threshold" smallint DEFAULT 4 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"portal_id" uuid NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"rating_id" uuid,
	"comment" text NOT NULL,
	"source" varchar(10) NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"portal_id" uuid NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"value" integer NOT NULL,
	"source" varchar(10) NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"portal_id" uuid NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"source" varchar(10) NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"google_account_id" varchar(255) NOT NULL,
	"google_email" varchar(255) NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"connected_by" varchar(255) NOT NULL,
	"visibility" "connection_visibility" DEFAULT 'private' NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"gbp_place_id" varchar(500) NOT NULL,
	"data_type" "gbp_cache_data_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"google_attribution" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gbp_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"initiated_by" varchar(255) NOT NULL,
	"status" "import_job_status" DEFAULT 'queued' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"status" "reply_status" NOT NULL,
	"source" "reply_source" NOT NULL,
	"created_by" varchar(255),
	"approved_by" varchar(255),
	"rejected_by" varchar(255),
	"rejection_reason" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"platform" "review_platform" NOT NULL,
	"external_id" varchar(500) NOT NULL,
	"external_location_id" varchar(500) NOT NULL,
	"google_connection_id" uuid,
	"reviewer_name" varchar(255),
	"reviewer_profile_photo_url" varchar(1000),
	"rating" integer NOT NULL,
	"text" text,
	"language_code" varchar(10),
	"reviewed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sentiment_label" varchar(20),
	"sentiment_score" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "inbox_status" DEFAULT 'new' NOT NULL,
	"rating" integer,
	"source_date" timestamp with time zone NOT NULL,
	"platform" varchar(255),
	"snippet" text,
	"reviewer_name" varchar(255),
	"assigned_to" varchar(255),
	"read_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"addressed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"first_reply_submitted_at" timestamp with time zone,
	"first_reply_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"author_user_id" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badge_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"badge_definition_id" uuid NOT NULL,
	"criteria_version" integer NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid,
	"portal_group_id" uuid,
	"awarded_at" timestamp with time zone NOT NULL,
	"unique_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "badge_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"icon" varchar(50) DEFAULT 'award' NOT NULL,
	"target_scope" varchar(20) NOT NULL,
	"criteria_version" integer DEFAULT 1 NOT NULL,
	"criteria_json" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_badge_enablements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"badge_definition_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"score" real NOT NULL,
	"metric_value" real NOT NULL,
	"normalized_score" real NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"period" varchar(30) NOT NULL,
	"scope" varchar(20) NOT NULL,
	"metric_key" varchar(100) NOT NULL,
	"score_key" varchar(100) DEFAULT 'overall' NOT NULL,
	"last_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_key" varchar(100) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"entity_level" varchar(20) NOT NULL,
	"value_type" varchar(20) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid,
	"group_id" uuid,
	"metric_key" varchar(100) NOT NULL,
	"value" real NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"current_value" real DEFAULT 0 NOT NULL,
	"current_sum" real,
	"current_count" integer,
	"last_computed_at" timestamp with time zone NOT NULL,
	"computed_source" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid,
	"portal_group_id" uuid,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_by" varchar(255) NOT NULL,
	"goal_type" varchar(20) NOT NULL,
	"aggregation_function" varchar(20) NOT NULL,
	"metric_key" varchar(100) NOT NULL,
	"target_value" real NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"recurrence_rule" jsonb,
	"rolling_window_days" integer,
	"parent_goal_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"actor_name" varchar(255) NOT NULL,
	"actor_avatar_url" text,
	"actor_role" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"property_id" varchar(255),
	"organization_id" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" varchar(255),
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_log_event_id_org_uniq" UNIQUE("event_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_role_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"data_scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_role_policy_data_scope_check" CHECK ("organization_role_policy"."data_scope" IN ('organization', 'assigned-properties', 'none')),
	CONSTRAINT "organization_role_policy_role_format_check" CHECK ("organization_role_policy"."role" ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
	CONSTRAINT "organization_role_policy_role_no_comma_check" CHECK (position(',' in "organization_role_policy"."role") = 0),
	CONSTRAINT "organization_role_policy_role_not_reserved_check" CHECK ("organization_role_policy"."role" NOT IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "permission_version" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_group_members" ADD CONSTRAINT "portal_group_members_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_group_members" ADD CONSTRAINT "portal_group_members_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_groups" ADD CONSTRAINT "portal_groups_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_link_categories" ADD CONSTRAINT "portal_link_categories_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_category_id_portal_link_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."portal_link_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gbp_cache" ADD CONSTRAINT "gbp_cache_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_badge_definition_id_badge_definitions_id_fk" FOREIGN KEY ("badge_definition_id") REFERENCES "public"."badge_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_badge_enablements" ADD CONSTRAINT "organization_badge_enablements_badge_definition_id_badge_definitions_id_fk" FOREIGN KEY ("badge_definition_id") REFERENCES "public"."badge_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."leaderboard_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_group_id_portal_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."portal_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_progress" ADD CONSTRAINT "goal_progress_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_goal_id_goals_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_org_slug_unique" ON "properties" USING btree ("organization_id","slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_org_gbp_place_id_unique" ON "properties" USING btree ("organization_id","gbp_place_id") WHERE gbp_place_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "teams_org_property_idx" ON "teams" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_org_property_name_unique" ON "teams" USING btree ("organization_id","property_id","name") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "staff_assignments_org_user_idx" ON "staff_assignments" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_org_property_idx" ON "staff_assignments" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_org_team_idx" ON "staff_assignments" USING btree ("organization_id","team_id");--> statement-breakpoint
CREATE INDEX "staff_assignments_org_portal_idx" ON "staff_assignments" USING btree ("organization_id","portal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_unique_direct" ON "staff_assignments" USING btree ("organization_id","user_id","property_id") WHERE team_id IS NULL AND portal_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_unique_portal" ON "staff_assignments" USING btree ("organization_id","user_id","property_id","portal_id") WHERE team_id IS NULL AND portal_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_unique_team" ON "staff_assignments" USING btree ("organization_id","user_id","property_id","team_id") WHERE team_id IS NOT NULL AND portal_id IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_unique_team_portal" ON "staff_assignments" USING btree ("organization_id","user_id","property_id","team_id","portal_id") WHERE team_id IS NOT NULL AND portal_id IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_group_members_portal_id_unique" ON "portal_group_members" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "portal_group_members_group_idx" ON "portal_group_members" USING btree ("portal_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_groups_org_property_name_unique" ON "portal_groups" USING btree ("organization_id","property_id","name") WHERE "portal_groups"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "portal_link_categories_portal_idx" ON "portal_link_categories" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "portal_links_portal_idx" ON "portal_links" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "portal_links_category_idx" ON "portal_links" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portals_org_property_slug_unique" ON "portals" USING btree ("organization_id","property_id","slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "portals_org_property_idx" ON "portals" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_session_portal_unique" ON "feedback" USING btree ("session_id","portal_id");--> statement-breakpoint
CREATE INDEX "feedback_portal_idx" ON "feedback" USING btree ("portal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_session_portal_unique" ON "ratings" USING btree ("session_id","portal_id");--> statement-breakpoint
CREATE INDEX "ratings_portal_idx" ON "ratings" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "scan_events_session_idx" ON "scan_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "scan_events_portal_idx" ON "scan_events" USING btree ("portal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_org_account_idx" ON "google_connections" USING btree ("organization_id","google_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_cache_org_property_type_unique" ON "gbp_cache" USING btree ("organization_id","property_id","data_type");--> statement-breakpoint
CREATE INDEX "gbp_import_jobs_org_idx" ON "gbp_import_jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "replies_review_source_unique" ON "replies" USING btree ("review_id","source","organization_id");--> statement-breakpoint
CREATE INDEX "replies_review_idx" ON "replies" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "replies_org_idx" ON "replies" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_platform_external_unique" ON "reviews" USING btree ("platform","external_id","organization_id");--> statement-breakpoint
CREATE INDEX "reviews_property_idx" ON "reviews" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "reviews_org_idx" ON "reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "reviews_expires_idx" ON "reviews" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "reviews_org_property_reviewed_idx" ON "reviews" USING btree ("organization_id","property_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "reviews_google_connection_idx" ON "reviews" USING btree ("google_connection_id");--> statement-breakpoint
CREATE INDEX "inbox_items_org_status_idx" ON "inbox_items" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "inbox_items_org_source_date_idx" ON "inbox_items" USING btree ("organization_id","source_date" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "inbox_items_org_property_idx" ON "inbox_items" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "inbox_items_org_property_status_idx" ON "inbox_items" USING btree ("organization_id","property_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_source_unique" ON "inbox_items" USING btree ("source_type","source_id","organization_id");--> statement-breakpoint
CREATE INDEX "inbox_notes_item_idx" ON "inbox_notes" USING btree ("inbox_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_awards_unique_key_unique" ON "badge_awards" USING btree ("unique_key");--> statement-breakpoint
CREATE INDEX "badge_awards_org_property_idx" ON "badge_awards" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "badge_awards_target_idx" ON "badge_awards" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "badge_awards_portal_idx" ON "badge_awards" USING btree ("portal_id");--> statement-breakpoint
CREATE INDEX "badge_awards_group_idx" ON "badge_awards" USING btree ("portal_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_definitions_key_unique" ON "badge_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "badge_definitions_target_scope_idx" ON "badge_definitions" USING btree ("target_scope");--> statement-breakpoint
CREATE UNIQUE INDEX "org_badge_enablements_org_definition_unique" ON "organization_badge_enablements" USING btree ("organization_id","badge_definition_id");--> statement-breakpoint
CREATE INDEX "org_badge_enablements_org_idx" ON "organization_badge_enablements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_snapshot_rank_idx" ON "leaderboard_entries" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_target_idx" ON "leaderboard_entries" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_org_idx" ON "leaderboard_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshots_key_unique" ON "leaderboard_snapshots" USING btree ("organization_id","property_id","period","scope","metric_key","score_key");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_property_idx" ON "leaderboard_snapshots" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_org_idx" ON "leaderboard_snapshots" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definitions_key_unique" ON "metric_definitions" USING btree ("metric_key");--> statement-breakpoint
CREATE INDEX "metric_readings_org_idx" ON "metric_readings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "metric_readings_org_key_recorded_idx" ON "metric_readings" USING btree ("organization_id","metric_key","recorded_at");--> statement-breakpoint
CREATE INDEX "metric_readings_org_property_idx" ON "metric_readings" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "metric_readings_org_portal_idx" ON "metric_readings" USING btree ("organization_id","portal_id");--> statement-breakpoint
CREATE INDEX "metric_readings_org_prop_recorded_idx" ON "metric_readings" USING btree ("organization_id","property_id","recorded_at");--> statement-breakpoint
CREATE INDEX "metric_readings_org_group_idx" ON "metric_readings" USING btree ("organization_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_progress_goal_uniq" ON "goal_progress" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_progress_org_idx" ON "goal_progress" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "goals_org_idx" ON "goals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "goals_org_property_idx" ON "goals" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "goals_org_status_idx" ON "goals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "goals_parent_idx" ON "goals" USING btree ("parent_goal_id");--> statement-breakpoint
CREATE INDEX "goals_portal_group_idx" ON "goals" USING btree ("portal_group_id");--> statement-breakpoint
CREATE INDEX "goals_org_portal_idx" ON "goals" USING btree ("organization_id","portal_id");--> statement-breakpoint
CREATE INDEX "activity_log_resource_idx" ON "activity_log" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_org_property_idx" ON "activity_log" USING btree ("organization_id","property_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_log_event_id_idx" ON "activity_log" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "activity_log_actor_idx" ON "activity_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_role_policy_org_role_unique" ON "organization_role_policy" USING btree ("organization_id","role");