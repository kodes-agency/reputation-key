CREATE TABLE "portal_metric_lifetime_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"qualified_scan_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_sum" bigint DEFAULT 0 NOT NULL,
	"private_rating_1_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_2_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_3_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_4_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_5_count" bigint DEFAULT 0 NOT NULL,
	"private_feedback_count" bigint DEFAULT 0 NOT NULL,
	"google_review_selection_count" bigint DEFAULT 0 NOT NULL,
	"secondary_link_selection_count" bigint DEFAULT 0 NOT NULL,
	"sealed_qualified_scan_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_sum" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_1_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_2_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_3_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_4_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_5_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_feedback_count" bigint DEFAULT 0 NOT NULL,
	"sealed_google_review_selection_count" bigint DEFAULT 0 NOT NULL,
	"sealed_secondary_link_selection_count" bigint DEFAULT 0 NOT NULL,
	"sealed_through_local_date" varchar(10),
	"projection_revision" bigint DEFAULT 0 NOT NULL,
	"last_rebuilt_at" timestamp with time zone,
	"last_sealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_metric_lifetime_nonnegative_check" CHECK ("portal_metric_lifetime_aggregates"."qualified_scan_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_sum" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_1_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_2_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_3_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_4_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_5_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_feedback_count" >= 0 AND "portal_metric_lifetime_aggregates"."google_review_selection_count" >= 0 AND "portal_metric_lifetime_aggregates"."secondary_link_selection_count" >= 0),
	CONSTRAINT "portal_metric_lifetime_rating_check" CHECK ("portal_metric_lifetime_aggregates"."private_rating_1_count" + "portal_metric_lifetime_aggregates"."private_rating_2_count" + "portal_metric_lifetime_aggregates"."private_rating_3_count" + "portal_metric_lifetime_aggregates"."private_rating_4_count" + "portal_metric_lifetime_aggregates"."private_rating_5_count" = "portal_metric_lifetime_aggregates"."private_rating_count" AND "portal_metric_lifetime_aggregates"."private_rating_sum" BETWEEN "portal_metric_lifetime_aggregates"."private_rating_count" AND "portal_metric_lifetime_aggregates"."private_rating_count" * 5),
	CONSTRAINT "portal_metric_lifetime_sealed_nonnegative_check" CHECK ("portal_metric_lifetime_aggregates"."sealed_qualified_scan_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_sum" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_1_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_2_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_3_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_4_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_5_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_feedback_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_google_review_selection_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_secondary_link_selection_count" >= 0),
	CONSTRAINT "portal_metric_lifetime_sealed_rating_check" CHECK ("portal_metric_lifetime_aggregates"."sealed_private_rating_1_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_2_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_3_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_4_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_5_count" = "portal_metric_lifetime_aggregates"."sealed_private_rating_count" AND "portal_metric_lifetime_aggregates"."sealed_private_rating_sum" BETWEEN "portal_metric_lifetime_aggregates"."sealed_private_rating_count" AND "portal_metric_lifetime_aggregates"."sealed_private_rating_count" * 5),
	CONSTRAINT "portal_metric_lifetime_sealed_boundary_check" CHECK ("portal_metric_lifetime_aggregates"."sealed_through_local_date" IS NULL OR "portal_metric_lifetime_aggregates"."sealed_through_local_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "portal_pending_content_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"change_kind" varchar(40) NOT NULL,
	"change_key" varchar(160) DEFAULT 'all' NOT NULL,
	"source_version" varchar(160) NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"resolved_snapshot_id" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "portal_pending_content_changes_kind_valid" CHECK ("portal_pending_content_changes"."change_kind" IN ('portal_configuration', 'portal_links', 'property_brand_profile', 'property_brand_content', 'portal_localized_override', 'approved_destination')),
	CONSTRAINT "portal_pending_content_changes_resolution_pair" CHECK (("portal_pending_content_changes"."resolved_snapshot_id" IS NULL) = ("portal_pending_content_changes"."resolved_at" IS NULL)),
	CONSTRAINT "portal_pending_content_changes_resolution_time" CHECK ("portal_pending_content_changes"."resolved_at" IS NULL OR "portal_pending_content_changes"."resolved_at" >= "portal_pending_content_changes"."changed_at")
);
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "portal_destination_kind" varchar(24);--> statement-breakpoint
ALTER TABLE "portal_metric_lifetime_aggregates" ADD CONSTRAINT "portal_metric_lifetime_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_pending_content_changes" ADD CONSTRAINT "portal_pending_content_changes_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_pending_content_changes" ADD CONSTRAINT "portal_pending_content_changes_snapshot_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id","resolved_snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_metric_lifetime_scope_unique" ON "portal_metric_lifetime_aggregates" USING btree ("organization_id","property_id","portal_id");--> statement-breakpoint
CREATE INDEX "portal_metric_lifetime_property_idx" ON "portal_metric_lifetime_aggregates" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_pending_content_changes_source_unique" ON "portal_pending_content_changes" USING btree ("organization_id","portal_id","change_kind","change_key","source_version");--> statement-breakpoint
CREATE INDEX "portal_pending_content_changes_open_idx" ON "portal_pending_content_changes" USING btree ("organization_id","property_id","portal_id","changed_at") WHERE "portal_pending_content_changes"."resolved_at" IS NULL;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_portal_destination_kind_check" CHECK ("metric_readings"."portal_destination_kind" IS NULL OR ("metric_readings"."metric_key" = 'portal.review_link_click' AND "metric_readings"."portal_destination_kind" IN ('google_review', 'secondary_link')));--> statement-breakpoint
-- Legacy raw URLs cannot be proven safe from historical data alone. Keep the
-- manager-visible value for support-led classification, but fail closed so no
-- working-copy/public resolver treats an ambiguous URL as an approved target.
UPDATE "portal_links"
SET "legacy_destination_state" = 'quarantined', "updated_at" = now()
WHERE "destination_id" IS NULL
  AND "url" IS NOT NULL
  AND "legacy_destination_state" = 'unclassified';
