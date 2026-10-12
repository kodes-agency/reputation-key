-- A goal month can carry its own target (flexible goal months, slice 3a).
--
-- Purely additive. Old web and worker code never reads or writes these: nothing
-- sets `target_value` until the "change this month's target" command ships in
-- the next slice, and every statement existing code runs names its columns.
--
-- `goal_monthly_results.target_value` is the target of that one month. NULL
-- means "use the target of the month's Program version", which is every row
-- today. A version cannot be split in the middle of a month, and updating a
-- version's target would retarget the months it has already closed, so the
-- month row is the carrier: it is frozen by its guard once closed.
--
-- `goal_month_target_changes` logs each change with who, when, the old and the
-- new value and an optional note. One command writes one row per month it
-- changed, all sharing `change_id`, and never two rows for the same month.
-- `following_outcome` records what happened to the months after it (the
-- outcome, not the tick in the form), with `following_reason` when it was not
-- applied and `following_version_id` when a Program version carries the new
-- target forward. The log has no guard trigger: it records a value from before
-- the month closed, not closed evidence, and a trigger would need a bypass in
-- the Organization purge.
--
-- A log row names a Program, a month and sometimes a following version. The
-- month and the version must belong to that Program, not just to its Property:
-- the log is read by Program, so a row filed under another Program would show a
-- change on the wrong goal. Both references therefore include `program_id`,
-- and each referenced table gains the unique index such a reference needs
-- (`id` is already the primary key, so the index can never refuse a row).
--
-- Statement order. The whole file runs in one transaction, and every goal write
-- touches its Program first, then versions, then months. The statements take
-- their locks in that order: Programs, versions, and only then the ACCESS
-- EXCLUSIVE lock on months. Taking months first could deadlock with a goal
-- command or the maintenance job that had already written its Program. The two
-- keys are unique indexes, not constraints, because building an index blocks
-- writers only; a constraint would lock readers of the versions out for the
-- rest of the migration.
CREATE TABLE "goal_month_target_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"monthly_result_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"previous_target_value" numeric(30, 10) NOT NULL,
	"new_target_value" numeric(30, 10) NOT NULL,
	"following_outcome" varchar(32) NOT NULL,
	"following_reason" varchar(40),
	"following_version_id" uuid,
	"note" text,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_month_target_changes_change_result_key" UNIQUE("change_id","monthly_result_id"),
	CONSTRAINT "goal_month_target_changes_outcome_check" CHECK ("goal_month_target_changes"."following_outcome" IN ('applied', 'replaced_scheduled_change', 'kept_scheduled_change', 'not_applied', 'not_requested')),
	CONSTRAINT "goal_month_target_changes_note_check" CHECK ("goal_month_target_changes"."note" IS NULL OR char_length(btrim("goal_month_target_changes"."note")) BETWEEN 1 AND 500),
	CONSTRAINT "goal_month_target_changes_value_check" CHECK ("goal_month_target_changes"."new_target_value" > 0 AND "goal_month_target_changes"."new_target_value" <> "goal_month_target_changes"."previous_target_value")
);
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_program_fk" FOREIGN KEY ("organization_id","property_id","program_id") REFERENCES "public"."goal_programs"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "goal_program_versions_target_change_fk_key" ON "goal_program_versions" USING btree ("organization_id","property_id","program_id","id");
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_following_version_fk" FOREIGN KEY ("organization_id","property_id","program_id","following_version_id") REFERENCES "public"."goal_program_versions"("organization_id","property_id","program_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD COLUMN "target_value" numeric(30, 10);
--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD CONSTRAINT "goal_monthly_results_target_value_check" CHECK ("goal_monthly_results"."target_value" IS NULL OR "goal_monthly_results"."target_value" > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX "goal_monthly_results_target_change_fk_key" ON "goal_monthly_results" USING btree ("organization_id","property_id","program_id","id");
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_result_fk" FOREIGN KEY ("organization_id","property_id","program_id","monthly_result_id") REFERENCES "public"."goal_monthly_results"("organization_id","property_id","program_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "goal_month_target_changes_program_idx" ON "goal_month_target_changes" USING btree ("organization_id","property_id","program_id","created_at");
--> statement-breakpoint
-- The monthly-result guard gains the target lock and the measure rule:
--
--   1. A month's target may change only while the row is `open` and its period
--      has not ended on the database clock. Afterwards it is locked (55000),
--      whether the change sets, replaces or removes the target.
--   2. A new row may bring a target only under the same condition: it is
--      `open` and its period has not ended (55000 otherwise). The application
--      always opens a month with NULL; this keeps "the month has its own
--      target" meaning "it was set while the month ran" for any writer.
--   3. A month's own target obeys the rule of its version's measure, the one
--      `goal_program_versions_target_check` applies to a version: a whole
--      number above zero for scans and rating counts, 1 to 5 in tenths for a
--      rating average (23514). The row has no measure of its own, so a table
--      CHECK cannot say this; the guard already reads the version.
--
-- A statement that leaves `target_value` alone, or inserts a row without one,
-- is judged exactly as before, so opening, reconciling and closing a month keep
-- working for code that predates this column.
--
-- The whole function is restated because PL/pgSQL has no partial replace. It is
-- identical to src/shared/db/db-constructs.sql, which carries the same change so
-- a fresh database built from the baseline agrees with an upgraded one.
CREATE OR REPLACE FUNCTION public.guard_goal_monthly_result_v1()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  assignment_from timestamptz;
  assignment_to timestamptz;
  version_from timestamptz;
  version_to timestamptz;
  version_timezone varchar(64);
  version_metric varchar(40);
  expected_start timestamptz;
  expected_end timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goal monthly results cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'closed' THEN
    RAISE EXCEPTION 'closed goal monthly results are immutable; append a revision'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW."target_value" IS DISTINCT FROM OLD."target_value"
    AND (OLD."status" <> 'open' OR clock_timestamp() >= OLD."period_end")
  THEN
    RAISE EXCEPTION 'goal monthly result target is locked once its period ends'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT'
    AND NEW."target_value" IS NOT NULL
    AND (NEW."status" <> 'open' OR clock_timestamp() >= NEW."period_end")
  THEN
    RAISE EXCEPTION 'goal monthly result target is locked once its period ends'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'open' AND NEW."status" = 'reconciling')
    OR (OLD."status" = 'reconciling' AND NEW."status" = 'closed')
  ) THEN
    RAISE EXCEPTION 'invalid goal monthly result transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  SELECT
    assignment."effective_from",
    assignment."effective_to",
    version."effective_from",
    version."effective_to",
    version."property_timezone",
    version."metric_key"
  INTO
    assignment_from,
    assignment_to,
    version_from,
    version_to,
    version_timezone,
    version_metric
  FROM "goal_subject_assignments" assignment
  JOIN "goal_program_versions" version
    ON version."organization_id" = assignment."organization_id"
   AND version."property_id" = assignment."property_id"
   AND version."program_id" = assignment."program_id"
   AND version."id" = assignment."program_version_id"
  WHERE assignment."organization_id" = NEW."organization_id"
    AND assignment."property_id" = NEW."property_id"
    AND assignment."program_id" = NEW."program_id"
    AND assignment."program_version_id" = NEW."program_version_id"
    AND assignment."id" = NEW."assignment_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal monthly result assignment is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."target_value" IS NOT NULL AND NOT (
    (
      version_metric IN ('qualified_scans', 'portal_rating_count')
      AND NEW."target_value" > 0
      AND NEW."target_value" = trunc(NEW."target_value")
    )
    OR (
      version_metric = 'portal_rating_average'
      AND NEW."target_value" BETWEEN 1 AND 5
      AND NEW."target_value" * 10 = trunc(NEW."target_value" * 10)
    )
  ) THEN
    RAISE EXCEPTION 'goal monthly result target breaks its measure rule'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."property_timezone" <> version_timezone THEN
    RAISE EXCEPTION 'goal monthly result timezone does not match its immutable program version'
      USING ERRCODE = '23514';
  END IF;

  expected_start := date_trunc('month', NEW."period_start" AT TIME ZONE version_timezone)
    AT TIME ZONE version_timezone;
  expected_end := (
    date_trunc('month', NEW."period_start" AT TIME ZONE version_timezone) + interval '1 month'
  ) AT TIME ZONE version_timezone;

  IF NEW."period_start" <> expected_start OR NEW."period_end" <> expected_end THEN
    RAISE EXCEPTION 'goal monthly result must cover one complete property-local calendar month'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."period_start" < assignment_from
    OR (assignment_to IS NOT NULL AND NEW."period_end" > assignment_to)
    OR NEW."period_start" < version_from
    OR (version_to IS NOT NULL AND NEW."period_end" > version_to)
  THEN
    RAISE EXCEPTION 'goal monthly result falls outside its assignment or version window'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'reconciling' AND clock_timestamp() < NEW."period_end" THEN
    RAISE EXCEPTION 'goal monthly result cannot reconcile before its period ends'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'closed'
    AND clock_timestamp() < NEW."period_end" + interval '24 hours'
  THEN
    RAISE EXCEPTION 'goal monthly result cannot close before the reconciliation window ends'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$
;
