-- A Property's Google rating goal (DECISIONS.md 2026-10-14, engine slice).
--
-- Purely additive: two new tables, nothing else changes. Old web and worker
-- code never reads or writes them.
--
-- `property_rating_goals` holds one goal per row. A Property has at most one
-- active goal (a partial unique index). A climb goal names a tenth from 1.1 to
-- 4.9 and a weekly pace from 1 to 200; a keep goal names a tenth from 1.0 to
-- 5.0 and no pace. `status` moves from `active` to `reached` (climb only,
-- with `reached_at`) or to `ended` (with its reason and `ended_at`), never
-- back. `source_epoch` is the Property's Google binding epoch when the goal
-- was set. The baselines are Google's count and average and the exact
-- average the progress bar starts from. The `last_*` columns are what the last
-- evaluation stored; `version` guards a manager's change against a stale form.
--
-- `property_rating_goal_changes` logs each change of target, pace or mode with
-- who, when, old and new value, one row per field, and no reason. Its goal
-- reference includes the organization and Property, so a row can only name a
-- goal of its own Property.
--
-- A CHECK passes when its expression is NULL, so each check states IS NOT NULL
-- wherever a nullable column must hold a value (a climb's pace, an ended goal's
-- reason, a target or mode change's values).
--
-- Both reference with ON DELETE RESTRICT, as the Goal Program family does: the
-- Organization purge deletes them first (goal-organization-lifecycle.adapter).
CREATE TABLE "property_rating_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"mode" varchar(8) NOT NULL,
	"target_tenths" smallint NOT NULL,
	"pace_per_week" smallint,
	"status" varchar(8) DEFAULT 'active' NOT NULL,
	"ended_reason" varchar(32),
	"baseline_review_count" integer NOT NULL,
	"baseline_google_average" double precision NOT NULL,
	"baseline_exact_average" double precision NOT NULL,
	"last_displayed_tenths" smallint,
	"last_evaluated_status" varchar(24),
	"last_evaluated_at" timestamp with time zone,
	"reached_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "property_rating_goals_org_property_id_key" UNIQUE("organization_id","property_id","id"),
	CONSTRAINT "property_rating_goals_source_epoch_check" CHECK ("property_rating_goals"."source_epoch" BETWEEN 0 AND 2147483647),
	CONSTRAINT "property_rating_goals_plan_check" CHECK (("property_rating_goals"."mode" = 'climb' AND "property_rating_goals"."pace_per_week" IS NOT NULL AND "property_rating_goals"."target_tenths" BETWEEN 11 AND 49 AND "property_rating_goals"."pace_per_week" BETWEEN 1 AND 200)
        OR ("property_rating_goals"."mode" = 'keep' AND "property_rating_goals"."pace_per_week" IS NULL AND "property_rating_goals"."target_tenths" BETWEEN 10 AND 50)),
	CONSTRAINT "property_rating_goals_status_check" CHECK (("property_rating_goals"."status" = 'active' AND "property_rating_goals"."ended_reason" IS NULL AND "property_rating_goals"."reached_at" IS NULL AND "property_rating_goals"."ended_at" IS NULL)
        OR ("property_rating_goals"."status" = 'reached' AND "property_rating_goals"."mode" = 'climb' AND "property_rating_goals"."ended_reason" IS NULL AND "property_rating_goals"."reached_at" IS NOT NULL AND "property_rating_goals"."ended_at" IS NULL)
        OR ("property_rating_goals"."status" = 'ended' AND "property_rating_goals"."ended_reason" IS NOT NULL AND "property_rating_goals"."ended_reason" IN ('manager', 'google_location_changed', 'property_archived') AND "property_rating_goals"."reached_at" IS NULL AND "property_rating_goals"."ended_at" IS NOT NULL)),
	CONSTRAINT "property_rating_goals_baseline_check" CHECK ("property_rating_goals"."baseline_review_count" BETWEEN 1 AND 10000
        AND "property_rating_goals"."baseline_google_average" BETWEEN 0 AND 5
        AND "property_rating_goals"."baseline_exact_average" BETWEEN 0 AND 5),
	CONSTRAINT "property_rating_goals_evaluation_check" CHECK (("property_rating_goals"."last_displayed_tenths" IS NULL OR "property_rating_goals"."last_displayed_tenths" BETWEEN 0 AND 50)
        AND ("property_rating_goals"."last_evaluated_status" IS NULL OR "property_rating_goals"."last_evaluated_status" IN ('waiting_for_google', 'reached', 'cant_reach_at_mix', 'getting_started', 'on_pace', 'below_pace', 'holding', 'dropped_below'))),
	CONSTRAINT "property_rating_goals_version_check" CHECK ("property_rating_goals"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "property_rating_goals" ADD CONSTRAINT "property_rating_goals_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "property_rating_goals_one_active_idx" ON "property_rating_goals" USING btree ("organization_id","property_id") WHERE "property_rating_goals"."status" = 'active';
--> statement-breakpoint
CREATE INDEX "property_rating_goals_property_idx" ON "property_rating_goals" USING btree ("organization_id","property_id","created_at");
--> statement-breakpoint
CREATE TABLE "property_rating_goal_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"changed_by" varchar(255) NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"field" varchar(8) NOT NULL,
	"old_value" varchar(8),
	"new_value" varchar(8),
	CONSTRAINT "property_rating_goal_changes_value_check" CHECK ("property_rating_goal_changes"."old_value" IS DISTINCT FROM "property_rating_goal_changes"."new_value" AND (
        ("property_rating_goal_changes"."field" = 'target' AND "property_rating_goal_changes"."old_value" IS NOT NULL AND "property_rating_goal_changes"."new_value" IS NOT NULL
          AND "property_rating_goal_changes"."old_value" ~ '^([1-4][0-9]|50)$' AND "property_rating_goal_changes"."new_value" ~ '^([1-4][0-9]|50)$')
        OR ("property_rating_goal_changes"."field" = 'pace'
          AND ("property_rating_goal_changes"."old_value" IS NULL OR "property_rating_goal_changes"."old_value" ~ '^([1-9][0-9]?|1[0-9][0-9]|200)$')
          AND ("property_rating_goal_changes"."new_value" IS NULL OR "property_rating_goal_changes"."new_value" ~ '^([1-9][0-9]?|1[0-9][0-9]|200)$'))
        OR ("property_rating_goal_changes"."field" = 'mode' AND "property_rating_goal_changes"."old_value" IS NOT NULL AND "property_rating_goal_changes"."new_value" IS NOT NULL
          AND "property_rating_goal_changes"."old_value" IN ('climb', 'keep') AND "property_rating_goal_changes"."new_value" IN ('climb', 'keep'))
      ))
);
--> statement-breakpoint
ALTER TABLE "property_rating_goal_changes" ADD CONSTRAINT "property_rating_goal_changes_goal_fk" FOREIGN KEY ("organization_id","property_id","goal_id") REFERENCES "public"."property_rating_goals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "property_rating_goal_changes_goal_idx" ON "property_rating_goal_changes" USING btree ("organization_id","property_id","goal_id","changed_at");
