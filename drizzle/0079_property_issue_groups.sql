-- Property-local issue groups for Review Analysis v3 (shipped dark).
--
-- A group gives one topic and normalized `thing` a stable UUID within one
-- Property. Members retain deterministic spellings; a manager may later rename,
-- hide or merge same-topic groups. A merged loser remains a one-hop redirect to
-- the surviving target. No model clusters phrases and nothing learns across
-- Properties. Manager display names are presentation text, never AI input.
--
-- Nothing reads or writes these rows until the dark v3 aggregate flow runs, and
-- no live runtime profile selects that flow. Both new tables are empty. The only
-- existing table altered here, ai_property_aggregate_contribution_mentions, is
-- also empty while v3 is dark, so adding and validating its nullable column,
-- foreign key and index scans no live rows. The new foreign keys validate empty
-- tables. migrate-deploy bounds the lock wait.
--
-- The contribution mention's foreign key to its group is NO ACTION, so a group a
-- mention still points to cannot be deleted, and DEFERRABLE INITIALLY DEFERRED,
-- so the check runs at commit. Erasing a Property deletes its groups and, through
-- the analyses, the mentions that point at them, along different cascade paths in
-- an order PostgreSQL does not fix; an immediate check ran after the group
-- delete alone and refused the whole erasure. Deferred, it sees both gone.
--
-- No backfill: a group is created only when a future v3 contribution first
-- assigns one of its mentions. Existing v2 analyses remain unchanged.
--
-- Roll forward, never back. The down step is: drop the contribution mention
-- issue-group index and foreign key, drop its issue_group_id column, drop
-- ai_property_issue_members, then drop ai_property_issue_groups; finally delete
-- the 0079 row of drizzle.__drizzle_migrations.
CREATE TABLE "ai_property_issue_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"topic" varchar(40) NOT NULL,
	"canonical_thing" varchar(80),
	"canonical_key" varchar(100) NOT NULL,
	"display_name" varchar(80),
	"merged_into_issue_id" uuid,
	"hidden_at" timestamp with time zone,
	"hidden_by" varchar(255),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"normalization_version" varchar(100) NOT NULL,
	CONSTRAINT "ai_property_issue_groups_scope_id_topic_unique" UNIQUE("organization_id","property_id","id","topic"),
	CONSTRAINT "ai_property_issue_groups_topic_valid" CHECK ("ai_property_issue_groups"."topic" IN ('staff_service', 'speed_waiting', 'booking_arrival', 'main_service', 'food_drink', 'cleanliness', 'facilities_equipment', 'price_billing', 'atmosphere_noise', 'location_access', 'safety', 'communication')),
	CONSTRAINT "ai_property_issue_groups_canonical_valid" CHECK (("ai_property_issue_groups"."canonical_key" = '__topic__' AND "ai_property_issue_groups"."canonical_thing" IS NULL)
        OR ("ai_property_issue_groups"."canonical_thing" IS NOT NULL AND "ai_property_issue_groups"."canonical_key" = "ai_property_issue_groups"."canonical_thing" AND "ai_property_issue_groups"."canonical_thing" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')),
	CONSTRAINT "ai_property_issue_groups_display_name_valid" CHECK ("ai_property_issue_groups"."display_name" IS NULL OR (char_length("ai_property_issue_groups"."display_name") BETWEEN 1 AND 80 AND "ai_property_issue_groups"."display_name" = btrim("ai_property_issue_groups"."display_name"))),
	CONSTRAINT "ai_property_issue_groups_hidden_valid" CHECK (("ai_property_issue_groups"."hidden_at" IS NULL AND "ai_property_issue_groups"."hidden_by" IS NULL) OR ("ai_property_issue_groups"."hidden_at" IS NOT NULL AND "ai_property_issue_groups"."hidden_by" IS NOT NULL AND char_length("ai_property_issue_groups"."hidden_by") BETWEEN 1 AND 255)),
	CONSTRAINT "ai_property_issue_groups_not_self_merged" CHECK ("ai_property_issue_groups"."merged_into_issue_id" IS NULL OR "ai_property_issue_groups"."merged_into_issue_id" <> "ai_property_issue_groups"."id"),
	CONSTRAINT "ai_property_issue_groups_normalization_version_valid" CHECK (char_length("ai_property_issue_groups"."normalization_version") BETWEEN 1 AND 100)
);--> statement-breakpoint
ALTER TABLE "ai_property_issue_groups" ADD CONSTRAINT "ai_property_issue_groups_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_issue_groups" ADD CONSTRAINT "ai_property_issue_groups_merged_into_fk" FOREIGN KEY ("organization_id","property_id","merged_into_issue_id","topic") REFERENCES "public"."ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_issue_groups_canonical_active_unique" ON "ai_property_issue_groups" USING btree ("organization_id","property_id","topic","canonical_key") WHERE "ai_property_issue_groups"."merged_into_issue_id" IS NULL;--> statement-breakpoint
CREATE INDEX "ai_property_issue_groups_retention_idx" ON "ai_property_issue_groups" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_property_issue_groups_merged_into_idx" ON "ai_property_issue_groups" USING btree ("organization_id","property_id","merged_into_issue_id") WHERE "ai_property_issue_groups"."merged_into_issue_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "ai_property_issue_members" (
	"issue_group_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"topic" varchar(40) NOT NULL,
	"member_key" varchar(100) NOT NULL,
	"member_thing" varchar(80),
	"source" varchar(20) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_issue_members_pk" PRIMARY KEY("organization_id","property_id","topic","member_key"),
	CONSTRAINT "ai_property_issue_members_topic_valid" CHECK ("ai_property_issue_members"."topic" IN ('staff_service', 'speed_waiting', 'booking_arrival', 'main_service', 'food_drink', 'cleanliness', 'facilities_equipment', 'price_billing', 'atmosphere_noise', 'location_access', 'safety', 'communication')),
	CONSTRAINT "ai_property_issue_members_identity_valid" CHECK (("ai_property_issue_members"."member_key" = '__topic__' AND "ai_property_issue_members"."member_thing" IS NULL)
        OR ("ai_property_issue_members"."member_thing" IS NOT NULL AND "ai_property_issue_members"."member_key" = "ai_property_issue_members"."member_thing" AND "ai_property_issue_members"."member_thing" ~ '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$')),
	CONSTRAINT "ai_property_issue_members_source_valid" CHECK ("ai_property_issue_members"."source" IN ('deterministic', 'manager'))
);--> statement-breakpoint
ALTER TABLE "ai_property_issue_members" ADD CONSTRAINT "ai_property_issue_members_group_fk" FOREIGN KEY ("organization_id","property_id","issue_group_id","topic") REFERENCES "public"."ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_property_issue_members_group_idx" ON "ai_property_issue_members" USING btree ("issue_group_id");--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contribution_mentions" ADD COLUMN "issue_group_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contribution_mentions" ADD CONSTRAINT "ai_property_aggregate_contribution_mentions_issue_group_fk" FOREIGN KEY ("organization_id","property_id","issue_group_id","topic") REFERENCES "public"."ai_property_issue_groups"("organization_id","property_id","id","topic") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "ai_property_aggregate_contribution_mentions_issue_group_idx" ON "ai_property_aggregate_contribution_mentions" USING btree ("organization_id","property_id","issue_group_id") WHERE "ai_property_aggregate_contribution_mentions"."issue_group_id" IS NOT NULL;
