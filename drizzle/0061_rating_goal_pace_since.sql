-- When a Property Google rating goal's pace started, and the week whose Monday
-- check-in its managers answered (ADR 0067, amended 2026-10-17; PLAN-D round 5,
-- D-3, owner answers Q3 and Q4).
--
-- `pace_since` is the instant the goal's pace came into force: when the goal
-- was set, or the latest change of its pace. A new pace is judged only from it
-- (Q3): the goal is getting started again for two weeks, the pace window runs
-- from it until it is four weeks long, and the card forecasts at the chosen
-- pace until it is 28 days old. `created_at` keeps everything else (just set,
-- the reviews since the set, the blend and the too-low verdict). The domain
-- writes it: a set stores `created_at` explicitly, a change of plan moves it
-- only when the pace moves. The DEFAULT exists only for the inserts of an old
-- web server during the rolling deploy (it lands seconds after `created_at`,
-- which changes no status).
--
-- `recap_answered_week` is the Property-local Monday (a date) of the week
-- whose check-in a manager answered with Keep. It is shared by every manager
-- and device, never moves the version (another manager's open form stays
-- valid) and writes no change-log row. A pace change in the week answers it
-- too, read from `pace_since`. NULL until a manager keeps a pace.
--
-- Backfill: the latest logged change of the pace (`field = 'pace'`, which a
-- switch between keep and climb also writes), else `created_at`.
--
-- Purely additive: old web and worker code names its columns in every
-- statement, so it never reads these. For the minutes of the release an old
-- web server's change of pace leaves `pace_since` where it was, and the goal is
-- judged from the earlier pace start until the next change. Roll forward, never
-- back: the down step is `ALTER TABLE property_rating_goals DROP COLUMN
-- recap_answered_week, DROP COLUMN pace_since` and the 0061 row out of
-- drizzle.__drizzle_migrations.
--
-- Beta state: counted read-only before the deploy (PR body); the statements
-- hold on any data.
ALTER TABLE "property_rating_goals" ADD COLUMN "pace_since" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "property_rating_goals" AS "g"
SET "pace_since" = COALESCE(
  (SELECT max("c"."changed_at")
     FROM "property_rating_goal_changes" AS "c"
    WHERE "c"."goal_id" = "g"."id"
      AND "c"."organization_id" = "g"."organization_id"
      AND "c"."field" = 'pace'),
  "g"."created_at");
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD COLUMN "recap_answered_week" date;
