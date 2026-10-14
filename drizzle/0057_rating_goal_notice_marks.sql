-- What a Property Google rating goal's notices compare with (ADR 0067
-- decision 6; ADR 0046, amended 2026-10-14).
--
-- Purely additive: three nullable columns and a CHECK on one of them. Old web
-- and worker code never reads or writes them, and every statement it runs
-- names its columns.
--
-- `last_known_status` is the last status an evaluation stored that was not
-- `waiting_for_google`. A notice says a goal ENTERED a status (Below pace,
-- Can't reach at this mix, a keep goal dropped below), and it compares with
-- this, so a day without Google's numbers never repeats one. NULL until the
-- goal knows a status, and again after a manager changes the plan: a status
-- the goal did not know before is stored without a notice.
--
-- `below_pace_noticed_at` is when the goal's managers were last told it fell
-- below pace; they are told at most once in 14 days.
--
-- `cant_reach_noticed_at` is when they were last told it can't be reached at
-- the recent mix; also at most once in 14 days, because a mix that hovers
-- near the threshold would otherwise tell them every time it crosses.
--
-- A goal stored before this migration takes its last stored status as known,
-- unless that status was a wait for Google. Neither notice time is backfilled:
-- NULL means the managers were never told, and a goal whose stored status was
-- already one of these two does not enter it again, so nothing is repeated.
ALTER TABLE "property_rating_goals" ADD COLUMN "last_known_status" varchar(24);
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD COLUMN "below_pace_noticed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD COLUMN "cant_reach_noticed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "property_rating_goals"
SET "last_known_status" = "last_evaluated_status"
WHERE "last_evaluated_status" IS NOT NULL
  AND "last_evaluated_status" <> 'waiting_for_google';
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD CONSTRAINT "property_rating_goals_notice_mark_check" CHECK ("property_rating_goals"."last_known_status" IS NULL OR "property_rating_goals"."last_known_status" IN ('reached', 'cant_reach_at_mix', 'getting_started', 'on_pace', 'below_pace', 'holding', 'dropped_below'));
