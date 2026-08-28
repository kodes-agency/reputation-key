ALTER TABLE "goal_program_versions" DROP CONSTRAINT "goal_program_versions_effective_check";--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" DROP CONSTRAINT "goal_subject_assignments_effective_check";--> statement-breakpoint
ALTER TABLE "goal_program_versions" ADD CONSTRAINT "goal_program_versions_effective_check" CHECK ("goal_program_versions"."effective_to" IS NULL OR "goal_program_versions"."effective_to" >= "goal_program_versions"."effective_from");--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_effective_check" CHECK ("goal_subject_assignments"."effective_to" IS NULL OR "goal_subject_assignments"."effective_to" >= "goal_subject_assignments"."effective_from");--> statement-breakpoint

-- Ending a not-yet-active Program preserves its immutable definition history
-- as an empty [effective_from, effective_from) interval. This is the only
-- additional append-only update shape; every other mutation remains refused.
CREATE OR REPLACE FUNCTION reject_canonical_goal_append_only_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'goal_program_versions' AND TG_OP = 'UPDATE' THEN
    IF OLD."effective_to" IS NULL
      AND NEW."effective_to" IS NOT NULL
      AND NEW."effective_to" >= OLD."effective_from"
      AND (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to')
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

-- The domain and product contract permit cancelling a scheduled Program
-- before its first full month. Keep the database transition guard identical.
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
    (OLD."status" = 'scheduled' AND NEW."status" IN ('active', 'ended'))
    OR (OLD."status" = 'active' AND NEW."status" IN ('paused', 'ended'))
    OR (OLD."status" = 'paused' AND NEW."status" IN ('active', 'ended'))
  ) THEN
    RAISE EXCEPTION 'invalid goal program transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
