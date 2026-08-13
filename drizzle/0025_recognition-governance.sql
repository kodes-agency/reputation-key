CREATE TABLE "recognition_activations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "capability_policy_version" varchar(80) NOT NULL,
  "jurisdiction" varchar(80) NOT NULL,
  "notice_status" varchar(30) NOT NULL,
  "consultation_status" varchar(30) NOT NULL,
  "metric_definition_version_id" uuid NOT NULL,
  "aggregation" varchar(20) NOT NULL,
  "period_kind" varchar(20) NOT NULL,
  "minimum_exposure" integer NOT NULL,
  "minimum_sample" integer NOT NULL,
  "freshness_seconds" integer NOT NULL,
  "minimum_completeness" numeric(6,5) NOT NULL,
  "audience" varchar(80) NOT NULL,
  "acknowledged_by" varchar(255) NOT NULL,
  "acknowledged_at" timestamp with time zone NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_to" timestamp with time zone,
  "status" varchar(20) NOT NULL,
  "deactivation_reason" text,
  "employment_decision_eligible" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recognition_activations_status_check" CHECK ("status" IN ('active', 'inactive')),
  CONSTRAINT "recognition_activations_notice_check" CHECK ("notice_status" = 'completed'),
  CONSTRAINT "recognition_activations_consultation_check" CHECK ("consultation_status" IN ('completed', 'not_required')),
  CONSTRAINT "recognition_activations_aggregation_check" CHECK ("aggregation" IN ('sum', 'latest', 'ratio')),
  CONSTRAINT "recognition_activations_period_kind_check" CHECK ("period_kind" IN ('weekly', 'monthly', 'quarterly')),
  CONSTRAINT "recognition_activations_thresholds_check" CHECK ("minimum_exposure" >= 1 AND "minimum_sample" >= 1 AND "freshness_seconds" > 0 AND "minimum_completeness" >= 0 AND "minimum_completeness" <= 1),
  CONSTRAINT "recognition_activations_audience_check" CHECK ("audience" = 'property_managers_and_scoped_staff'),
  CONSTRAINT "recognition_activations_employment_check" CHECK ("employment_decision_eligible" = false),
  CONSTRAINT "recognition_activations_interval_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_activations_active_property_unique" ON "recognition_activations" ("organization_id", "property_id") WHERE "status" = 'active' AND "effective_to" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_activations_scope_id_key" ON "recognition_activations" ("organization_id", "property_id", "id");
--> statement-breakpoint
CREATE INDEX "recognition_activations_property_status_idx" ON "recognition_activations" ("organization_id", "property_id", "status");
--> statement-breakpoint
ALTER TABLE "recognition_activations" ADD CONSTRAINT "recognition_activations_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_activations" VALIDATE CONSTRAINT "recognition_activations_property_tenant_fk";
--> statement-breakpoint
ALTER TABLE "recognition_activations" ADD CONSTRAINT "recognition_activations_metric_version_fk" FOREIGN KEY ("metric_definition_version_id") REFERENCES "metric_definition_versions"("id") ON DELETE restrict;
--> statement-breakpoint

CREATE TABLE "recognition_activation_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "activation_id" uuid NOT NULL,
  "portal_group_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_activation_groups_unique" ON "recognition_activation_groups" ("activation_id", "portal_group_id");
--> statement-breakpoint
CREATE INDEX "recognition_activation_groups_scope_idx" ON "recognition_activation_groups" ("organization_id", "property_id", "portal_group_id");
--> statement-breakpoint
ALTER TABLE "recognition_activation_groups" ADD CONSTRAINT "recognition_activation_groups_activation_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "activation_id") REFERENCES "recognition_activations"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_activation_groups" VALIDATE CONSTRAINT "recognition_activation_groups_activation_tenant_fk";
--> statement-breakpoint
ALTER TABLE "recognition_activation_groups" ADD CONSTRAINT "recognition_activation_groups_portal_group_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id") REFERENCES "portal_groups"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_activation_groups" VALIDATE CONSTRAINT "recognition_activation_groups_portal_group_tenant_fk";
--> statement-breakpoint

