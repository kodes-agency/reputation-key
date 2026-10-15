-- A Property Google rating goal's planned review quality, and "New reviews
-- too low" in place of "Can't reach at this mix" (ADR 0067, amended
-- 2026-10-15; plan round 2).
--
-- `quality_tenths` is a climb goal's planned quality: the average stars, in
-- tenths, its plan assumes new Google reviews bring. It is part of the plan:
-- a manager's change of it moves `version`, as a change of target or pace
-- does, and the change log records it (`field` 'quality', a tenth as text,
-- NULL when the goal keeps instead). A keep goal plans none. The CHECK holds
-- only the invariant the maths needs: a quality of at least the target, so
-- above its threshold (T - 0.05; at or below it no count of reviews gets
-- there), and at most five stars. The product's floor (the threshold plus
-- 0.15) is the domain's rule (`rating-goal-quality.ts`), so a later decision
-- can move it without a migration.
--
-- A climb goal stored before this migration has no planned quality. It is
-- given "a step above what its target needs", the target plus 0.3 and at most
-- 5.0: the recommendation the plans fall back to without other evidence, which
-- clears every floor. No rating goal exists on the closed beta (checked
-- read-only on 2026-10-15); the statement is for any other database.
--
-- The status `cant_reach_at_mix` is retired. It judged the recent mix; a goal
-- now judges the reviews that arrived since it was set (`reviews_too_low`,
-- from the tenth of them on). A stored retired status is cleared rather than
-- translated, because the two do not mean the same: `last_evaluated_status`
-- becomes NULL, which the next evaluation fills, and `last_known_status` too,
-- so the status a goal did not know before is stored without a notice.
--
-- `cant_reach_noticed_at` keeps its name: renaming it would break the release
-- still running while web migrates. It now holds when the goal's managers were
-- last told new reviews are too low (`tooLowNoticedAt` in the model), so it is
-- cleared: nobody has been told that yet.
--
-- Old web and worker code writes no `quality_tenths` into a new climb goal, so
-- the new CHECK refuses it; it also could not store the retired status. Both
-- refusals fail one request or one evaluation, never a stored row, and no goal
-- exists on the beta for them to touch.
ALTER TABLE "property_rating_goals" ADD COLUMN "quality_tenths" smallint;
--> statement-breakpoint
UPDATE "property_rating_goals"
SET "quality_tenths" = LEAST("target_tenths" + 3, 50)
WHERE "mode" = 'climb';
--> statement-breakpoint
UPDATE "property_rating_goals"
SET "last_evaluated_status" = NULL
WHERE "last_evaluated_status" = 'cant_reach_at_mix';
--> statement-breakpoint
UPDATE "property_rating_goals"
SET "last_known_status" = NULL
WHERE "last_known_status" = 'cant_reach_at_mix';
--> statement-breakpoint
UPDATE "property_rating_goals"
SET "cant_reach_noticed_at" = NULL
WHERE "cant_reach_noticed_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "property_rating_goals" DROP CONSTRAINT "property_rating_goals_plan_check";
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD CONSTRAINT "property_rating_goals_plan_check" CHECK (("property_rating_goals"."mode" = 'climb' AND "property_rating_goals"."pace_per_week" IS NOT NULL AND "property_rating_goals"."quality_tenths" IS NOT NULL AND "property_rating_goals"."target_tenths" BETWEEN 11 AND 49 AND "property_rating_goals"."pace_per_week" BETWEEN 1 AND 200 AND "property_rating_goals"."quality_tenths" BETWEEN "property_rating_goals"."target_tenths" AND 50)
        OR ("property_rating_goals"."mode" = 'keep' AND "property_rating_goals"."pace_per_week" IS NULL AND "property_rating_goals"."quality_tenths" IS NULL AND "property_rating_goals"."target_tenths" BETWEEN 10 AND 50));
--> statement-breakpoint
ALTER TABLE "property_rating_goals" DROP CONSTRAINT "property_rating_goals_evaluation_check";
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD CONSTRAINT "property_rating_goals_evaluation_check" CHECK (("property_rating_goals"."last_displayed_tenths" IS NULL OR "property_rating_goals"."last_displayed_tenths" BETWEEN 0 AND 50)
        AND ("property_rating_goals"."last_evaluated_status" IS NULL OR "property_rating_goals"."last_evaluated_status" IN ('waiting_for_google', 'reached', 'reviews_too_low', 'getting_started', 'on_pace', 'below_pace', 'holding', 'dropped_below')));
--> statement-breakpoint
ALTER TABLE "property_rating_goals" DROP CONSTRAINT "property_rating_goals_notice_mark_check";
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD CONSTRAINT "property_rating_goals_notice_mark_check" CHECK ("property_rating_goals"."last_known_status" IS NULL OR "property_rating_goals"."last_known_status" IN ('reached', 'reviews_too_low', 'getting_started', 'on_pace', 'below_pace', 'holding', 'dropped_below'));
--> statement-breakpoint
ALTER TABLE "property_rating_goal_changes" DROP CONSTRAINT "property_rating_goal_changes_value_check";
--> statement-breakpoint
ALTER TABLE "property_rating_goal_changes" ADD CONSTRAINT "property_rating_goal_changes_value_check" CHECK ("property_rating_goal_changes"."old_value" IS DISTINCT FROM "property_rating_goal_changes"."new_value" AND (
        ("property_rating_goal_changes"."field" = 'target' AND "property_rating_goal_changes"."old_value" IS NOT NULL AND "property_rating_goal_changes"."new_value" IS NOT NULL
          AND "property_rating_goal_changes"."old_value" ~ '^([1-4][0-9]|50)$' AND "property_rating_goal_changes"."new_value" ~ '^([1-4][0-9]|50)$')
        OR ("property_rating_goal_changes"."field" = 'quality'
          AND ("property_rating_goal_changes"."old_value" IS NULL OR "property_rating_goal_changes"."old_value" ~ '^([1-4][0-9]|50)$')
          AND ("property_rating_goal_changes"."new_value" IS NULL OR "property_rating_goal_changes"."new_value" ~ '^([1-4][0-9]|50)$'))
        OR ("property_rating_goal_changes"."field" = 'pace'
          AND ("property_rating_goal_changes"."old_value" IS NULL OR "property_rating_goal_changes"."old_value" ~ '^([1-9][0-9]?|1[0-9][0-9]|200)$')
          AND ("property_rating_goal_changes"."new_value" IS NULL OR "property_rating_goal_changes"."new_value" ~ '^([1-9][0-9]?|1[0-9][0-9]|200)$'))
        OR ("property_rating_goal_changes"."field" = 'mode' AND "property_rating_goal_changes"."old_value" IS NOT NULL AND "property_rating_goal_changes"."new_value" IS NOT NULL
          AND "property_rating_goal_changes"."old_value" IN ('climb', 'keep') AND "property_rating_goal_changes"."new_value" IN ('climb', 'keep'))
      ));
