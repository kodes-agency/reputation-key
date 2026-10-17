-- Monthly portal goal facts (ADR 0068): where a goal's number came from, the
-- month whose check-in a manager kept, who stopped a goal and when, and a
-- manager's "Not now" for the Overview's ready prompt.
--
-- `target_source` is where a Goal Program version's number, or a month target
-- change's new number, came from: `recommended` when the manager used the
-- number RepKey recommended for that month and measure, `own` when they typed
-- another. NULL when nobody said: everything written before this migration,
-- by an old web server, or by a command that does not ask.
--
-- `check_in_answered_month` is the `YYYY-MM` month whose month-start check-in
-- a manager answered with Keep. It moves no version and logs no change, so
-- another manager's open form stays valid. NULL until a manager keeps a number.
--
-- `ended_at` and `ended_by` record who stopped a goal and when. The CHECK
-- holds them together and only on an ended goal. NULL on a goal ended before
-- this migration or by an old web server, which names neither column.
--
-- `portal_goal_prompt_deferrals` keeps "Not now" on the Overview's ready
-- prompt: one row per Property, naming the month it was chosen for, who chose
-- it and when. Disposable decision state with no content, modelled on
-- `property_rating_goal_deferrals` (0058): its one reference, the Property
-- within its Organization, cascades with the Property; the Organization purge
-- deletes the rows with the rest of the Goal family
-- (goal-organization-lifecycle.adapter) and the Organization export carries
-- them (goal-organization-export.adapter).
--
-- Purely additive: old web and worker code names its columns in every
-- statement, so it never reads these, and every new column is nullable, so its
-- inserts still work. The new code selects them, so this runs before any new
-- process (web's preDeploy; deploy web, then the worker, never the worker
-- first). Never in the same deploy as 0063: pending files share one
-- transaction.
--
-- Down: `DROP TABLE portal_goal_prompt_deferrals`; drop the four new
-- constraints and the five columns (`goal_programs.check_in_answered_month`,
-- `ended_at`, `ended_by`; `goal_program_versions.target_source`;
-- `goal_month_target_changes.target_source`); delete the 0062 row of
-- drizzle.__drizzle_migrations.
--
-- Beta state: 0 Goal Programs (counted read-only before the deploy, PR body);
-- the statements hold on any data.
ALTER TABLE "goal_program_versions" ADD COLUMN "target_source" varchar(16);
--> statement-breakpoint
ALTER TABLE "goal_program_versions" ADD CONSTRAINT "goal_program_versions_target_source_check"
  CHECK ("target_source" IS NULL OR "target_source" IN ('recommended', 'own'));
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD COLUMN "target_source" varchar(16);
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_target_source_check"
  CHECK ("target_source" IS NULL OR "target_source" IN ('recommended', 'own'));
--> statement-breakpoint
-- The month whose check-in a manager answered with Keep (no version bump).
ALTER TABLE "goal_programs" ADD COLUMN "check_in_answered_month" varchar(7);
--> statement-breakpoint
ALTER TABLE "goal_programs" ADD CONSTRAINT "goal_programs_check_in_answered_month_check"
  CHECK ("check_in_answered_month" IS NULL OR "check_in_answered_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
--> statement-breakpoint
-- Who stopped a goal and when (NULL for ends before 0062 or by an old web).
ALTER TABLE "goal_programs" ADD COLUMN "ended_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "goal_programs" ADD COLUMN "ended_by" varchar(255);
--> statement-breakpoint
ALTER TABLE "goal_programs" ADD CONSTRAINT "goal_programs_ended_record_check"
  CHECK (("ended_at" IS NULL) = ("ended_by" IS NULL) AND ("ended_at" IS NULL OR "status" = 'ended'));
--> statement-breakpoint
-- "Not now" on the Overview's ready prompt, per Property, for one month.
CREATE TABLE "portal_goal_prompt_deferrals" (
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid PRIMARY KEY NOT NULL,
  "month" varchar(7) NOT NULL,
  "deferred_by" varchar(255) NOT NULL,
  "deferred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "portal_goal_prompt_deferrals_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "portal_goal_prompt_deferrals" ADD CONSTRAINT "portal_goal_prompt_deferrals_property_fk"
  FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "portal_goal_prompt_deferrals_org_idx" ON "portal_goal_prompt_deferrals" USING btree ("organization_id");
