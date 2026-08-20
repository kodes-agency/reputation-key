-- Goal governance expansion (ADR 0042).
-- Versioned definitions, periods, and evaluations are the only mutation path.

CREATE UNIQUE INDEX IF NOT EXISTS "metric_definition_versions_definition_id_id_key"
  ON "metric_definition_versions" ("definition_id", "id");
--> statement-breakpoint

CREATE TABLE "goal_definitions" (
  "id" uuid PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "scope_kind" varchar(30) NOT NULL,
  "portal_group_id" uuid,
  "name" varchar(200) NOT NULL,
  "description" text,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "status_reason" text,
  "current_version" integer NOT NULL DEFAULT 1,
  "created_by" varchar(255) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_definitions_scope_check" CHECK (
    ("scope_kind" = 'property' AND "portal_group_id" IS NULL) OR
    ("scope_kind" = 'portal_group' AND "portal_group_id" IS NOT NULL)
  ),
  CONSTRAINT "goal_definitions_status_check" CHECK ("status" IN ('active', 'paused', 'cancelled')),
  CONSTRAINT "goal_definitions_version_check" CHECK ("current_version" >= 1),
  CONSTRAINT "goal_definitions_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "goal_definitions_org_property_id_key" UNIQUE ("organization_id", "property_id", "id"),
  CONSTRAINT "goal_definitions_org_property_fk" FOREIGN KEY ("organization_id", "property_id")
    REFERENCES "properties" ("organization_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_definitions_portal_group_fk" FOREIGN KEY ("organization_id", "property_id", "portal_group_id")
    REFERENCES "portal_groups" ("organization_id", "property_id", "id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE INDEX "goal_definitions_scope_status_idx"
  ON "goal_definitions" ("organization_id", "property_id", "status", "scope_kind");
--> statement-breakpoint

CREATE TABLE "goal_definition_versions" (
  "id" uuid PRIMARY KEY,
  "definition_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "metric_definition_id" uuid NOT NULL,
  "metric_definition_version_id" uuid NOT NULL,
  "metric_key" varchar(100) NOT NULL,
  "metric_value_kind" varchar(20) NOT NULL,
  "metric_minimum_sample" integer NOT NULL,
  "metric_allowed_scopes" jsonb NOT NULL,
  "metric_permitted_consumers" jsonb NOT NULL,
  "metric_employment_decision_eligible" boolean NOT NULL DEFAULT false,
  "measure_kind" varchar(20) NOT NULL,
  "target_value" numeric(30,10) NOT NULL,
  "source_policy" varchar(80) NOT NULL,
  "property_timezone" varchar(64) NOT NULL,
  "recurrence_rule" jsonb NOT NULL,
  "effective_from" timestamptz NOT NULL,
  "effective_to" timestamptz,
  "change_reason" text NOT NULL,
  "created_by" varchar(255) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_definition_versions_definition_version_key" UNIQUE ("definition_id", "version"),
  CONSTRAINT "goal_definition_versions_org_property_id_key" UNIQUE ("organization_id", "property_id", "id"),
  CONSTRAINT "goal_definition_versions_org_property_definition_id_key" UNIQUE ("organization_id", "property_id", "definition_id", "id"),
  CONSTRAINT "goal_definition_versions_definition_fk" FOREIGN KEY ("organization_id", "property_id", "definition_id")
    REFERENCES "goal_definitions" ("organization_id", "property_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_definition_versions_metric_version_fk" FOREIGN KEY ("metric_definition_id", "metric_definition_version_id")
    REFERENCES "metric_definition_versions" ("definition_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_definition_versions_kind_check" CHECK ("measure_kind" IN ('progress', 'level', 'ratio')),
  CONSTRAINT "goal_definition_versions_target_check" CHECK ("target_value" > 0),
  CONSTRAINT "goal_definition_versions_metric_sample_check" CHECK ("metric_minimum_sample" >= 1),
  CONSTRAINT "goal_definition_versions_employment_check" CHECK ("metric_employment_decision_eligible" = false),
  CONSTRAINT "goal_definition_versions_effective_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from")
);
--> statement-breakpoint

CREATE INDEX "goal_definition_versions_effective_idx"
  ON "goal_definition_versions" ("organization_id", "property_id", "definition_id", "effective_from");
--> statement-breakpoint

CREATE TABLE "goal_periods" (
  "id" uuid PRIMARY KEY,
  "definition_id" uuid NOT NULL,
  "definition_version_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "period_start" timestamptz NOT NULL,
  "period_end" timestamptz NOT NULL,
  "property_timezone" varchar(64) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "status_reason" text,
  "evaluation_watermark" timestamptz,
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_periods_identity_key" UNIQUE ("definition_id", "definition_version_id", "period_start", "period_end"),
  CONSTRAINT "goal_periods_org_property_id_key" UNIQUE ("organization_id", "property_id", "id"),
  CONSTRAINT "goal_periods_org_property_definition_version_id_key" UNIQUE ("organization_id", "property_id", "definition_id", "definition_version_id", "id"),
  CONSTRAINT "goal_periods_definition_fk" FOREIGN KEY ("organization_id", "property_id", "definition_id")
    REFERENCES "goal_definitions" ("organization_id", "property_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_periods_version_fk" FOREIGN KEY ("organization_id", "property_id", "definition_id", "definition_version_id")
    REFERENCES "goal_definition_versions" ("organization_id", "property_id", "definition_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_periods_bounds_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "goal_periods_status_check" CHECK ("status" IN ('scheduled', 'open', 'closed', 'cancelled'))
);
--> statement-breakpoint

CREATE INDEX "goal_periods_due_idx"
  ON "goal_periods" ("status", "period_end", "organization_id", "property_id")
  WHERE "status" IN ('scheduled', 'open');
--> statement-breakpoint

CREATE TABLE "goal_evaluations" (
  "id" uuid PRIMARY KEY,
  "period_id" uuid NOT NULL,
  "definition_id" uuid NOT NULL,
  "definition_version_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "metric_reading_id" uuid,
  "source_event_id" varchar(255),
  "idempotency_key" varchar(255) NOT NULL,
  "state" varchar(30) NOT NULL,
  "reason" text,
  "value" numeric(30,10),
  "numerator" numeric(30,10),
  "denominator" numeric(30,10),
  "sample_count" integer,
  "achieved" boolean NOT NULL DEFAULT false,
  "evaluation_watermark" timestamptz NOT NULL,
  "supersedes_evaluation_id" uuid,
  "correction_reading_id" uuid,
  "created_by" varchar(255) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_evaluations_idempotency_key" UNIQUE ("organization_id", "property_id", "idempotency_key"),
  CONSTRAINT "goal_evaluations_org_property_period_id_key" UNIQUE ("organization_id", "property_id", "period_id", "id"),
  CONSTRAINT "goal_evaluations_period_fk" FOREIGN KEY ("organization_id", "property_id", "definition_id", "definition_version_id", "period_id")
    REFERENCES "goal_periods" ("organization_id", "property_id", "definition_id", "definition_version_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_evaluations_metric_reading_fk" FOREIGN KEY ("metric_reading_id")
    REFERENCES "metric_readings" ("id") ON DELETE RESTRICT,
  CONSTRAINT "goal_evaluations_correction_reading_fk" FOREIGN KEY ("correction_reading_id")
    REFERENCES "metric_readings" ("id") ON DELETE RESTRICT,
  CONSTRAINT "goal_evaluations_supersedes_fk" FOREIGN KEY ("supersedes_evaluation_id")
    REFERENCES "goal_evaluations" ("id") ON DELETE RESTRICT,
  CONSTRAINT "goal_evaluations_state_check" CHECK ("state" IN ('eligible', 'insufficient_data', 'unavailable', 'quarantined')),
  CONSTRAINT "goal_evaluations_ratio_check" CHECK (
    ("numerator" IS NULL AND "denominator" IS NULL) OR
    ("numerator" IS NOT NULL AND "denominator" IS NOT NULL AND "denominator" > 0)
  ),
  CONSTRAINT "goal_evaluations_sample_check" CHECK ("sample_count" IS NULL OR "sample_count" >= 0),
  CONSTRAINT "goal_evaluations_value_state_check" CHECK (
    ("state" = 'eligible' AND "value" IS NOT NULL) OR
    ("state" <> 'eligible' AND "value" IS NULL AND "achieved" = false)
  )
);
--> statement-breakpoint

CREATE INDEX "goal_evaluations_history_idx"
  ON "goal_evaluations" ("organization_id", "property_id", "period_id", "created_at");
--> statement-breakpoint

CREATE TABLE "goal_timezone_event_receipts" (
  "source_event_id" varchar(255) NOT NULL,
  "definition_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "property_version" integer NOT NULL,
  "new_definition_version_id" uuid NOT NULL,
  "new_period_id" uuid NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("source_event_id", "definition_id"),
  CONSTRAINT "goal_timezone_receipts_definition_fk" FOREIGN KEY ("organization_id", "property_id", "definition_id")
    REFERENCES "goal_definitions" ("organization_id", "property_id", "id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE TABLE "goal_refresh_receipts" (
  "source_event_id" varchar(255) NOT NULL,
  "period_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "evaluation_id" uuid NOT NULL,
  "processed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("source_event_id", "period_id"),
  CONSTRAINT "goal_refresh_receipts_period_fk" FOREIGN KEY ("organization_id", "property_id", "period_id")
    REFERENCES "goal_periods" ("organization_id", "property_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "goal_refresh_receipts_evaluation_fk" FOREIGN KEY ("organization_id", "property_id", "period_id", "evaluation_id")
    REFERENCES "goal_evaluations" ("organization_id", "property_id", "period_id", "id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "reject_goal_immutable_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "goal_definition_versions_immutable"
  BEFORE UPDATE OR DELETE ON "goal_definition_versions"
  FOR EACH ROW EXECUTE FUNCTION "reject_goal_immutable_update"();
--> statement-breakpoint

CREATE TRIGGER "goal_evaluations_immutable"
  BEFORE UPDATE OR DELETE ON "goal_evaluations"
  FOR EACH ROW EXECUTE FUNCTION "reject_goal_immutable_update"();