CREATE TABLE "recognition_board_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "activation_id" uuid NOT NULL,
  "metric_definition_id" uuid NOT NULL,
  "metric_definition_version_id" uuid NOT NULL,
  "aggregation" varchar(20) NOT NULL,
  "period_kind" varchar(20) NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "timezone" varchar(100) NOT NULL,
  "minimum_exposure" integer NOT NULL,
  "minimum_sample" integer NOT NULL,
  "freshness_seconds" integer NOT NULL,
  "minimum_completeness" numeric(6,5) NOT NULL,
  "source_watermark" timestamp with time zone NOT NULL,
  "status" varchar(20) NOT NULL,
  "eligibility_reason" varchar(60),
  "correction_generation" integer DEFAULT 0 NOT NULL,
  "employment_decision_eligible" boolean DEFAULT false NOT NULL,
  "reconciled_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recognition_board_snapshots_aggregation_check" CHECK ("aggregation" IN ('sum', 'latest', 'ratio')),
  CONSTRAINT "recognition_board_snapshots_period_check" CHECK ("period_kind" IN ('weekly', 'monthly', 'quarterly')),
  CONSTRAINT "recognition_board_snapshots_status_check" CHECK ("status" IN ('building', 'ready', 'stale', 'insufficient', 'corrected')),
  CONSTRAINT "recognition_board_snapshots_thresholds_check" CHECK ("minimum_exposure" >= 1 AND "minimum_sample" >= 1 AND "freshness_seconds" > 0 AND "minimum_completeness" >= 0 AND "minimum_completeness" <= 1),
  CONSTRAINT "recognition_board_snapshots_period_bounds_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "recognition_board_snapshots_employment_check" CHECK ("employment_decision_eligible" = false)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_board_snapshots_key_unique" ON "recognition_board_snapshots" ("organization_id", "property_id", "period_start", "period_end", "metric_definition_version_id", "source_watermark", "correction_generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_board_snapshots_scope_id_key" ON "recognition_board_snapshots" ("organization_id", "property_id", "id");
--> statement-breakpoint
CREATE INDEX "recognition_board_snapshots_property_period_idx" ON "recognition_board_snapshots" ("organization_id", "property_id", "period_end");
--> statement-breakpoint
ALTER TABLE "recognition_board_snapshots" ADD CONSTRAINT "recognition_board_snapshots_activation_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "activation_id") REFERENCES "recognition_activations"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_board_snapshots" VALIDATE CONSTRAINT "recognition_board_snapshots_activation_tenant_fk";
--> statement-breakpoint
ALTER TABLE "recognition_board_snapshots" ADD CONSTRAINT "recognition_board_snapshots_metric_definition_fk" FOREIGN KEY ("metric_definition_id") REFERENCES "metric_definitions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "recognition_board_snapshots" ADD CONSTRAINT "recognition_board_snapshots_metric_version_fk" FOREIGN KEY ("metric_definition_version_id") REFERENCES "metric_definition_versions"("id") ON DELETE restrict;
--> statement-breakpoint

CREATE TABLE "recognition_board_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "portal_group_id" uuid NOT NULL,
  "value" numeric(30,10),
  "numerator" numeric(30,10),
  "denominator" numeric(30,10),
  "sample_count" integer NOT NULL,
  "exposure_count" integer NOT NULL,
  "completeness" numeric(6,5) NOT NULL,
  "rank" integer,
  "tie_group" integer,
  "eligibility_reason" varchar(60) NOT NULL,
  "status" varchar(20) NOT NULL,
  "source_watermark" timestamp with time zone NOT NULL,
  "correction_generation" integer DEFAULT 0 NOT NULL,
  "employment_decision_eligible" boolean DEFAULT false NOT NULL,
  "reconciled_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recognition_board_entries_status_check" CHECK ("status" IN ('ranked', 'insufficient', 'stale', 'corrected')),
  CONSTRAINT "recognition_board_entries_rank_status_check" CHECK (("status" IN ('ranked', 'corrected') AND "rank" >= 1 AND "tie_group" >= 1) OR ("status" IN ('insufficient', 'stale') AND "rank" IS NULL AND "tie_group" IS NULL)),
  CONSTRAINT "recognition_board_entries_evidence_bounds_check" CHECK ("sample_count" >= 0 AND "exposure_count" >= 0 AND "completeness" >= 0 AND "completeness" <= 1),
  CONSTRAINT "recognition_board_entries_ratio_consistency_check" CHECK (("numerator" IS NULL AND "denominator" IS NULL) OR ("numerator" IS NOT NULL AND "denominator" IS NOT NULL AND "denominator" > 0 AND "value" IS NOT NULL AND abs("value" - ("numerator" / "denominator")) < 0.0000000001)),
  CONSTRAINT "recognition_board_entries_employment_check" CHECK ("employment_decision_eligible" = false)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_board_entries_snapshot_group_unique" ON "recognition_board_entries" ("snapshot_id", "portal_group_id");
--> statement-breakpoint
CREATE INDEX "recognition_board_entries_rank_idx" ON "recognition_board_entries" ("snapshot_id", "rank");
--> statement-breakpoint
ALTER TABLE "recognition_board_entries" ADD CONSTRAINT "recognition_board_entries_snapshot_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "snapshot_id") REFERENCES "recognition_board_snapshots"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_board_entries" VALIDATE CONSTRAINT "recognition_board_entries_snapshot_tenant_fk";
--> statement-breakpoint
ALTER TABLE "recognition_board_entries" ADD CONSTRAINT "recognition_board_entries_portal_group_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id") REFERENCES "portal_groups"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_board_entries" VALIDATE CONSTRAINT "recognition_board_entries_portal_group_tenant_fk";
--> statement-breakpoint

