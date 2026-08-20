-- WP1A/F1: fail-closed Google Content approval, authorization, and credential authority.

CREATE TYPE "public"."google_credential_use_state" AS ENUM ('active', 'cleanup_only', 'none');
--> statement-breakpoint
CREATE TYPE "public"."authorization_commit_vector_mode" AS ENUM ('full', 'core_credential_projection');
--> statement-breakpoint
CREATE TYPE "public"."authorization_execution_permit_state" AS ENUM ('admitted', 'started', 'completed', 'fenced');
--> statement-breakpoint
CREATE TYPE "public"."credential_revoke_permit_state" AS ENUM ('dormant', 'active', 'dispatching', 'consumed_no_revoke', 'confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous', 'provider_reset_confirmed');
--> statement-breakpoint
CREATE TYPE "public"."google_content_approval_status" AS ENUM ('approved', 'suspended', 'expired', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."google_content_approval_target_phase" AS ENUM ('local_sandbox', 'production_expand_canary', 'production_final');
--> statement-breakpoint
CREATE TYPE "public"."google_content_capability" AS ENUM ('property.import_gbp_v2', 'property.read_gbp_performance');
--> statement-breakpoint
CREATE TYPE "public"."google_content_environment_profile" AS ENUM ('sandbox', 'production');
--> statement-breakpoint
CREATE TYPE "public"."google_credential_source_kind" AS ENUM ('refresh', 'reauth', 'reconnect');
--> statement-breakpoint
CREATE TYPE "public"."google_credential_source_state" AS ENUM ('registered', 'provider_started', 'terminal', 'provider_outcome_ambiguous', 'provider_reset_terminal');
--> statement-breakpoint
CREATE TYPE "public"."google_subject_authority_guard_state" AS ENUM ('open', 'source_active', 'cleanup_pending', 'drained', 'provider_reset_required', 'ambiguous', 'provider_reset_terminal');
--> statement-breakpoint

ALTER TABLE "google_connections"
  ADD COLUMN "credential_use_state" "google_credential_use_state" DEFAULT 'active' NOT NULL,
  ADD COLUMN "cleanup_material_deadline_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "policy_version"
  ADD COLUMN "emergency_kill_version" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint

CREATE TABLE "capability_compliance_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "binding_version" integer DEFAULT 1 NOT NULL,
  "capability" "google_content_capability" NOT NULL,
  "target_phase" "google_content_approval_target_phase" NOT NULL,
  "environment_profile" "google_content_environment_profile" NOT NULL,
  "release_sha" varchar(128) NOT NULL,
  "evidence_manifest_sha256" varchar(128) NOT NULL,
  "evidence_index_sha256" varchar(128) NOT NULL,
  "deployment_attestation_sha256" varchar(128) NOT NULL,
  "adr_0050_sha256" varchar(128) NOT NULL,
  "google_content_policy_version" varchar(100) NOT NULL,
  "google_oauth_contract_version" varchar(100) NOT NULL,
  "google_project_attestation_sha256" varchar(128) NOT NULL,
  "google_oauth_client_id_sha256" varchar(128) NOT NULL,
  "google_redirect_uri_sha256" varchar(128) NOT NULL,
  "provider_origin_profile_sha256" varchar(128) NOT NULL,
  "runtime_isolation_profile_version" varchar(100) NOT NULL,
  "runtime_isolation_profile_sha256" varchar(128) NOT NULL,
  "performance_catalog_version" varchar(32) NOT NULL,
  "capability_policy_version" varchar(32) NOT NULL,
  "execution_policy_version" varchar(32) NOT NULL,
  "migration_head" varchar(255) NOT NULL,
  "evidence_index" jsonb NOT NULL,
  "image_digests" jsonb NOT NULL,
  "role_approvals" jsonb NOT NULL,
  "approved_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "status" "google_content_approval_status" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "capability_compliance_approvals_window_check"
    CHECK ("expires_at" > "approved_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_compliance_approvals_version_key"
  ON "capability_compliance_approvals" USING btree ("capability", "target_phase", "environment_profile", "binding_version");
--> statement-breakpoint
CREATE INDEX "capability_compliance_approvals_active_idx"
  ON "capability_compliance_approvals" USING btree ("capability", "status", "expires_at");
--> statement-breakpoint

CREATE TABLE "capability_execution_control" (
  "capability" "google_content_capability" PRIMARY KEY NOT NULL,
  "denied" boolean DEFAULT true NOT NULL,
  "emergency_kill_version" bigint DEFAULT 0 NOT NULL,
  "denied_at" timestamp with time zone,
  "drained_at" timestamp with time zone,
  "cleanup_drained_at" timestamp with time zone,
  "operator_id" varchar(255),
  "reason" varchar(500),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "capability_execution_control_denied_check"
    CHECK (("denied" AND "denied_at" IS NOT NULL) OR (NOT "denied" AND "denied_at" IS NULL AND "drained_at" IS NULL AND "cleanup_drained_at" IS NULL))
);
--> statement-breakpoint

CREATE TABLE "authorization_execution_permits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope_schema_version" integer DEFAULT 1 NOT NULL,
  "capability" "google_content_capability" NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid,
  "connection_id" uuid,
  "initiator_user_id" varchar(255),
  "operation_key" varchar(128) NOT NULL,
  "route_key" varchar(160) NOT NULL,
  "route_catalog_version" varchar(64) NOT NULL,
  "quota_policy_id" varchar(128) NOT NULL,
  "policy_version" bigint NOT NULL,
  "emergency_kill_version" bigint NOT NULL,
  "approval_binding_id" uuid NOT NULL,
  "permit_generation" bigint NOT NULL,
  "start_vector_mode" "authorization_commit_vector_mode" NOT NULL,
  "commit_vector_mode" "authorization_commit_vector_mode" NOT NULL,
  "authorization_vector" jsonb NOT NULL,
  "state" "authorization_execution_permit_state" NOT NULL,
  "admitted_at" timestamp with time zone NOT NULL,
  "start_deadline_at" timestamp with time zone NOT NULL,
  "started_at" timestamp with time zone,
  "operation_deadline_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "fenced_at" timestamp with time zone,
  "correlation_id" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "authorization_execution_permits_start_window_check"
    CHECK ("start_deadline_at" > "admitted_at"),
  CONSTRAINT "authorization_execution_permits_operation_window_check"
    CHECK ("operation_deadline_at" IS NULL OR ("started_at" IS NOT NULL AND "operation_deadline_at" > "started_at")),
  CONSTRAINT "authorization_execution_permits_state_check"
    CHECK (("state" = 'admitted' AND "started_at" IS NULL AND "operation_deadline_at" IS NULL AND "completed_at" IS NULL) OR ("state" = 'started' AND "started_at" IS NOT NULL AND "operation_deadline_at" IS NOT NULL AND "completed_at" IS NULL) OR ("state" = 'completed' AND "started_at" IS NOT NULL AND "operation_deadline_at" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("state" = 'fenced' AND "fenced_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "authorization_execution_permits"
  ADD CONSTRAINT "authorization_execution_permits_approval_binding_id_capability_compliance_approvals_id_fk"
  FOREIGN KEY ("approval_binding_id") REFERENCES "public"."capability_compliance_approvals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "authorization_execution_permits_active_idx"
  ON "authorization_execution_permits" USING btree ("capability", "state", "start_deadline_at", "operation_deadline_at");
--> statement-breakpoint
CREATE INDEX "authorization_execution_permits_scope_idx"
  ON "authorization_execution_permits" USING btree ("organization_id", "property_id", "connection_id");
--> statement-breakpoint

CREATE TABLE "google_subject_authority_guards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_client_hmac_key_version" varchar(50) NOT NULL,
  "project_client_hmac" varchar(128) NOT NULL,
  "subject_hmac_key_version" varchar(50) NOT NULL,
  "subject_hmac" varchar(128) NOT NULL,
  "generation" bigint DEFAULT 0 NOT NULL,
  "next_sequence" bigint DEFAULT 1 NOT NULL,
  "source_cutoff_sequence" bigint,
  "active_source_operation_id" uuid,
  "state" "google_subject_authority_guard_state" DEFAULT 'open' NOT NULL,
  "cleanup_deadline_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_subject_authority_guards_sequence_check"
    CHECK ("next_sequence" >= 1 AND ("source_cutoff_sequence" IS NULL OR "source_cutoff_sequence" < "next_sequence"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "google_subject_authority_guards_subject_key"
  ON "google_subject_authority_guards" USING btree ("project_client_hmac_key_version", "project_client_hmac", "subject_hmac_key_version", "subject_hmac");
--> statement-breakpoint
CREATE INDEX "google_subject_authority_guards_active_idx"
  ON "google_subject_authority_guards" USING btree ("state", "cleanup_deadline_at");
--> statement-breakpoint

CREATE TABLE "google_credential_source_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guard_id" uuid NOT NULL,
  "source_work_permit_id" uuid NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "connection_id" uuid,
  "sequence" bigint NOT NULL,
  "kind" "google_credential_source_kind" NOT NULL,
  "state" "google_credential_source_state" NOT NULL,
  "expected_lifecycle_version" bigint NOT NULL,
  "expected_access_version" bigint NOT NULL,
  "expected_credential_generation" bigint NOT NULL,
  "operation_deadline_at" timestamp with time zone NOT NULL,
  "provider_started_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "outcome_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_credential_source_operations_sequence_check"
    CHECK ("sequence" >= 1),
  CONSTRAINT "google_credential_source_operations_deadline_check"
    CHECK ("operation_deadline_at" > "created_at"),
  CONSTRAINT "google_credential_source_operations_state_check"
    CHECK (("state" = 'registered' AND "provider_started_at" IS NULL AND "terminal_at" IS NULL) OR ("state" IN ('provider_started', 'provider_outcome_ambiguous') AND "provider_started_at" IS NOT NULL AND "terminal_at" IS NULL) OR ("state" IN ('terminal', 'provider_reset_terminal') AND "terminal_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "google_credential_source_operations"
  ADD CONSTRAINT "google_credential_source_operations_guard_id_google_subject_authority_guards_id_fk"
  FOREIGN KEY ("guard_id") REFERENCES "public"."google_subject_authority_guards"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_credential_source_operations"
  ADD CONSTRAINT "google_credential_source_operations_source_work_permit_id_authorization_execution_permits_id_fk"
  FOREIGN KEY ("source_work_permit_id") REFERENCES "public"."authorization_execution_permits"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "google_credential_source_operations_guard_sequence_key"
  ON "google_credential_source_operations" USING btree ("guard_id", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_credential_source_operations_one_active_idx"
  ON "google_credential_source_operations" USING btree ("guard_id")
  WHERE "state" IN ('registered', 'provider_started', 'provider_outcome_ambiguous');
--> statement-breakpoint
CREATE INDEX "google_credential_source_operations_active_idx"
  ON "google_credential_source_operations" USING btree ("guard_id", "state", "operation_deadline_at");
--> statement-breakpoint

CREATE TABLE "credential_revoke_permits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "guard_id" uuid NOT NULL,
  "source_operation_id" uuid NOT NULL,
  "cleanup_work_permit_id" uuid,
  "state" "credential_revoke_permit_state" NOT NULL,
  "token_hmac_key_version" varchar(50),
  "token_hmac" varchar(128),
  "cleanup_deadline_at" timestamp with time zone NOT NULL,
  "send_authorization_expires_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "dispatching_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "outcome_code" varchar(100),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credential_revoke_permits_send_window_check"
    CHECK ("send_authorization_expires_at" IS NULL OR "send_authorization_expires_at" <= "cleanup_deadline_at"),
  CONSTRAINT "credential_revoke_permits_hmac_pair_check"
    CHECK (("token_hmac_key_version" IS NULL) = ("token_hmac" IS NULL)),
  CONSTRAINT "credential_revoke_permits_state_check"
    CHECK (("state" = 'dormant' AND "token_hmac" IS NULL AND "send_authorization_expires_at" IS NULL AND "dispatching_at" IS NULL AND "terminal_at" IS NULL) OR ("state" = 'active' AND "token_hmac" IS NOT NULL AND "send_authorization_expires_at" IS NOT NULL AND "activated_at" IS NOT NULL AND "dispatching_at" IS NULL AND "terminal_at" IS NULL) OR ("state" = 'dispatching' AND "token_hmac" IS NULL AND "send_authorization_expires_at" IS NULL AND "dispatching_at" IS NOT NULL AND "terminal_at" IS NULL) OR ("state" IN ('consumed_no_revoke', 'confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous', 'provider_reset_confirmed') AND "token_hmac" IS NULL AND "send_authorization_expires_at" IS NULL AND "terminal_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "credential_revoke_permits"
  ADD CONSTRAINT "credential_revoke_permits_guard_id_google_subject_authority_guards_id_fk"
  FOREIGN KEY ("guard_id") REFERENCES "public"."google_subject_authority_guards"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credential_revoke_permits"
  ADD CONSTRAINT "credential_revoke_permits_source_operation_id_google_credential_source_operations_id_fk"
  FOREIGN KEY ("source_operation_id") REFERENCES "public"."google_credential_source_operations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credential_revoke_permits"
  ADD CONSTRAINT "credential_revoke_permits_cleanup_work_permit_id_authorization_execution_permits_id_fk"
  FOREIGN KEY ("cleanup_work_permit_id") REFERENCES "public"."authorization_execution_permits"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "credential_revoke_permits_active_idx"
  ON "credential_revoke_permits" USING btree ("guard_id", "state", "cleanup_deadline_at");
--> statement-breakpoint

INSERT INTO "capability_execution_control" (
  "capability",
  "denied",
  "emergency_kill_version",
  "denied_at",
  "reason"
) VALUES
  ('property.import_gbp_v2', true, 1, now(), 'migration_default_deny'),
  ('property.read_gbp_performance', true, 1, now(), 'migration_default_deny')
ON CONFLICT ("capability") DO NOTHING;
--> statement-breakpoint
INSERT INTO "policy_version" ("scope", "version", "emergency_kill_version", "updated_at")
VALUES ('global', 0, 1, now())
ON CONFLICT ("scope") DO UPDATE
SET "emergency_kill_version" = GREATEST("policy_version"."emergency_kill_version", EXCLUDED."emergency_kill_version"),
    "updated_at" = now();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_capability_compliance_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'capability compliance approvals are append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER capability_compliance_approvals_append_only
BEFORE UPDATE OR DELETE ON capability_compliance_approvals
FOR EACH ROW
EXECUTE FUNCTION reject_capability_compliance_approval_mutation();
