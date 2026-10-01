-- Portal Group history and group creator (round 4, slice 37).
--
-- Purely additive. `portal_groups.created_by` records who created a group; it is
-- null for a group made before this migration, because nothing recorded it.
-- `portal_group_history` is the ledger of what happened to a group and to the
-- Portals in it (created, renamed with the previous name, archived, Portal
-- added, removed, moved in or out), written in the same transaction as each
-- change. History starts at the deploy: earlier changes are not reconstructed,
-- because a group's earlier names were never kept.
ALTER TABLE "portal_groups" ADD COLUMN "created_by" varchar(255);--> statement-breakpoint
CREATE TABLE "portal_group_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_group_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"portal_id" uuid,
	"other_group_id" uuid,
	"name" varchar(100),
	"previous_name" varchar(100),
	"actor_user_id" varchar(255) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_group_history_kind_valid" CHECK ("portal_group_history"."kind" IN ('created', 'renamed', 'archived', 'portal_added', 'portal_removed', 'portal_moved_in', 'portal_moved_out')),
	CONSTRAINT "portal_group_history_shape" CHECK (("portal_group_history"."kind" = 'created' AND "portal_group_history"."name" IS NOT NULL AND "portal_group_history"."previous_name" IS NULL AND "portal_group_history"."portal_id" IS NULL AND "portal_group_history"."other_group_id" IS NULL)
        OR ("portal_group_history"."kind" = 'renamed' AND "portal_group_history"."name" IS NOT NULL AND "portal_group_history"."previous_name" IS NOT NULL AND "portal_group_history"."portal_id" IS NULL AND "portal_group_history"."other_group_id" IS NULL)
        OR ("portal_group_history"."kind" = 'archived' AND "portal_group_history"."name" IS NULL AND "portal_group_history"."previous_name" IS NULL AND "portal_group_history"."portal_id" IS NULL AND "portal_group_history"."other_group_id" IS NULL)
        OR ("portal_group_history"."kind" IN ('portal_added', 'portal_removed') AND "portal_group_history"."name" IS NULL AND "portal_group_history"."previous_name" IS NULL AND "portal_group_history"."portal_id" IS NOT NULL AND "portal_group_history"."other_group_id" IS NULL)
        OR ("portal_group_history"."kind" IN ('portal_moved_in', 'portal_moved_out') AND "portal_group_history"."name" IS NULL AND "portal_group_history"."previous_name" IS NULL AND "portal_group_history"."portal_id" IS NOT NULL AND "portal_group_history"."other_group_id" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "portal_group_history" ADD CONSTRAINT "portal_group_history_group_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_group_id") REFERENCES "public"."portal_groups"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portal_group_history_group_idx" ON "portal_group_history" USING btree ("organization_id","portal_group_id","occurred_at");
