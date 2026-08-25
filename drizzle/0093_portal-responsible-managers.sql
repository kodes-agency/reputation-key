CREATE TABLE "portal_responsible_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" varchar(500),
	CONSTRAINT "prm_interval_valid" CHECK ("portal_responsible_managers"."effective_to" IS NULL OR "portal_responsible_managers"."effective_to" > "portal_responsible_managers"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "created_by" varchar(255);--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "responsible_manager_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "portals" ADD COLUMN "responsibility_needed_since" timestamp with time zone;--> statement-breakpoint
UPDATE "portals"
SET "responsibility_needed_since" = "created_at"
WHERE "deleted_at" IS NULL
	AND "publication_state" <> 'archived';--> statement-breakpoint
ALTER TABLE "portal_responsible_managers" ADD CONSTRAINT "prm_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prm_org_portal_idx" ON "portal_responsible_managers" USING btree ("organization_id","portal_id");--> statement-breakpoint
CREATE INDEX "prm_org_user_idx" ON "portal_responsible_managers" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prm_unique_active_manager" ON "portal_responsible_managers" USING btree ("organization_id","portal_id","user_id") WHERE effective_to IS NULL;--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_responsible_manager_revision_positive" CHECK ("portals"."responsible_manager_revision" >= 1);
