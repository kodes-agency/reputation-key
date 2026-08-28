CREATE TYPE "public"."inbox_assignment_reason" AS ENUM('claim', 'assign', 'reassign', 'release', 'eligibility_lost', 'reopen_restore');--> statement-breakpoint
CREATE TABLE "inbox_assignment_history" (
	"inbox_item_id" uuid NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"handling_cycle_number" bigint,
	"previous_assignee" varchar(255),
	"next_assignee" varchar(255),
	"reason" "inbox_assignment_reason" NOT NULL,
	"actor_user_id" varchar(255),
	"bulk_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_assignment_history_pk" PRIMARY KEY("inbox_item_id","resulting_command_revision"),
	CONSTRAINT "inbox_assignment_history_revision_safe" CHECK ("inbox_assignment_history"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND ("inbox_assignment_history"."handling_cycle_number" IS NULL OR "inbox_assignment_history"."handling_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "inbox_assignment_history_changes_assignee" CHECK ("inbox_assignment_history"."previous_assignee" IS DISTINCT FROM "inbox_assignment_history"."next_assignee")
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "command_revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_assignment_history" ADD CONSTRAINT "inbox_assignment_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_assignment_history_scope_idx" ON "inbox_assignment_history" USING btree ("organization_id","property_id","occurred_at","inbox_item_id");--> statement-breakpoint
CREATE INDEX "inbox_assignment_history_assignee_idx" ON "inbox_assignment_history" USING btree ("organization_id","next_assignee","occurred_at");--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_command_revision_safe" CHECK ("inbox_items"."command_revision" BETWEEN 1 AND '9007199254740991'::bigint);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_inbox_assignment_history_mutation_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND pg_trigger_depth() > 1
     AND NOT EXISTS (
       SELECT 1 FROM public.inbox_items WHERE id = OLD.inbox_item_id
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'inbox assignment history is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_assignment_history_immutable"
BEFORE UPDATE OR DELETE ON "inbox_assignment_history"
FOR EACH ROW EXECUTE FUNCTION "reject_inbox_assignment_history_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "inbox_assignment_history_truncate_guard"
BEFORE TRUNCATE ON "inbox_assignment_history"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_inbox_assignment_history_mutation_v1"();--> statement-breakpoint
ALTER TABLE "inbox_assignment_history"
ENABLE ALWAYS TRIGGER "inbox_assignment_history_immutable";--> statement-breakpoint
ALTER TABLE "inbox_assignment_history"
ENABLE ALWAYS TRIGGER "inbox_assignment_history_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inbox_assignment_history" FROM PUBLIC;
