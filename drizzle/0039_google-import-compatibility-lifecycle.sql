CREATE TYPE "public"."google_connected_event_issuance_version" AS ENUM('v1', 'v2');--> statement-breakpoint
CREATE TYPE "public"."google_oauth_state_issuance_version" AS ENUM('signed-v1', 'opaque-v2');--> statement-breakpoint
CREATE TYPE "public"."legacy_import_control_state" AS ENUM('open', 'quiescing', 'closed');--> statement-breakpoint
CREATE TYPE "public"."legacy_import_effect_lease_state" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TYPE "public"."legacy_import_history_status" AS ENUM('completed', 'completed_with_issues', 'failed');--> statement-breakpoint
CREATE TABLE "gbp_import_legacy_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"initiated_by" varchar(255) NOT NULL,
	"contract_version" varchar(32) DEFAULT 'legacy-v1' NOT NULL,
	"original_status" varchar(40) NOT NULL,
	"normalized_status" "legacy_import_history_status" NOT NULL,
	"total_count" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"failed_count" integer NOT NULL,
	"original_created_at" timestamp with time zone NOT NULL,
	"original_updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone NOT NULL,
	"row_digest" varchar(64) NOT NULL,
	"abandoned_by" varchar(255),
	"abandon_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_legacy_history_contract_check" CHECK ("gbp_import_legacy_history"."contract_version" = 'legacy-v1'),
	CONSTRAINT "gbp_import_legacy_history_original_status_check" CHECK ("gbp_import_legacy_history"."original_status" IN ('completed', 'completed_with_skips', 'completed_with_failures', 'failed')),
	CONSTRAINT "gbp_import_legacy_history_count_check" CHECK ("gbp_import_legacy_history"."total_count" >= 0 AND "gbp_import_legacy_history"."imported_count" >= 0 AND "gbp_import_legacy_history"."skipped_count" >= 0 AND "gbp_import_legacy_history"."failed_count" >= 0),
	CONSTRAINT "gbp_import_legacy_history_digest_check" CHECK ("gbp_import_legacy_history"."row_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "gbp_import_legacy_history_abandonment_check" CHECK (("gbp_import_legacy_history"."abandoned_by" IS NULL) = ("gbp_import_legacy_history"."abandon_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "legacy_import_control" (
	"environment" varchar(64) PRIMARY KEY NOT NULL,
	"state" "legacy_import_control_state" DEFAULT 'open' NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"connected_event_issuance" "google_connected_event_issuance_version" DEFAULT 'v1' NOT NULL,
	"oauth_state_issuance" "google_oauth_state_issuance_version" DEFAULT 'signed-v1' NOT NULL,
	"connected_event_converged_at" timestamp with time zone,
	"oauth_state_converged_at" timestamp with time zone,
	"v1_state_drain_not_before" timestamp with time zone,
	"v1_events_drained_at" timestamp with time zone,
	"quiescing_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"operator_id" varchar(255),
	"reason" varchar(500),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_control_generation_check" CHECK ("legacy_import_control"."generation" >= 1),
	CONSTRAINT "legacy_import_control_event_issuance_check" CHECK (("legacy_import_control"."connected_event_issuance" = 'v1' AND "legacy_import_control"."connected_event_converged_at" IS NULL) OR ("legacy_import_control"."connected_event_issuance" = 'v2' AND "legacy_import_control"."connected_event_converged_at" IS NOT NULL)),
	CONSTRAINT "legacy_import_control_oauth_issuance_check" CHECK (("legacy_import_control"."oauth_state_issuance" = 'signed-v1' AND "legacy_import_control"."oauth_state_converged_at" IS NULL AND "legacy_import_control"."v1_state_drain_not_before" IS NULL) OR ("legacy_import_control"."oauth_state_issuance" = 'opaque-v2' AND "legacy_import_control"."connected_event_issuance" = 'v2' AND "legacy_import_control"."oauth_state_converged_at" IS NOT NULL AND "legacy_import_control"."v1_state_drain_not_before" IS NOT NULL)),
	CONSTRAINT "legacy_import_control_state_check" CHECK (("legacy_import_control"."state" = 'open' AND "legacy_import_control"."quiescing_at" IS NULL AND "legacy_import_control"."closed_at" IS NULL) OR ("legacy_import_control"."state" = 'quiescing' AND "legacy_import_control"."quiescing_at" IS NOT NULL AND "legacy_import_control"."closed_at" IS NULL) OR ("legacy_import_control"."state" = 'closed' AND "legacy_import_control"."quiescing_at" IS NOT NULL AND "legacy_import_control"."closed_at" IS NOT NULL)),
	CONSTRAINT "legacy_import_control_close_gate_check" CHECK ("legacy_import_control"."state" = 'open' OR ("legacy_import_control"."oauth_state_issuance" = 'opaque-v2' AND "legacy_import_control"."v1_events_drained_at" IS NOT NULL AND "legacy_import_control"."quiescing_at" >= "legacy_import_control"."v1_state_drain_not_before")),
	CONSTRAINT "legacy_import_control_operator_check" CHECK (("legacy_import_control"."operator_id" IS NULL) = ("legacy_import_control"."reason" IS NULL))
);
INSERT INTO "legacy_import_control" ("environment") VALUES ('global') ON CONFLICT ("environment") DO NOTHING;--> statement-breakpoint
CREATE TABLE "legacy_import_effect_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" varchar(64) NOT NULL,
	"job_id" uuid NOT NULL,
	"generation" bigint NOT NULL,
	"worker_id" varchar(255) NOT NULL,
	"state" "legacy_import_effect_lease_state" DEFAULT 'active' NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_import_effect_leases_generation_check" CHECK ("legacy_import_effect_leases"."generation" >= 1),
	CONSTRAINT "legacy_import_effect_leases_state_check" CHECK (("legacy_import_effect_leases"."state" = 'active' AND "legacy_import_effect_leases"."released_at" IS NULL) OR ("legacy_import_effect_leases"."state" = 'released' AND "legacy_import_effect_leases"."released_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "gbp_import_legacy_history_org_created_idx" ON "gbp_import_legacy_history" USING btree ("organization_id","original_created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_import_effect_leases_one_active_job_idx" ON "legacy_import_effect_leases" USING btree ("environment","job_id") WHERE "legacy_import_effect_leases"."state" = 'active';--> statement-breakpoint
CREATE INDEX "legacy_import_effect_leases_active_idx" ON "legacy_import_effect_leases" USING btree ("environment","state","generation","acquired_at");