CREATE TABLE "recognition_reconciliation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "metric_definition_version_id" uuid NOT NULL,
  "source_event_id" varchar(255) NOT NULL,
  "correction_reference" varchar(255),
  "source_watermark" timestamp with time zone NOT NULL,
  "processed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_reconciliation_events_source_unique" ON "recognition_reconciliation_events" ("organization_id", "property_id", "metric_definition_version_id", "source_event_id");
--> statement-breakpoint
CREATE INDEX "recognition_reconciliation_events_watermark_idx" ON "recognition_reconciliation_events" ("organization_id", "property_id", "source_watermark");
--> statement-breakpoint
ALTER TABLE "recognition_reconciliation_events" ADD CONSTRAINT "recognition_reconciliation_events_metric_version_fk" FOREIGN KEY ("metric_definition_version_id") REFERENCES "metric_definition_versions"("id") ON DELETE restrict;
--> statement-breakpoint

CREATE TABLE "badge_definition_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "badge_definition_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "name" varchar(200) NOT NULL,
  "icon" varchar(50) NOT NULL,
  "criteria" text NOT NULL,
  "rule" text NOT NULL,
  "metric_definition_version_id" uuid NOT NULL,
  "aggregation" varchar(20) NOT NULL,
  "threshold" numeric(30,10) NOT NULL,
  "minimum_exposure" integer NOT NULL,
  "minimum_sample" integer NOT NULL,
  "freshness_seconds" integer NOT NULL,
  "minimum_completeness" numeric(6,5) NOT NULL,
  "effective_from" timestamp with time zone NOT NULL,
  "effective_to" timestamp with time zone,
  "employment_decision_eligible" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "badge_definition_versions_aggregation_check" CHECK ("aggregation" IN ('sum', 'latest', 'ratio')),
  CONSTRAINT "badge_definition_versions_thresholds_check" CHECK ("minimum_exposure" >= 1 AND "minimum_sample" >= 1 AND "freshness_seconds" > 0 AND "minimum_completeness" >= 0 AND "minimum_completeness" <= 1 AND "threshold" >= 0),
  CONSTRAINT "badge_definition_versions_employment_check" CHECK ("employment_decision_eligible" = false)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "badge_definition_versions_number_unique" ON "badge_definition_versions" ("badge_definition_id", "version");
--> statement-breakpoint
ALTER TABLE "badge_definition_versions" ADD CONSTRAINT "badge_definition_versions_definition_fk" FOREIGN KEY ("badge_definition_id") REFERENCES "badge_definitions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "badge_definition_versions" ADD CONSTRAINT "badge_definition_versions_metric_version_fk" FOREIGN KEY ("metric_definition_version_id") REFERENCES "metric_definition_versions"("id") ON DELETE restrict;
--> statement-breakpoint

CREATE TABLE "recognition_awards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "portal_group_id" uuid NOT NULL,
  "definition_version_id" uuid NOT NULL,
  "metric_definition_version_id" uuid NOT NULL,
  "source_snapshot_id" uuid NOT NULL,
  "source_fact_id" varchar(255) NOT NULL,
  "source_watermark" timestamp with time zone NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "timezone" varchar(100) NOT NULL,
  "sample_count" integer NOT NULL,
  "exposure_count" integer NOT NULL,
  "completeness" numeric(6,5) NOT NULL,
  "eligibility_reason" varchar(60) NOT NULL,
  "definition_snapshot" jsonb NOT NULL,
  "awarded_at" timestamp with time zone NOT NULL,
  "employment_decision_eligible" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recognition_awards_period_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "recognition_awards_evidence_check" CHECK ("sample_count" >= 1 AND "exposure_count" >= 1 AND "completeness" >= 0 AND "completeness" <= 1),
  CONSTRAINT "recognition_awards_employment_check" CHECK ("employment_decision_eligible" = false)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_awards_source_fact_unique" ON "recognition_awards" ("organization_id", "property_id", "source_fact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_awards_scope_id_key" ON "recognition_awards" ("organization_id", "property_id", "id");
