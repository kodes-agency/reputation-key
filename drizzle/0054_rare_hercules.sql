CREATE TABLE "ai_property_trend_outcomes" (
	"schedule_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"disposition" varchar(32) NOT NULL,
	"operation_id" uuid,
	"selected_signal_ids" jsonb,
	"signal_key" varchar(64),
	"direction" varchar(20),
	"confidence_basis_points" integer,
	"supporting_review_count" integer,
	"headline" varchar(80),
	"sentences" jsonb,
	"summary" text,
	"render_profile_version" varchar(100),
	"render_profile_digest" varchar(64),
	"provider_selection_recorded_at" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "ai_property_trend_outcomes_valid" CHECK ((
        "ai_property_trend_outcomes"."disposition" = 'ready'
        AND "ai_property_trend_outcomes"."operation_id" IS NOT NULL
        AND jsonb_typeof("ai_property_trend_outcomes"."selected_signal_ids") = 'array'
        AND jsonb_array_length("ai_property_trend_outcomes"."selected_signal_ids") BETWEEN 1 AND 4
        AND "ai_property_trend_outcomes"."signal_key" ~ '^[a-z][a-z0-9_.]{2,63}$'
        AND "ai_property_trend_outcomes"."direction" IN ('improving', 'stable', 'declining')
        AND "ai_property_trend_outcomes"."confidence_basis_points" BETWEEN 0 AND 10000
        AND "ai_property_trend_outcomes"."supporting_review_count" >= 0
        AND "ai_property_trend_outcomes"."headline" IN ('Review signals improved', 'Review signals need attention', 'Notable review changes')
        AND jsonb_typeof("ai_property_trend_outcomes"."sentences") = 'array'
        AND jsonb_array_length("ai_property_trend_outcomes"."sentences") BETWEEN 1 AND 4
        AND length("ai_property_trend_outcomes"."summary") BETWEEN 1 AND 1000
        AND "ai_property_trend_outcomes"."render_profile_version" = 'trend-render-v1'
        AND "ai_property_trend_outcomes"."render_profile_digest" ~ '^[0-9a-f]{64}$'
        AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NOT NULL
        AND "ai_property_trend_outcomes"."recorded_at" = "ai_property_trend_outcomes"."provider_selection_recorded_at"
        AND "ai_property_trend_outcomes"."expires_at" > "ai_property_trend_outcomes"."recorded_at"
      ) OR (
        "ai_property_trend_outcomes"."disposition" IN ('insufficient_data', 'no_material_change')
        AND "ai_property_trend_outcomes"."operation_id" IS NULL
        AND "ai_property_trend_outcomes"."selected_signal_ids" IS NULL
        AND "ai_property_trend_outcomes"."signal_key" IS NULL
        AND "ai_property_trend_outcomes"."direction" IS NULL
        AND "ai_property_trend_outcomes"."confidence_basis_points" IS NULL
        AND "ai_property_trend_outcomes"."supporting_review_count" IS NULL
        AND "ai_property_trend_outcomes"."headline" IS NULL
        AND "ai_property_trend_outcomes"."sentences" IS NULL
        AND "ai_property_trend_outcomes"."summary" IS NULL
        AND "ai_property_trend_outcomes"."render_profile_version" IS NULL
        AND "ai_property_trend_outcomes"."render_profile_digest" IS NULL
        AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL
        AND "ai_property_trend_outcomes"."expires_at" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "ai_property_trend_scheduler_heads" (
	"scheduler_key" varchar(64) PRIMARY KEY NOT NULL,
	"generation" bigint NOT NULL,
	"cursor_organization_id" varchar(255),
	"cursor_property_id" uuid,
	"lease_owner" uuid,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_trend_scheduler_heads_valid" CHECK ("ai_property_trend_scheduler_heads"."scheduler_key" = 'property-trend-v1' AND "ai_property_trend_scheduler_heads"."generation" BETWEEN 0 AND '9007199254740991'::bigint
        AND (("ai_property_trend_scheduler_heads"."cursor_organization_id" IS NULL AND "ai_property_trend_scheduler_heads"."cursor_property_id" IS NULL) OR ("ai_property_trend_scheduler_heads"."cursor_organization_id" IS NOT NULL AND "ai_property_trend_scheduler_heads"."cursor_property_id" IS NOT NULL))
        AND (("ai_property_trend_scheduler_heads"."lease_owner" IS NULL AND "ai_property_trend_scheduler_heads"."claimed_at" IS NULL AND "ai_property_trend_scheduler_heads"."lease_expires_at" IS NULL) OR ("ai_property_trend_scheduler_heads"."lease_owner" IS NOT NULL AND "ai_property_trend_scheduler_heads"."claimed_at" IS NOT NULL AND "ai_property_trend_scheduler_heads"."lease_expires_at" > "ai_property_trend_scheduler_heads"."claimed_at")))
);
--> statement-breakpoint
CREATE TABLE "ai_property_trend_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outbox_event_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"due_local_date" date NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_trends_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"terminal_analysis_sequence" bigint NOT NULL,
	"aggregate_revision" bigint NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"calendar_profile_version" varchar(100) NOT NULL,
	"report_profile_version" varchar(100) NOT NULL,
	"scheduler_generation" bigint NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_trend_schedules_versions_valid" CHECK ("ai_property_trend_schedules"."source_epoch" >= 1 AND "ai_property_trend_schedules"."review_analysis_epoch" >= 1 AND "ai_property_trend_schedules"."property_trends_epoch" >= 1
        AND "ai_property_trend_schedules"."property_profile_version" >= 1 AND "ai_property_trend_schedules"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."scheduler_generation" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$')
);
--> statement-breakpoint
DROP TABLE "ai_property_trend_reports" CASCADE;--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_schedule_id_ai_property_trend_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."ai_property_trend_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_schedules" ADD CONSTRAINT "ai_property_trend_schedules_calendar_profile_version_ai_property_calendar_authorities_profile_version_fk" FOREIGN KEY ("calendar_profile_version") REFERENCES "public"."ai_property_calendar_authorities"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_schedules" ADD CONSTRAINT "ai_property_trend_schedules_report_profile_version_ai_operation_profiles_profile_version_fk" FOREIGN KEY ("report_profile_version") REFERENCES "public"."ai_operation_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_trend_schedules" ADD CONSTRAINT "ai_property_trend_schedules_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_outcomes_operation_unique" ON "ai_property_trend_outcomes" USING btree ("operation_id") WHERE "ai_property_trend_outcomes"."operation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_property_trend_outcomes_property_idx" ON "ai_property_trend_outcomes" USING btree ("organization_id","property_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_property_trend_outcomes_expiry_idx" ON "ai_property_trend_outcomes" USING btree ("expires_at") WHERE "ai_property_trend_outcomes"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_schedules_outbox_unique" ON "ai_property_trend_schedules" USING btree ("outbox_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_schedules_generation_unique" ON "ai_property_trend_schedules" USING btree ("organization_id","property_id","due_local_date","source_epoch","review_analysis_epoch","property_trends_epoch","property_profile_version","report_profile_version");--> statement-breakpoint
CREATE INDEX "ai_property_trend_schedules_property_idx" ON "ai_property_trend_schedules" USING btree ("organization_id","property_id","due_local_date" DESC NULLS LAST);
--> statement-breakpoint
INSERT INTO "ai_property_trend_scheduler_heads" (
  "scheduler_key", "generation", "cursor_organization_id", "cursor_property_id",
  "lease_owner", "claimed_at", "lease_expires_at", "updated_at"
) VALUES (
  'property-trend-v1', 0, NULL, NULL, NULL, NULL, NULL, transaction_timestamp()
);