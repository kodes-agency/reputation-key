CREATE TABLE "inbox_feedback_handling_outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"outcome_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" DEFAULT 'feedback' NOT NULL,
	"feedback_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"outcome" varchar(48) NOT NULL,
	"internal_note" text,
	"recorded_by" varchar(255) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"completion_at" timestamp with time zone NOT NULL,
	"completion_state_revision" bigint NOT NULL,
	"deadline_result" varchar(24) NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"supersedes_outcome_id" uuid,
	"supersedes_outcome_revision" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_feedback_handling_outcomes_values_valid" CHECK ("inbox_feedback_handling_outcomes"."source_type" = 'feedback'
        AND "inbox_feedback_handling_outcomes"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."outcome_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."completion_state_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."outcome" IN (
          'follow_up_completed', 'follow_up_attempted', 'handled_with_team',
          'reviewed_no_additional_step', 'content_concern_reviewed'
        )
        AND "inbox_feedback_handling_outcomes"."deadline_result" IN ('on_time', 'late', 'not_measured')
        AND ("inbox_feedback_handling_outcomes"."internal_note" IS NULL OR length(btrim("inbox_feedback_handling_outcomes"."internal_note")) BETWEEN 1 AND 2000)
        AND "inbox_feedback_handling_outcomes"."recorded_at" >= "inbox_feedback_handling_outcomes"."completion_at"
        AND (
          ("inbox_feedback_handling_outcomes"."outcome_revision" = 1 AND "inbox_feedback_handling_outcomes"."supersedes_outcome_id" IS NULL AND "inbox_feedback_handling_outcomes"."supersedes_outcome_revision" IS NULL)
          OR ("inbox_feedback_handling_outcomes"."outcome_revision" > 1 AND "inbox_feedback_handling_outcomes"."supersedes_outcome_id" IS NOT NULL
            AND "inbox_feedback_handling_outcomes"."supersedes_outcome_revision" = "inbox_feedback_handling_outcomes"."outcome_revision" - 1)
        ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_handling_cycles_outcome_scope_unique" ON "inbox_handling_cycles" USING btree ("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision");--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes" ADD CONSTRAINT "inbox_feedback_handling_outcomes_cycle_scope_fk" FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","source_type","feedback_id","source_revision") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes" ADD CONSTRAINT "inbox_feedback_handling_outcomes_completion_transition_fk" FOREIGN KEY ("inbox_item_id","completion_state_revision") REFERENCES "public"."inbox_handling_cycle_transitions"("inbox_item_id","state_revision") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_chain_target_unique" ON "inbox_feedback_handling_outcomes" USING btree ("inbox_item_id","cycle_number","id","outcome_revision");--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes" ADD CONSTRAINT "inbox_feedback_handling_outcomes_supersedes_fk" FOREIGN KEY ("inbox_item_id","cycle_number","supersedes_outcome_id","supersedes_outcome_revision") REFERENCES "public"."inbox_feedback_handling_outcomes"("inbox_item_id","cycle_number","id","outcome_revision") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_cycle_revision_unique" ON "inbox_feedback_handling_outcomes" USING btree ("inbox_item_id","cycle_number","outcome_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_command_revision_unique" ON "inbox_feedback_handling_outcomes" USING btree ("inbox_item_id","resulting_command_revision");--> statement-breakpoint
CREATE INDEX "inbox_feedback_handling_outcomes_scope_idx" ON "inbox_feedback_handling_outcomes" USING btree ("organization_id","property_id","inbox_item_id","cycle_number","outcome_revision");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_inbox_feedback_handling_outcome_append_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  completion_transition public.inbox_handling_cycle_transitions%ROWTYPE;
  previous_outcome public.inbox_feedback_handling_outcomes%ROWTYPE;
BEGIN
  SELECT * INTO completion_transition
  FROM public.inbox_handling_cycle_transitions
  WHERE inbox_item_id = NEW.inbox_item_id
    AND state_revision = NEW.completion_state_revision;

  IF NOT FOUND
     OR completion_transition.cycle_number <> NEW.cycle_number
     OR completion_transition.kind <> 'closed'
     OR completion_transition.transition_reason <> 'private_feedback_handled'
     OR completion_transition.transitioned_at <> NEW.completion_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'feedback outcome requires its private_feedback_handled completion transition';
  END IF;

  IF NEW.outcome_revision = 1 THEN
    IF NEW.recorded_at <> NEW.completion_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'initial feedback outcome must be recorded at completion';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous_outcome
  FROM public.inbox_feedback_handling_outcomes
  WHERE inbox_item_id = NEW.inbox_item_id
    AND cycle_number = NEW.cycle_number
    AND id = NEW.supersedes_outcome_id
    AND outcome_revision = NEW.supersedes_outcome_revision;

  IF NOT FOUND
     OR NEW.completion_at <> previous_outcome.completion_at
     OR NEW.completion_state_revision <> previous_outcome.completion_state_revision
     OR NEW.deadline_result <> previous_outcome.deadline_result
     OR NEW.recorded_at < previous_outcome.recorded_at
     OR NEW.resulting_command_revision <= previous_outcome.resulting_command_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'feedback outcome correction must preserve and directly supersede completion facts';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_feedback_handling_outcomes_append_guard"
BEFORE INSERT ON "inbox_feedback_handling_outcomes"
FOR EACH ROW EXECUTE FUNCTION "enforce_inbox_feedback_handling_outcome_append_v1"();--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes"
ENABLE ALWAYS TRIGGER "inbox_feedback_handling_outcomes_append_guard";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_inbox_feedback_handling_outcome_mutation_v1"() RETURNS trigger
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
    MESSAGE = 'private-feedback handling outcome history is immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_feedback_handling_outcomes_immutable"
BEFORE UPDATE OR DELETE ON "inbox_feedback_handling_outcomes"
FOR EACH ROW EXECUTE FUNCTION "reject_inbox_feedback_handling_outcome_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "inbox_feedback_handling_outcomes_truncate_guard"
BEFORE TRUNCATE ON "inbox_feedback_handling_outcomes"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_inbox_feedback_handling_outcome_mutation_v1"();--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes"
ENABLE ALWAYS TRIGGER "inbox_feedback_handling_outcomes_immutable";--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes"
ENABLE ALWAYS TRIGGER "inbox_feedback_handling_outcomes_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inbox_feedback_handling_outcomes" FROM PUBLIC;
