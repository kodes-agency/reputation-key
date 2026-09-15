-- A durable "not now" for a Property's AI decision.
--
-- Property setup (docs/plan/property-setup-plan.md B1, decision 1) needs the
-- AI decision to survive navigation: a manager who defers AI for a Property
-- must not be asked again on every visit. The plan put `decision_deferred_at`
-- and `decision_deferred_by` on `merchant_ai_enablement`, but that table is a
-- fenced consent head: every row references a consent-evidence head, carries a
-- notice version and digest plus capability and source epochs, and may only
-- be written by `apply_merchant_ai_transition_v1`. A deferral records no
-- consent, evidence or epoch, so it cannot be a head row. It lives beside the
-- head instead: at most one row per Property, written by Identity's defer
-- command (refused while AI is enabled) and deleted in the same transaction as
-- a successful enable.
--
-- Both foreign keys cascade with the Property, so an Organization purge that
-- deletes `properties` removes the deferral with it.
--
-- Generated with `drizzle-kit generate` against the model; this file is the
-- only change, so no snapshot is recorded.
CREATE TABLE "merchant_ai_decision_deferrals" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"deferred_by" varchar(255) NOT NULL,
	"deferred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_ai_decision_deferrals" ADD CONSTRAINT "merchant_ai_decision_deferrals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_ai_decision_deferrals" ADD CONSTRAINT "merchant_ai_decision_deferrals_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_ai_decision_deferrals_org_idx" ON "merchant_ai_decision_deferrals" USING btree ("organization_id");
