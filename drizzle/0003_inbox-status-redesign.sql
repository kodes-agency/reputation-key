CREATE TABLE "inbox_user_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"last_inbox_view" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "status" SET DEFAULT 'open'::text;--> statement-breakpoint
DROP TYPE "public"."inbox_status";--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."inbox_status";--> statement-breakpoint
ALTER TABLE "inbox_items" ALTER COLUMN "status" SET DATA TYPE "public"."inbox_status" USING CASE WHEN "status" IN ('new', 'read') THEN 'open'::"public"."inbox_status" WHEN "status" IN ('addressed', 'archived', 'escalated') THEN 'closed'::"public"."inbox_status" ELSE 'open'::"public"."inbox_status" END;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "is_escalated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "escalated_by" varchar(255);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "escalation_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "escalation_resolved_by" varchar(255);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_user_views_org_user_unique" ON "inbox_user_views" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "inbox_items_org_escalated_active_idx" ON "inbox_items" USING btree ("organization_id","is_escalated","escalation_resolved_at");--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "read_at";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "addressed_at";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "archived_at";