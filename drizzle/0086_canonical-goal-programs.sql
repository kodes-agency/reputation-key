CREATE TABLE "goal_monthly_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"property_timezone" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"evaluation_state" varchar(24) DEFAULT 'updating' NOT NULL,
	"value" numeric(30, 10),
	"sample_count" integer DEFAULT 0 NOT NULL,
	"achieved" boolean,
	"reason" text,
	"source_complete_through" timestamp with time zone,
	"evaluation_watermark" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_monthly_results_assignment_period_key" UNIQUE("assignment_id","period_start","period_end"),
	CONSTRAINT "goal_monthly_results_org_property_id_key" UNIQUE("organization_id","property_id","id"),
	CONSTRAINT "goal_monthly_results_bounds_check" CHECK ("goal_monthly_results"."period_end" > "goal_monthly_results"."period_start"),
	CONSTRAINT "goal_monthly_results_sample_check" CHECK ("goal_monthly_results"."sample_count" >= 0),
	CONSTRAINT "goal_monthly_results_status_check" CHECK ("goal_monthly_results"."status" IN ('open', 'reconciling', 'closed')),
	CONSTRAINT "goal_monthly_results_state_check" CHECK ("goal_monthly_results"."evaluation_state" IN ('eligible', 'updating', 'insufficient_data', 'unavailable', 'quarantined')),
	CONSTRAINT "goal_monthly_results_value_state_check" CHECK (("goal_monthly_results"."evaluation_state" = 'eligible' AND "goal_monthly_results"."value" IS NOT NULL AND "goal_monthly_results"."achieved" IS NOT NULL AND "goal_monthly_results"."reason" IS NULL) OR ("goal_monthly_results"."evaluation_state" <> 'eligible' AND "goal_monthly_results"."achieved" IS NULL)),
	CONSTRAINT "goal_monthly_results_closed_check" CHECK (("goal_monthly_results"."status" = 'closed' AND "goal_monthly_results"."closed_at" IS NOT NULL AND "goal_monthly_results"."evaluation_watermark" IS NOT NULL) OR ("goal_monthly_results"."status" <> 'closed' AND "goal_monthly_results"."closed_at" IS NULL)),
	CONSTRAINT "goal_monthly_results_source_check" CHECK ("goal_monthly_results"."source_complete_through" IS NULL OR "goal_monthly_results"."source_complete_through" <= "goal_monthly_results"."period_end")
);
--> statement-breakpoint
CREATE TABLE "goal_program_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"metric_definition_id" uuid NOT NULL,
	"metric_definition_version_id" uuid NOT NULL,
	"metric_key" varchar(40) NOT NULL,
	"metric_minimum_sample" integer NOT NULL,
	"target_value" numeric(30, 10) NOT NULL,
	"property_timezone" varchar(64) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"change_reason" text NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_program_versions_program_version_key" UNIQUE("program_id","version"),
	CONSTRAINT "goal_program_versions_org_property_id_key" UNIQUE("organization_id","property_id","id"),
	CONSTRAINT "goal_program_versions_assignment_fk_key" UNIQUE("organization_id","property_id","program_id","id","metric_key"),
	CONSTRAINT "goal_program_versions_version_check" CHECK ("goal_program_versions"."version" >= 1),
	CONSTRAINT "goal_program_versions_metric_check" CHECK ("goal_program_versions"."metric_key" IN ('qualified_scans', 'portal_rating_count', 'portal_rating_average')),
	CONSTRAINT "goal_program_versions_sample_check" CHECK ((("goal_program_versions"."metric_key" IN ('qualified_scans', 'portal_rating_count') AND "goal_program_versions"."metric_minimum_sample" = 0) OR ("goal_program_versions"."metric_key" = 'portal_rating_average' AND "goal_program_versions"."metric_minimum_sample" = 10))),
	CONSTRAINT "goal_program_versions_target_check" CHECK ((("goal_program_versions"."metric_key" IN ('qualified_scans', 'portal_rating_count') AND "goal_program_versions"."target_value" > 0 AND "goal_program_versions"."target_value" = trunc("goal_program_versions"."target_value")) OR ("goal_program_versions"."metric_key" = 'portal_rating_average' AND "goal_program_versions"."target_value" BETWEEN 1 AND 5 AND "goal_program_versions"."target_value" * 10 = trunc("goal_program_versions"."target_value" * 10)))),
	CONSTRAINT "goal_program_versions_effective_check" CHECK ("goal_program_versions"."effective_to" IS NULL OR "goal_program_versions"."effective_to" > "goal_program_versions"."effective_from"),
	CONSTRAINT "goal_program_versions_timezone_check" CHECK (length(btrim("goal_program_versions"."property_timezone")) > 0),
	CONSTRAINT "goal_program_versions_reason_check" CHECK (length(btrim("goal_program_versions"."change_reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "goal_programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"status_reason" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_programs_org_property_id_key" UNIQUE("organization_id","property_id","id"),
	CONSTRAINT "goal_programs_name_check" CHECK (length(btrim("goal_programs"."name")) > 0),
	CONSTRAINT "goal_programs_version_check" CHECK ("goal_programs"."current_version" >= 1),
	CONSTRAINT "goal_programs_status_check" CHECK ("goal_programs"."status" IN ('scheduled', 'active', 'paused', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "goal_result_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"monthly_result_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"supersedes_revision_id" uuid,
	"evaluation_state" varchar(24) NOT NULL,
	"value" numeric(30, 10),
	"sample_count" integer NOT NULL,
	"achieved" boolean,
	"reason" text,
	"source_complete_through" timestamp with time zone,
	"evaluation_watermark" timestamp with time zone NOT NULL,
	"change_reason" text NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_result_revisions_result_revision_key" UNIQUE("monthly_result_id","revision"),
	CONSTRAINT "goal_result_revisions_org_property_result_id_key" UNIQUE("organization_id","property_id","monthly_result_id","id"),
	CONSTRAINT "goal_result_revisions_revision_check" CHECK ("goal_result_revisions"."revision" >= 1),
	CONSTRAINT "goal_result_revisions_sample_check" CHECK ("goal_result_revisions"."sample_count" >= 0),
	CONSTRAINT "goal_result_revisions_state_check" CHECK ("goal_result_revisions"."evaluation_state" IN ('eligible', 'insufficient_data', 'unavailable', 'quarantined')),
	CONSTRAINT "goal_result_revisions_value_state_check" CHECK (("goal_result_revisions"."evaluation_state" = 'eligible' AND "goal_result_revisions"."value" IS NOT NULL AND "goal_result_revisions"."achieved" IS NOT NULL AND "goal_result_revisions"."reason" IS NULL) OR ("goal_result_revisions"."evaluation_state" <> 'eligible' AND "goal_result_revisions"."achieved" IS NULL)),
	CONSTRAINT "goal_result_revisions_reason_check" CHECK (length(btrim("goal_result_revisions"."change_reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "goal_subject_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"program_version_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"metric_key" varchar(40) NOT NULL,
	"subject_kind" varchar(24) NOT NULL,
	"property_subject_id" uuid,
	"portal_group_id" uuid,
	"portal_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_subject_assignments_org_property_id_key" UNIQUE("organization_id","property_id","id"),
	CONSTRAINT "goal_subject_assignments_result_fk_key" UNIQUE("organization_id","property_id","program_id","program_version_id","id"),
	CONSTRAINT "goal_subject_assignments_subject_check" CHECK ((
        ("goal_subject_assignments"."subject_kind" = 'property' AND "goal_subject_assignments"."property_subject_id" = "goal_subject_assignments"."property_id" AND "goal_subject_assignments"."portal_group_id" IS NULL AND "goal_subject_assignments"."portal_id" IS NULL)
        OR ("goal_subject_assignments"."subject_kind" = 'portal_group' AND "goal_subject_assignments"."property_subject_id" IS NULL AND "goal_subject_assignments"."portal_group_id" IS NOT NULL AND "goal_subject_assignments"."portal_id" IS NULL)
        OR ("goal_subject_assignments"."subject_kind" = 'portal' AND "goal_subject_assignments"."property_subject_id" IS NULL AND "goal_subject_assignments"."portal_group_id" IS NULL AND "goal_subject_assignments"."portal_id" IS NOT NULL)
      )),
	CONSTRAINT "goal_subject_assignments_metric_check" CHECK ("goal_subject_assignments"."metric_key" IN ('qualified_scans', 'portal_rating_count', 'portal_rating_average')),
	CONSTRAINT "goal_subject_assignments_effective_check" CHECK ("goal_subject_assignments"."effective_to" IS NULL OR "goal_subject_assignments"."effective_to" > "goal_subject_assignments"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD CONSTRAINT "goal_monthly_results_assignment_fk" FOREIGN KEY ("organization_id","property_id","program_id","program_version_id","assignment_id") REFERENCES "public"."goal_subject_assignments"("organization_id","property_id","program_id","program_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_program_versions" ADD CONSTRAINT "goal_program_versions_program_fk" FOREIGN KEY ("organization_id","property_id","program_id") REFERENCES "public"."goal_programs"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_program_versions" ADD CONSTRAINT "goal_program_versions_metric_version_fk" FOREIGN KEY ("metric_definition_id","metric_definition_version_id") REFERENCES "public"."metric_definition_versions"("definition_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_programs" ADD CONSTRAINT "goal_programs_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_result_revisions" ADD CONSTRAINT "goal_result_revisions_supersedes_revision_id_goal_result_revisions_id_fk" FOREIGN KEY ("supersedes_revision_id") REFERENCES "public"."goal_result_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_result_revisions" ADD CONSTRAINT "goal_result_revisions_result_fk" FOREIGN KEY ("organization_id","property_id","monthly_result_id") REFERENCES "public"."goal_monthly_results"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_version_fk" FOREIGN KEY ("organization_id","property_id","program_id","program_version_id","metric_key") REFERENCES "public"."goal_program_versions"("organization_id","property_id","program_id","id","metric_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_property_subject_fk" FOREIGN KEY ("organization_id","property_subject_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_portal_group_fk" FOREIGN KEY ("organization_id","property_id","portal_group_id") REFERENCES "public"."portal_groups"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_monthly_results_due_idx" ON "goal_monthly_results" USING btree ("status","period_end","organization_id","property_id");--> statement-breakpoint
CREATE INDEX "goal_program_versions_effective_idx" ON "goal_program_versions" USING btree ("organization_id","property_id","program_id","effective_from");--> statement-breakpoint
CREATE INDEX "goal_programs_property_status_idx" ON "goal_programs" USING btree ("organization_id","property_id","status");--> statement-breakpoint
CREATE INDEX "goal_result_revisions_history_idx" ON "goal_result_revisions" USING btree ("organization_id","property_id","monthly_result_id","revision");--> statement-breakpoint
CREATE INDEX "goal_subject_assignments_program_idx" ON "goal_subject_assignments" USING btree ("organization_id","property_id","program_id","effective_from");--> statement-breakpoint
CREATE INDEX "goal_subject_assignments_subject_idx" ON "goal_subject_assignments" USING btree ("organization_id","property_id","subject_kind","property_subject_id","portal_group_id","portal_id");