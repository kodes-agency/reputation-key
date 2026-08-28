CREATE TABLE "inbox_response_target_organization_policies" (
	"organization_id" varchar(255) NOT NULL,
	"target_kind" varchar(48) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"policy_version" bigint NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_response_target_organization_policies_pk" PRIMARY KEY("organization_id","target_kind"),
	CONSTRAINT "inbox_response_target_organization_policies_values_valid" CHECK ("target_kind" IN ('google_review_response', 'private_feedback_handling')
        AND "duration_minutes" BETWEEN 1 AND 43200
        AND "policy_version" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "inbox_private_feedback_target_property_overrides" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"duration_minutes" integer,
	"policy_version" bigint NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_private_feedback_target_property_overrides_pk" PRIMARY KEY("organization_id","property_id"),
	CONSTRAINT "inbox_private_feedback_target_property_overrides_values_valid" CHECK ((("enabled" AND "duration_minutes" BETWEEN 1 AND 43200)
          OR (NOT "enabled" AND "duration_minutes" IS NULL))
        AND "policy_version" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "inbox_handling_cycle_response_targets" (
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"target_kind" varchar(48) NOT NULL,
	"performance_eligibility" varchar(32) NOT NULL,
	"duration_minutes" integer,
	"policy_source" varchar(32),
	"policy_version" bigint,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completion_at" timestamp with time zone,
	"result" varchar(24),
	"stop_reason" varchar(48),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycle_response_targets_pk" PRIMARY KEY("inbox_item_id","cycle_number"),
	CONSTRAINT "inbox_handling_cycle_response_targets_values_valid" CHECK ("cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "target_kind" IN ('google_review_response', 'private_feedback_handling')
        AND "performance_eligibility" IN ('measured', 'legacy_unknown', 'historical_onboarding')
        AND (
          ("target_kind" = 'google_review_response' AND "source_type" = 'review')
          OR ("target_kind" = 'private_feedback_handling' AND "source_type" = 'feedback')
        )
        AND (
          (
            "performance_eligibility" = 'measured'
            AND "duration_minutes" BETWEEN 1 AND 43200
            AND "policy_source" IN ('builtin_default', 'organization_policy', 'property_override')
            AND ("target_kind" = 'private_feedback_handling' OR "policy_source" <> 'property_override')
            AND "policy_version" BETWEEN 1 AND '9007199254740991'::bigint
            AND "start_at" IS NOT NULL
            AND "due_at" = "start_at" + make_interval(mins => "duration_minutes")
          ) OR (
            "performance_eligibility" <> 'measured'
            AND "duration_minutes" IS NULL
            AND "policy_source" IS NULL
            AND "policy_version" IS NULL
            AND "start_at" IS NULL
            AND "due_at" IS NULL
          )
        )
        AND (
          ("completion_at" IS NULL AND "result" IS NULL AND "stop_reason" IS NULL)
          OR (
            "performance_eligibility" = 'measured'
            AND "completion_at" >= "start_at"
            AND (
              ("result" IN ('on_time', 'late') AND "stop_reason" IN ('private_feedback_handled', 'confirmed_on_google'))
              OR ("result" = 'cancelled' AND "stop_reason" = 'guest_withdrawn')
            )
            AND (
              "result" = 'cancelled'
              OR (
                (("result" = 'on_time') = ("completion_at" <= "due_at"))
                AND (("result" = 'late') = ("completion_at" > "due_at"))
              )
            )
          )
        )),
	CONSTRAINT "inbox_handling_cycle_response_targets_source_stop_valid" CHECK ("stop_reason" IS NULL
        OR ("target_kind" = 'private_feedback_handling' AND "stop_reason" IN ('private_feedback_handled', 'guest_withdrawn'))
        OR ("target_kind" = 'google_review_response' AND "stop_reason" = 'confirmed_on_google'))
);
--> statement-breakpoint
CREATE TABLE "inbox_response_target_reminders" (
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"reminder_kind" varchar(24) NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"target_kind" varchar(48) NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_response_target_reminders_pk" PRIMARY KEY("inbox_item_id","cycle_number","reminder_kind"),
	CONSTRAINT "inbox_response_target_reminders_values_valid" CHECK ("cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reminder_kind" IN ('halfway', 'target_passed')
        AND "target_kind" IN ('google_review_response', 'private_feedback_handling')
        AND NOT ("delivered_at" IS NOT NULL AND "cancelled_at" IS NOT NULL)
        AND ("delivered_at" IS NULL OR "delivered_at" >= "scheduled_for"))
);
--> statement-breakpoint
ALTER TABLE "inbox_private_feedback_target_property_overrides" ADD CONSTRAINT "inbox_private_feedback_target_property_overrides_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_handling_cycle_response_targets_scope_unique" ON "inbox_handling_cycle_response_targets" USING btree ("inbox_item_id","cycle_number","organization_id","property_id","target_kind");--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets" ADD CONSTRAINT "inbox_handling_cycle_response_targets_cycle_scope_fk" FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_response_targets_active_due_idx" ON "inbox_handling_cycle_response_targets" USING btree ("organization_id","target_kind","due_at","inbox_item_id") WHERE "completion_at" IS NULL AND "performance_eligibility" = 'measured';--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_response_targets_property_result_idx" ON "inbox_handling_cycle_response_targets" USING btree ("organization_id","property_id","target_kind","result","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_response_target_reminders_event_unique" ON "inbox_response_target_reminders" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "inbox_response_target_reminders" ADD CONSTRAINT "inbox_response_target_reminders_target_scope_fk" FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","target_kind") REFERENCES "public"."inbox_handling_cycle_response_targets"("inbox_item_id","cycle_number","organization_id","property_id","target_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_response_target_reminders_due_idx" ON "inbox_response_target_reminders" USING btree ("scheduled_for","inbox_item_id","cycle_number","reminder_kind") WHERE "delivered_at" IS NULL AND "cancelled_at" IS NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_inbox_response_target_terminal_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycles
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target history is immutable';
  END IF;

  IF NEW.inbox_item_id <> OLD.inbox_item_id
     OR NEW.cycle_number <> OLD.cycle_number
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.source_type <> OLD.source_type
     OR NEW.source_id <> OLD.source_id
     OR NEW.source_revision <> OLD.source_revision
     OR NEW.target_kind <> OLD.target_kind
     OR NEW.performance_eligibility <> OLD.performance_eligibility
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
     OR NEW.policy_source IS DISTINCT FROM OLD.policy_source
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.start_at IS DISTINCT FROM OLD.start_at
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.created_at <> OLD.created_at
     OR OLD.completion_at IS NOT NULL
     OR NEW.completion_at IS NULL
     OR NEW.result IS NULL
     OR NEW.stop_reason IS NULL
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target snapshot or terminal result cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_handling_cycle_response_targets_terminal_guard"
BEFORE UPDATE OR DELETE ON "inbox_handling_cycle_response_targets"
FOR EACH ROW EXECUTE FUNCTION "enforce_inbox_response_target_terminal_v1"();--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets" ENABLE ALWAYS TRIGGER "inbox_handling_cycle_response_targets_terminal_guard";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "validate_inbox_response_target_reminder_schedule_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_start timestamptz;
  target_due timestamptz;
  target_duration integer;
  target_eligibility varchar(32);
BEGIN
  SELECT start_at, due_at, duration_minutes, performance_eligibility
    INTO target_start, target_due, target_duration, target_eligibility
  FROM public.inbox_handling_cycle_response_targets
  WHERE inbox_item_id = NEW.inbox_item_id
    AND cycle_number = NEW.cycle_number
    AND organization_id = NEW.organization_id
    AND property_id = NEW.property_id
    AND target_kind = NEW.target_kind;

  IF NOT FOUND THEN
    RETURN NEW; -- The composite foreign key provides the canonical error.
  END IF;

  IF target_eligibility <> 'measured'
     OR (NEW.reminder_kind = 'halfway'
         AND NEW.scheduled_for <> target_start + make_interval(secs => target_duration * 30))
     OR (NEW.reminder_kind = 'target_passed' AND NEW.scheduled_for <> target_due) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Response Target reminder schedule does not match its snapshot';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_response_target_reminders_schedule_guard"
BEFORE INSERT ON "inbox_response_target_reminders"
FOR EACH ROW EXECUTE FUNCTION "validate_inbox_response_target_reminder_schedule_v1"();--> statement-breakpoint
ALTER TABLE "inbox_response_target_reminders" ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_schedule_guard";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_inbox_response_target_reminder_terminal_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (
         SELECT 1 FROM public.inbox_handling_cycle_response_targets
         WHERE inbox_item_id = OLD.inbox_item_id AND cycle_number = OLD.cycle_number
       ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target reminder history is immutable';
  END IF;

  IF NEW.inbox_item_id <> OLD.inbox_item_id
     OR NEW.cycle_number <> OLD.cycle_number
     OR NEW.reminder_kind <> OLD.reminder_kind
     OR NEW.event_id <> OLD.event_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.property_id <> OLD.property_id
     OR NEW.target_kind <> OLD.target_kind
     OR NEW.scheduled_for <> OLD.scheduled_for
     OR NEW.created_at <> OLD.created_at
     OR OLD.delivered_at IS NOT NULL
     OR OLD.cancelled_at IS NOT NULL
     OR ((NEW.delivered_at IS NOT NULL)::integer + (NEW.cancelled_at IS NOT NULL)::integer) <> 1
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target reminder cannot be repeated or rewritten';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_response_target_reminders_terminal_guard"
BEFORE UPDATE OR DELETE ON "inbox_response_target_reminders"
FOR EACH ROW EXECUTE FUNCTION "enforce_inbox_response_target_reminder_terminal_v1"();--> statement-breakpoint
ALTER TABLE "inbox_response_target_reminders" ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_terminal_guard";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_inbox_response_target_truncate_v1"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Response Target history cannot be truncated';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inbox_handling_cycle_response_targets_truncate_guard"
BEFORE TRUNCATE ON "inbox_handling_cycle_response_targets"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_inbox_response_target_truncate_v1"();--> statement-breakpoint
CREATE TRIGGER "inbox_response_target_reminders_truncate_guard"
BEFORE TRUNCATE ON "inbox_response_target_reminders"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_inbox_response_target_truncate_v1"();--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets" ENABLE ALWAYS TRIGGER "inbox_handling_cycle_response_targets_truncate_guard";--> statement-breakpoint
ALTER TABLE "inbox_response_target_reminders" ENABLE ALWAYS TRIGGER "inbox_response_target_reminders_truncate_guard";--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inbox_handling_cycle_response_targets" FROM PUBLIC;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inbox_response_target_reminders" FROM PUBLIC;