--> statement-breakpoint
CREATE INDEX "recognition_awards_group_period_idx" ON "recognition_awards" ("organization_id", "property_id", "portal_group_id", "period_end");
--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_portal_group_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id") REFERENCES "portal_groups"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_awards" VALIDATE CONSTRAINT "recognition_awards_portal_group_tenant_fk";
--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_definition_version_fk" FOREIGN KEY ("definition_version_id") REFERENCES "badge_definition_versions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_metric_version_fk" FOREIGN KEY ("metric_definition_version_id") REFERENCES "metric_definition_versions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_source_snapshot_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "source_snapshot_id") REFERENCES "recognition_board_snapshots"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_awards" VALIDATE CONSTRAINT "recognition_awards_source_snapshot_tenant_fk";
--> statement-breakpoint

CREATE TABLE "recognition_award_status_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "award_id" uuid NOT NULL,
  "status" varchar(20) NOT NULL,
  "correction_reference" varchar(255),
  "replacement_award_id" uuid,
  "replacement_organization_id" varchar(255),
  "replacement_property_id" uuid,
  "reason" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recognition_award_status_check" CHECK ("status" IN ('invalidated', 'superseded')),
  CONSTRAINT "recognition_award_status_replacement_check" CHECK (("status" = 'invalidated' AND "replacement_award_id" IS NULL AND "replacement_organization_id" IS NULL AND "replacement_property_id" IS NULL) OR ("status" = 'superseded' AND "replacement_award_id" IS NOT NULL AND "replacement_award_id" <> "award_id" AND "replacement_organization_id" = "organization_id" AND "replacement_property_id" = "property_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_award_status_correction_unique" ON "recognition_award_status_facts" ("award_id", "correction_reference") WHERE "correction_reference" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "recognition_award_status_award_idx" ON "recognition_award_status_facts" ("award_id", "occurred_at");
--> statement-breakpoint
ALTER TABLE "recognition_award_status_facts" ADD CONSTRAINT "recognition_award_status_award_tenant_fk" FOREIGN KEY ("organization_id", "property_id", "award_id") REFERENCES "recognition_awards"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_award_status_facts" VALIDATE CONSTRAINT "recognition_award_status_award_tenant_fk";
--> statement-breakpoint
ALTER TABLE "recognition_award_status_facts" ADD CONSTRAINT "recognition_award_status_replacement_tenant_fk" FOREIGN KEY ("replacement_organization_id", "replacement_property_id", "replacement_award_id") REFERENCES "recognition_awards"("organization_id", "property_id", "id") ON DELETE restrict NOT VALID;
--> statement-breakpoint
ALTER TABLE "recognition_award_status_facts" VALIDATE CONSTRAINT "recognition_award_status_replacement_tenant_fk";
--> statement-breakpoint

CREATE FUNCTION "reject_recognition_immutable_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'recognition governance facts are append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "recognition_board_snapshots_append_only" BEFORE UPDATE OR DELETE ON "recognition_board_snapshots" FOR EACH ROW EXECUTE FUNCTION "reject_recognition_immutable_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recognition_board_entries_append_only" BEFORE UPDATE OR DELETE ON "recognition_board_entries" FOR EACH ROW EXECUTE FUNCTION "reject_recognition_immutable_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recognition_reconciliation_events_append_only" BEFORE UPDATE OR DELETE ON "recognition_reconciliation_events" FOR EACH ROW EXECUTE FUNCTION "reject_recognition_immutable_mutation"();
--> statement-breakpoint
CREATE TRIGGER "badge_definition_versions_append_only" BEFORE UPDATE OR DELETE ON "badge_definition_versions" FOR EACH ROW EXECUTE FUNCTION "reject_recognition_immutable_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recognition_awards_append_only" BEFORE UPDATE OR DELETE ON "recognition_awards" FOR EACH ROW EXECUTE FUNCTION "reject_recognition_immutable_mutation"();
--> statement-breakpoint
CREATE TRIGGER "recognition_award_status_facts_append_only" BEFORE UPDATE OR DELETE ON "recognition_award_status_facts" FOR EACH ROW EXECUTE FUNCTION "reject_recognition_immutable_mutation"();
