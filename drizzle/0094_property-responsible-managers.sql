CREATE TABLE "property_responsible_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" varchar(500),
	CONSTRAINT "property_rm_interval_valid" CHECK ("property_responsible_managers"."effective_to" IS NULL OR "property_responsible_managers"."effective_to" > "property_responsible_managers"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "responsible_manager_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "responsibility_needed_since" timestamp with time zone;--> statement-breakpoint
-- Access and creation provenance are not evidence of explicit responsibility.
-- Existing live Properties therefore enter the visible recovery state rather
-- than receiving a guessed manager assignment.
UPDATE "properties"
SET "responsibility_needed_since" = "created_at"
WHERE "deleted_at" IS NULL
  AND "responsibility_needed_since" IS NULL;--> statement-breakpoint
ALTER TABLE "property_responsible_managers" ADD CONSTRAINT "property_rm_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_rm_org_property_idx" ON "property_responsible_managers" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "property_rm_org_user_idx" ON "property_responsible_managers" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_rm_unique_active_manager" ON "property_responsible_managers" USING btree ("organization_id","property_id","user_id") WHERE effective_to IS NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_responsible_manager_revision_positive" CHECK ("properties"."responsible_manager_revision" >= 1);
