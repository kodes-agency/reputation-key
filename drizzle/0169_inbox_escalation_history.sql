-- Append-only Inbox escalation history (IBX-01).
--
-- `inbox_items` retains only the LATEST escalation flags, so the complete
-- escalation history of a Handling Cycle cannot be presented: a second
-- escalate/resolve pair overwrites the first without leaving evidence.
--
-- This table mirrors `inbox_assignment_history` exactly: the resulting item
-- command revision is the history identity, so the projection row and its
-- escalation fact can never disagree about which command committed.
--
-- Per ADR 0023 escalation remains an INDEPENDENT workflow dimension. This
-- table therefore carries no status column, no assignee, and no permission —
-- it grants nothing and changes nothing about open/closed.
--
-- Expand-only: no column is removed, `inbox_items` keeps every escalation
-- flag, and no pre-existing row is rewritten or back-filled. Items escalated
-- before this migration have no row here on purpose; readers classify them
-- `legacy_unknown` rather than inventing an actor or a time.
CREATE TABLE "inbox_escalation_history" (
	"inbox_item_id" uuid NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"handling_cycle_number" bigint,
	"kind" varchar(16) NOT NULL,
	"actor_user_id" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_escalation_history_pk" PRIMARY KEY("inbox_item_id","resulting_command_revision"),
	CONSTRAINT "inbox_escalation_history_revision_safe" CHECK ("inbox_escalation_history"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND ("inbox_escalation_history"."handling_cycle_number" IS NULL OR "inbox_escalation_history"."handling_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "inbox_escalation_history_kind_valid" CHECK ("inbox_escalation_history"."kind" IN ('escalated', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "inbox_escalation_history" ADD CONSTRAINT "inbox_escalation_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_escalation_history_scope_idx" ON "inbox_escalation_history" USING btree ("organization_id","property_id","occurred_at","inbox_item_id");--> statement-breakpoint
CREATE INDEX "inbox_escalation_history_item_idx" ON "inbox_escalation_history" USING btree ("inbox_item_id","occurred_at");--> statement-breakpoint

-- Mirrors reject_inbox_assignment_history_mutation_v1: rewrites, direct
-- deletes and truncation are all refused; only the FK cascade that follows an
-- already-removed inbox item may remove a row.
CREATE OR REPLACE FUNCTION "reject_inbox_escalation_history_mutation_v1"() RETURNS trigger
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
    MESSAGE = 'inbox escalation history is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_escalation_history_immutable"
BEFORE UPDATE OR DELETE ON "inbox_escalation_history"
FOR EACH ROW EXECUTE FUNCTION "reject_inbox_escalation_history_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "inbox_escalation_history_truncate_guard"
BEFORE TRUNCATE ON "inbox_escalation_history"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_inbox_escalation_history_mutation_v1"();--> statement-breakpoint
ALTER TABLE "inbox_escalation_history"
ENABLE ALWAYS TRIGGER "inbox_escalation_history_immutable";--> statement-breakpoint
ALTER TABLE "inbox_escalation_history"
ENABLE ALWAYS TRIGGER "inbox_escalation_history_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inbox_escalation_history" FROM PUBLIC;
