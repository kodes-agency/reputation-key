-- "Not now" for a Property's Google rating goal (ADR 0067, placements slice).
--
-- Purely additive: one new table, nothing else changes. Old web and worker
-- code never reads or writes it.
--
-- The Property setup checklist gains a step, "Set a Google rating goal", that
-- counts toward its "n of m done". It is done when the Property has an active
-- goal or when a manager chose "Not now" for it. A goal is already a fact; the
-- choice is not, so it is kept here: at most one row per Property, written by
-- Reporting's "Not now" command, naming who chose it and when. A goal set
-- later completes the step whether or not the row is there, so nothing ever
-- deletes it on that path.
--
-- Its one foreign key, the Property within its Organization, cascades with
-- the Property, as the AI decision's "not now" (`merchant_ai_decision_deferrals`,
-- 0015) does. The Organization purge also deletes the rows with the rest of the
-- Goal family (goal-organization-lifecycle.adapter), and the Organization export
-- carries them (goal-organization-export.adapter).
--
-- Numbered 0058: 0057 is the rating goal notices' migration
-- (`rating_goal_notice_marks`, #825), already on main. Its columns are on
-- `property_rating_goals`; this table touches none of them.
CREATE TABLE "property_rating_goal_deferrals" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid PRIMARY KEY NOT NULL,
	"deferred_by" varchar(255) NOT NULL,
	"deferred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_rating_goal_deferrals" ADD CONSTRAINT "property_rating_goal_deferrals_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "property_rating_goal_deferrals_org_idx" ON "property_rating_goal_deferrals" USING btree ("organization_id");
