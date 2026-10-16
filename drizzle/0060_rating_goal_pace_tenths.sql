-- A Property Google rating goal's pace in tenths of a review a week (ADR
-- 0067, amended 2026-10-16; plan rounds 3 and 4).
--
-- The setup now offers paces a day ("1.5 a day") and a month ("20 a month"),
-- which whole reviews a week cannot hold: 1.5 a day would read back as 1.6, 10
-- a month as 9. `pace_tenths_per_week` holds a climb goal's pace in whole
-- tenths of a review a week, from 10 (1 a week) to 3500 (50 a day); a keep goal
-- has none. Tracking stays integer maths.
--
-- `pace_per_week` stays for one release as a legacy mirror, so a worker still
-- running the release before reads a pace it knows. The CHECK holds it equal to
-- GREATEST(1, (tenths + 5) / 10): integer division, the domain's
-- `legacyPacePerWeek` exactly, so the two can never disagree. Its range widens
-- to 1..350 with it. A later contract migration drops it once no release reads
-- it.
--
-- The change log's `pace` rows are rewritten in the new unit (x 10), so the
-- field has one meaning, and the CHECK takes a pace from 10 to 3500 from then
-- on. Version semantics do not change.
--
-- The migration only adds a column, loosens the pace range and rewrites the
-- old pace log rows in the new unit.
--
-- Rolling deploy: old web SERVER code inserting a climb goal (no tenths) or
-- changing a pace (mirror mismatch) is refused by the new CHECK for the minutes
-- the release takes, which fails one request and never stores a row (the 0059
-- precedent). Old BROWSER tabs against the new server keep working: the set and
-- change schemas map a legacy whole weekly pace x 10 for one release. An old
-- worker keeps reading `pace_per_week`. `last_known_status` is untouched, so no
-- goal changes status and no notice repeats. For those minutes an old web
-- server also shows every rewritten pace log row x 10 ("Pace 50 -> 110 a
-- week"): it prints the stored value.
--
-- Roll forward, never back: there is no down migration. Old code on a 0060
-- database cannot insert a climb goal (no tenths fails the plan CHECK),
-- re-pace a goal (mirror mismatch) or switch a goal between keep and climb, and
-- it keeps showing the x 10 history. If a rollback of the images is ever
-- forced, first run the down SQL in docs/plan/google-rating-goal.md ("Data and
-- storage"): in one transaction, drop the change-log CHECK, set the pace log
-- values to value / 10, re-add 0059's change-log CHECK, drop the plan CHECK
-- and `pace_tenths_per_week`, re-add 0059's plan CHECK, and delete 0060's row
-- from drizzle.__drizzle_migrations so a later roll-forward runs it again. It
-- is exact only while every stored tenths value is a multiple of 10 and at
-- most 2000 (true until a setup that offers paces a day ships); check first.
--
-- Beta state: the closed beta's rating goal count is checked read-only before
-- the deploy; the statements hold on any data.
ALTER TABLE "property_rating_goals" ADD COLUMN "pace_tenths_per_week" smallint;
--> statement-breakpoint
UPDATE "property_rating_goals"
SET "pace_tenths_per_week" = "pace_per_week" * 10
WHERE "mode" = 'climb';
--> statement-breakpoint
ALTER TABLE "property_rating_goals" DROP CONSTRAINT "property_rating_goals_plan_check";
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD CONSTRAINT "property_rating_goals_plan_check" CHECK (("property_rating_goals"."mode" = 'climb' AND "property_rating_goals"."pace_per_week" IS NOT NULL AND "property_rating_goals"."pace_tenths_per_week" IS NOT NULL AND "property_rating_goals"."quality_tenths" IS NOT NULL AND "property_rating_goals"."target_tenths" BETWEEN 11 AND 49 AND "property_rating_goals"."pace_tenths_per_week" BETWEEN 10 AND 3500 AND "property_rating_goals"."pace_per_week" = GREATEST(1, ("property_rating_goals"."pace_tenths_per_week" + 5) / 10) AND "property_rating_goals"."quality_tenths" BETWEEN "property_rating_goals"."target_tenths" AND 50)
        OR ("property_rating_goals"."mode" = 'keep' AND "property_rating_goals"."pace_per_week" IS NULL AND "property_rating_goals"."pace_tenths_per_week" IS NULL AND "property_rating_goals"."quality_tenths" IS NULL AND "property_rating_goals"."target_tenths" BETWEEN 10 AND 50));
--> statement-breakpoint
ALTER TABLE "property_rating_goal_changes" DROP CONSTRAINT "property_rating_goal_changes_value_check";
--> statement-breakpoint
UPDATE "property_rating_goal_changes"
SET "old_value" = ("old_value"::int * 10)::text
WHERE "field" = 'pace' AND "old_value" IS NOT NULL;
--> statement-breakpoint
UPDATE "property_rating_goal_changes"
SET "new_value" = ("new_value"::int * 10)::text
WHERE "field" = 'pace' AND "new_value" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "property_rating_goal_changes" ADD CONSTRAINT "property_rating_goal_changes_value_check" CHECK ("property_rating_goal_changes"."old_value" IS DISTINCT FROM "property_rating_goal_changes"."new_value" AND (
        ("property_rating_goal_changes"."field" = 'target' AND "property_rating_goal_changes"."old_value" IS NOT NULL AND "property_rating_goal_changes"."new_value" IS NOT NULL
          AND "property_rating_goal_changes"."old_value" ~ '^([1-4][0-9]|50)$' AND "property_rating_goal_changes"."new_value" ~ '^([1-4][0-9]|50)$')
        OR ("property_rating_goal_changes"."field" = 'quality'
          AND ("property_rating_goal_changes"."old_value" IS NULL OR "property_rating_goal_changes"."old_value" ~ '^([1-4][0-9]|50)$')
          AND ("property_rating_goal_changes"."new_value" IS NULL OR "property_rating_goal_changes"."new_value" ~ '^([1-4][0-9]|50)$'))
        OR ("property_rating_goal_changes"."field" = 'pace'
          AND ("property_rating_goal_changes"."old_value" IS NULL OR "property_rating_goal_changes"."old_value" ~ '^([1-9][0-9]{1,2}|[12][0-9]{3}|3[0-4][0-9]{2}|3500)$')
          AND ("property_rating_goal_changes"."new_value" IS NULL OR "property_rating_goal_changes"."new_value" ~ '^([1-9][0-9]{1,2}|[12][0-9]{3}|3[0-4][0-9]{2}|3500)$'))
        OR ("property_rating_goal_changes"."field" = 'mode' AND "property_rating_goal_changes"."old_value" IS NOT NULL AND "property_rating_goal_changes"."new_value" IS NOT NULL
          AND "property_rating_goal_changes"."old_value" IN ('climb', 'keep') AND "property_rating_goal_changes"."new_value" IN ('climb', 'keep'))
      ));
