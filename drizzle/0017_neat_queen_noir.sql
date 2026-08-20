CREATE TABLE "metric_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reading_id" uuid NOT NULL,
	"source_event_id" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"reason" text NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"exact_delta" numeric(30, 10),
	"replacement_value" numeric(30, 10),
	"event_at" timestamp with time zone NOT NULL,
	"supersedes_correction_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_corrections_kind_check" CHECK ("metric_corrections"."kind" IN ('retract', 'replace', 'adjust'))
);
--> statement-breakpoint
CREATE TABLE "metric_definition_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"numerator_description" text NOT NULL,
	"denominator_description" text,
	"unit" varchar(50) NOT NULL,
	"precision" integer DEFAULT 0 NOT NULL,
	"aggregation_rule" text NOT NULL,
	"late_arrival_rule" text NOT NULL,
	"allowed_scopes" jsonb NOT NULL,
	"attribution_rule" text NOT NULL,
	"minimum_sample" integer DEFAULT 1 NOT NULL,
	"insufficient_data_behavior" varchar(20) DEFAULT 'unavailable' NOT NULL,
	"source_policy_allowlist" jsonb NOT NULL,
	"permitted_consumers" jsonb NOT NULL,
	"employment_decision_eligible" boolean DEFAULT false NOT NULL,
	"correction_behavior" varchar(30) DEFAULT 'append_delta' NOT NULL,
	"fairness_review_status" varchar(30) DEFAULT 'not_required' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_definition_versions_sample_check" CHECK ("metric_definition_versions"."minimum_sample" >= 1),
	CONSTRAINT "metric_definition_versions_precision_check" CHECK ("metric_definition_versions"."precision" >= 0),
	CONSTRAINT "metric_definition_versions_insufficient_check" CHECK ("metric_definition_versions"."insufficient_data_behavior" IN ('unavailable', 'quarantine')),
	CONSTRAINT "metric_definition_versions_employment_check" CHECK ("metric_definition_versions"."employment_decision_eligible" = false)
);
--> statement-breakpoint
CREATE TABLE "metric_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_event_id" varchar(255) NOT NULL,
	"organization_id" varchar(255),
	"property_id" uuid,
	"definition_version_id" uuid,
	"source_policy" varchar(80),
	"reason" varchar(80) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"event_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "metric_source_watermarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consumer_name" varchar(120) NOT NULL,
	"source_name" varchar(120) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"definition_version_id" uuid,
	"last_source_event_id" varchar(255) NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD COLUMN "value_kind" varchar(20) DEFAULT 'counter' NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD COLUMN "worker_data_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD COLUMN "privacy_class" varchar(50) DEFAULT 'operational' NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD COLUMN "retention_class" varchar(50) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD COLUMN "lifecycle_status" varchar(20) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD COLUMN "approval_owner" varchar(255) DEFAULT 'migration-pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "definition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "source_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "source_policy" varchar(80);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "exact_value" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "numerator" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "denominator" numeric(30, 10);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "sample_count" integer;--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "attribution_quality" varchar(40);--> statement-breakpoint
ALTER TABLE "metric_readings" ADD COLUMN "event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "metric_corrections" ADD CONSTRAINT "metric_corrections_reading_id_metric_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."metric_readings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_corrections" ADD CONSTRAINT "metric_corrections_supersedes_correction_id_metric_corrections_id_fk" FOREIGN KEY ("supersedes_correction_id") REFERENCES "public"."metric_corrections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_definition_versions" ADD CONSTRAINT "metric_definition_versions_definition_id_metric_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."metric_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_quarantine" ADD CONSTRAINT "metric_quarantine_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_quarantine" ADD CONSTRAINT "metric_quarantine_definition_version_id_metric_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."metric_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_source_watermarks" ADD CONSTRAINT "metric_source_watermarks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_source_watermarks" ADD CONSTRAINT "metric_source_watermarks_definition_version_id_metric_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."metric_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_corrections_source_unique" ON "metric_corrections" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "metric_corrections_reading_idx" ON "metric_corrections" USING btree ("reading_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_definition_versions_number_unique" ON "metric_definition_versions" USING btree ("definition_id","version");--> statement-breakpoint
CREATE INDEX "metric_definition_versions_effective_idx" ON "metric_definition_versions" USING btree ("definition_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_quarantine_source_reason_unique" ON "metric_quarantine" USING btree ("source_event_id","reason");--> statement-breakpoint
CREATE INDEX "metric_quarantine_scope_idx" ON "metric_quarantine" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_source_watermarks_scope_unique" ON "metric_source_watermarks" USING btree ("consumer_name","source_name","organization_id","property_id","definition_version_id");--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_definition_version_id_metric_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "public"."metric_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "metric_readings_version_source_unique" ON "metric_readings" USING btree ("definition_version_id","source_event_id") WHERE "metric_readings"."definition_version_id" IS NOT NULL AND "metric_readings"."source_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "metric_readings_version_event_idx" ON "metric_readings" USING btree ("definition_version_id","event_at");--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_value_kind_check" CHECK ("metric_definitions"."value_kind" IN ('counter', 'duration', 'level', 'ratio', 'average'));--> statement-breakpoint
ALTER TABLE "metric_definitions" ADD CONSTRAINT "metric_definitions_lifecycle_check" CHECK ("metric_definitions"."lifecycle_status" IN ('draft', 'approved', 'retired'));--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_attribution_quality_check" CHECK ("metric_readings"."attribution_quality" IS NULL OR "metric_readings"."attribution_quality" IN ('exact', 'current_state_backfill', 'unresolved'));--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_ratio_check" CHECK (("metric_readings"."numerator" IS NULL AND "metric_readings"."denominator" IS NULL) OR ("metric_readings"."numerator" IS NOT NULL AND "metric_readings"."denominator" IS NOT NULL AND "metric_readings"."denominator" > 0));