ALTER TABLE "goal_monthly_results" DROP CONSTRAINT "goal_monthly_results_closed_check";--> statement-breakpoint
ALTER TABLE "goal_monthly_results" DROP CONSTRAINT "goal_monthly_results_source_check";--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD CONSTRAINT "goal_monthly_results_closed_check" CHECK (("goal_monthly_results"."status" = 'closed' AND "goal_monthly_results"."closed_at" IS NOT NULL AND "goal_monthly_results"."evaluation_watermark" IS NOT NULL AND "goal_monthly_results"."evaluation_state" <> 'updating') OR ("goal_monthly_results"."status" <> 'closed' AND "goal_monthly_results"."closed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD CONSTRAINT "goal_monthly_results_source_check" CHECK ((
        "goal_monthly_results"."source_complete_through" IS NULL OR "goal_monthly_results"."source_complete_through" <= "goal_monthly_results"."period_end"
      ) AND (
        "goal_monthly_results"."status" <> 'closed'
        OR "goal_monthly_results"."evaluation_state" NOT IN ('eligible', 'insufficient_data')
        OR "goal_monthly_results"."source_complete_through" = "goal_monthly_results"."period_end"
      ));--> statement-breakpoint
ALTER TABLE "goal_program_versions" ADD CONSTRAINT "goal_program_versions_metric_version_check" CHECK ((
        ("goal_program_versions"."metric_key" = 'qualified_scans' AND "goal_program_versions"."metric_definition_version_id" = '11111111-1111-4111-8111-111111111301'::uuid)
        OR ("goal_program_versions"."metric_key" = 'portal_rating_count' AND "goal_program_versions"."metric_definition_version_id" = '11111111-1111-4111-8111-111111111302'::uuid)
        OR ("goal_program_versions"."metric_key" = 'portal_rating_average' AND "goal_program_versions"."metric_definition_version_id" = '11111111-1111-4111-8111-111111111303'::uuid)
      ));--> statement-breakpoint

ALTER TABLE "goal_program_versions" ADD CONSTRAINT "gpv_no_overlapping_effective_intervals"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "property_id" WITH =,
    "program_id" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );--> statement-breakpoint

ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "gsa_no_overlapping_subject_metric_intervals"
  EXCLUDE USING gist (
    "organization_id" WITH =,
    "property_id" WITH =,
    "subject_kind" WITH =,
    (COALESCE("property_subject_id", "portal_group_id", "portal_id")) WITH =,
    "metric_key" WITH =,
    tstzrange("effective_from", "effective_to", '[)') WITH &&
  );--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_canonical_goal_append_only_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'goal_program_versions' AND TG_OP = 'UPDATE' THEN
    IF OLD."effective_to" IS NULL
      AND NEW."effective_to" IS NOT NULL
      AND NEW."effective_to" > OLD."effective_from"
      AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to')
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER goal_program_versions_append_only
BEFORE UPDATE OR DELETE ON "goal_program_versions"
FOR EACH ROW EXECUTE FUNCTION reject_canonical_goal_append_only_mutation_v1();--> statement-breakpoint

CREATE TRIGGER goal_result_revisions_append_only
BEFORE UPDATE OR DELETE ON "goal_result_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_canonical_goal_append_only_mutation_v1();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_goal_program_transition_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."current_version" < OLD."current_version" THEN
    RAISE EXCEPTION 'goal program current_version cannot move backwards'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'scheduled' AND NEW."status" = 'active')
    OR (OLD."status" = 'active' AND NEW."status" IN ('paused', 'ended'))
    OR (OLD."status" = 'paused' AND NEW."status" IN ('active', 'ended'))
  ) THEN
    RAISE EXCEPTION 'invalid goal program transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER goal_programs_transition_guard
BEFORE UPDATE ON "goal_programs"
FOR EACH ROW EXECUTE FUNCTION guard_goal_program_transition_v1();--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_goal_monthly_result_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assignment_from timestamptz;
  assignment_to timestamptz;
  version_from timestamptz;
  version_to timestamptz;
  version_timezone varchar(64);
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
    version."property_timezone"
  INTO
    assignment_from,
    assignment_to,
    version_from,
    version_to,
    version_timezone
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
$$;--> statement-breakpoint

CREATE TRIGGER goal_monthly_results_guard
BEFORE INSERT OR UPDATE OR DELETE ON "goal_monthly_results"
FOR EACH ROW EXECUTE FUNCTION guard_goal_monthly_result_v1();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_goal_result_revision_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  result_status varchar(24);
  result_period_end timestamptz;
  prior_revision integer;
  prior_result_id uuid;
BEGIN
  SELECT "status", "period_end"
  INTO result_status, result_period_end
  FROM "goal_monthly_results"
  WHERE "organization_id" = NEW."organization_id"
    AND "property_id" = NEW."property_id"
    AND "id" = NEW."monthly_result_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'goal result revision target is unavailable'
      USING ERRCODE = '23503';
  END IF;
  IF result_status <> 'closed' THEN
    RAISE EXCEPTION 'only closed goal monthly results can be revised'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."source_complete_through" IS NOT NULL
    AND NEW."source_complete_through" > result_period_end
  THEN
    RAISE EXCEPTION 'goal result revision source watermark exceeds the result period'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."evaluation_state" IN ('eligible', 'insufficient_data')
    AND NEW."source_complete_through" IS DISTINCT FROM result_period_end
  THEN
    RAISE EXCEPTION 'eligible goal result revisions require exact source completeness'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."revision" = 1 THEN
    IF NEW."supersedes_revision_id" IS NOT NULL THEN
      RAISE EXCEPTION 'first goal result revision cannot supersede another revision'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW."supersedes_revision_id" IS NULL THEN
      RAISE EXCEPTION 'later goal result revisions must supersede the direct prior revision'
        USING ERRCODE = '23514';
    END IF;
    SELECT "revision", "monthly_result_id"
    INTO prior_revision, prior_result_id
    FROM "goal_result_revisions"
    WHERE "id" = NEW."supersedes_revision_id";
    IF NOT FOUND
      OR prior_result_id <> NEW."monthly_result_id"
      OR prior_revision <> NEW."revision" - 1
    THEN
      RAISE EXCEPTION 'goal result revision lineage must target the direct prior revision'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER goal_result_revisions_insert_guard
BEFORE INSERT ON "goal_result_revisions"
FOR EACH ROW EXECUTE FUNCTION validate_goal_result_revision_v1();
