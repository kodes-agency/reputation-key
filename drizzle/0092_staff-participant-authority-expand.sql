CREATE TYPE "public"."staff_participant_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "staff_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" "staff_participant_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_participants_lifecycle_consistent" CHECK (("staff_participants"."status" = 'active' AND "staff_participants"."archived_at" IS NULL AND "staff_participants"."archive_reason" IS NULL) OR ("staff_participants"."status" = 'archived' AND "staff_participants"."archived_at" IS NOT NULL AND "staff_participants"."archive_reason" IS NOT NULL)),
	CONSTRAINT "staff_participants_revision_positive" CHECK ("staff_participants"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "staff_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"staff_participant_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" text,
	CONSTRAINT "staff_user_links_interval_valid" CHECK ("staff_user_links"."effective_to" IS NULL OR "staff_user_links"."effective_to" > "staff_user_links"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "staff_participations" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_participations" ADD COLUMN "staff_participant_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_participations" ADD COLUMN "archive_reason" text;--> statement-breakpoint
ALTER TABLE "staff_participations" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_participants_org_id_key" ON "staff_participants" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "staff_participants_org_status_name_idx" ON "staff_participants" USING btree ("organization_id","status","display_name");--> statement-breakpoint
CREATE TEMP TABLE "staff_participant_0092_map" (
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"staff_participant_id" uuid NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	PRIMARY KEY ("organization_id", "user_id")
) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "staff_participant_0092_map" (
	"organization_id", "user_id", "staff_participant_id", "display_name",
	"started_at", "created_at"
)
SELECT
	sp."organization_id",
	sp."user_id",
	gen_random_uuid(),
	(array_agg(sp."display_name" ORDER BY sp."created_at", sp."id"))[1],
	min(sp."started_at"),
	min(sp."created_at")
FROM "staff_participations" sp
WHERE sp."user_id" IS NOT NULL
GROUP BY sp."organization_id", sp."user_id";--> statement-breakpoint
INSERT INTO "staff_participants" (
	"id", "organization_id", "display_name", "status", "revision",
	"created_by", "created_at", "updated_at"
)
SELECT
	m."staff_participant_id", m."organization_id", m."display_name", 'active', 1,
	'migration:0092', m."created_at", m."created_at"
FROM "staff_participant_0092_map" m;--> statement-breakpoint
INSERT INTO "staff_user_links" (
	"organization_id", "staff_participant_id", "user_id", "effective_from",
	"created_by"
)
SELECT
	m."organization_id", m."staff_participant_id", m."user_id", m."started_at",
	'migration:0092'
FROM "staff_participant_0092_map" m;--> statement-breakpoint
UPDATE "staff_participations" sp
SET "staff_participant_id" = m."staff_participant_id"
FROM "staff_participant_0092_map" m
WHERE sp."organization_id" = m."organization_id"
	AND sp."user_id" = m."user_id";--> statement-breakpoint
UPDATE "staff_participations"
SET "archive_reason" = 'legacy_unspecified'
WHERE "status" = 'archived' AND "archive_reason" IS NULL;--> statement-breakpoint
DROP TABLE "staff_participant_0092_map";--> statement-breakpoint
ALTER TABLE "staff_user_links" ADD CONSTRAINT "staff_user_links_participant_tenant_fk" FOREIGN KEY ("organization_id","staff_participant_id") REFERENCES "public"."staff_participants"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_user_links_org_participant_idx" ON "staff_user_links" USING btree ("organization_id","staff_participant_id");--> statement-breakpoint
CREATE INDEX "staff_user_links_org_user_idx" ON "staff_user_links" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_links_unique_active_participant" ON "staff_user_links" USING btree ("organization_id","staff_participant_id") WHERE effective_to IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_links_unique_active_user" ON "staff_user_links" USING btree ("organization_id","user_id") WHERE effective_to IS NULL;--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_participant_tenant_fk" FOREIGN KEY ("organization_id","staff_participant_id") REFERENCES "public"."staff_participants"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sp_unique_active_participant" ON "staff_participations" USING btree ("organization_id","property_id","staff_participant_id") WHERE status = 'active' AND staff_participant_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_archive_reason_consistent" CHECK (("staff_participations"."status" = 'archived' AND "staff_participations"."archive_reason" IS NOT NULL) OR ("staff_participations"."status" <> 'archived' AND "staff_participations"."archive_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_revision_positive" CHECK ("staff_participations"."revision" >= 1);
