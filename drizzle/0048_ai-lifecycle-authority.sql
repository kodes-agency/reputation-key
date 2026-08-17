CREATE TABLE "ai_canary_authorization_heads" (
	"release_sha" varchar(40) NOT NULL,
	"canary_profile_version" varchar(100) NOT NULL,
	"head_id" uuid NOT NULL,
	"transition_generation" integer NOT NULL,
	"next_authorization_generation" integer NOT NULL,
	"current_authorization_id" uuid,
	"current_operation_id" uuid,
	"current_permit_id" uuid,
	"state" varchar(30) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_canary_authorization_heads_pk" PRIMARY KEY("release_sha","canary_profile_version"),
	CONSTRAINT "ai_canary_authorization_heads_generation_valid" CHECK ("ai_canary_authorization_heads"."transition_generation" >= 1 AND "ai_canary_authorization_heads"."next_authorization_generation" BETWEEN 1 AND 4),
	CONSTRAINT "ai_canary_authorization_heads_release_valid" CHECK ("ai_canary_authorization_heads"."release_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "ai_canary_authorization_heads_state_valid" CHECK ((
        ("ai_canary_authorization_heads"."state" = 'eligible' AND "ai_canary_authorization_heads"."current_authorization_id" IS NULL AND "ai_canary_authorization_heads"."current_operation_id" IS NULL AND "ai_canary_authorization_heads"."current_permit_id" IS NULL)
        OR ("ai_canary_authorization_heads"."state" = 'issued' AND "ai_canary_authorization_heads"."current_authorization_id" IS NOT NULL AND "ai_canary_authorization_heads"."current_operation_id" IS NOT NULL AND "ai_canary_authorization_heads"."current_permit_id" IS NOT NULL)
        OR ("ai_canary_authorization_heads"."state" = 'in_flight' AND "ai_canary_authorization_heads"."current_authorization_id" IS NOT NULL AND "ai_canary_authorization_heads"."current_operation_id" IS NOT NULL AND "ai_canary_authorization_heads"."current_permit_id" IS NOT NULL)
        OR ("ai_canary_authorization_heads"."state" IN ('passed', 'terminal_failed') AND "ai_canary_authorization_heads"."current_authorization_id" IS NOT NULL AND "ai_canary_authorization_heads"."current_operation_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "ai_canary_authorizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"release_sha" varchar(40) NOT NULL,
	"canary_profile_version" varchar(100) NOT NULL,
	"authorization_generation" integer NOT NULL,
	"predecessor_authorization_id" uuid,
	"nonce" varchar(64) NOT NULL,
	"operator_user_id" varchar(255) NOT NULL,
	"state" varchar(30) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ai_canary_authorizations_release_valid" CHECK ("ai_canary_authorizations"."release_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "ai_canary_authorizations_generation_valid" CHECK ("ai_canary_authorizations"."authorization_generation" BETWEEN 1 AND 3 AND (("ai_canary_authorizations"."authorization_generation" = 1 AND "ai_canary_authorizations"."predecessor_authorization_id" IS NULL) OR ("ai_canary_authorizations"."authorization_generation" > 1 AND "ai_canary_authorizations"."predecessor_authorization_id" IS NOT NULL))),
	CONSTRAINT "ai_canary_authorizations_nonce_valid" CHECK ("ai_canary_authorizations"."nonce" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_canary_authorizations_operator_valid" CHECK ("ai_canary_authorizations"."operator_user_id" ~ '^[A-Za-z0-9][-A-Za-z0-9._@:/+]{0,254}$'),
	CONSTRAINT "ai_canary_authorizations_state_valid" CHECK ("ai_canary_authorizations"."state" IN ('issued', 'consumed', 'revoked', 'expired', 'released_no_dispatch', 'passed', 'terminal_failed')),
	CONSTRAINT "ai_canary_authorizations_time_valid" CHECK ("ai_canary_authorizations"."expires_at" > "ai_canary_authorizations"."issued_at" AND "ai_canary_authorizations"."expires_at" <= "ai_canary_authorizations"."issued_at" + interval '5 minutes' AND (("ai_canary_authorizations"."state" IN ('issued', 'consumed') AND "ai_canary_authorizations"."settled_at" IS NULL) OR ("ai_canary_authorizations"."state" NOT IN ('issued', 'consumed') AND "ai_canary_authorizations"."settled_at" IS NOT NULL AND "ai_canary_authorizations"."settled_at" >= "ai_canary_authorizations"."issued_at")))
);
--> statement-breakpoint
CREATE TABLE "ai_governance_policies" (
	"version" varchar(100) PRIMARY KEY NOT NULL,
	"region" varchar(20) NOT NULL,
	"manual_publication_required" boolean NOT NULL,
	"policy_digest" varchar(64) NOT NULL,
	"canonical_policy" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_governance_policies_version_valid" CHECK ("ai_governance_policies"."version" = 'ai-private-beta-policy-v1'),
	CONSTRAINT "ai_governance_policies_region_valid" CHECK ("ai_governance_policies"."region" = 'global'),
	CONSTRAINT "ai_governance_policies_manual_valid" CHECK ("ai_governance_policies"."manual_publication_required" = true),
	CONSTRAINT "ai_governance_policies_digest_valid" CHECK ("ai_governance_policies"."policy_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_governance_policies_document_valid" CHECK (jsonb_typeof("ai_governance_policies"."canonical_policy") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai_product_volume_consumptions" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"capability" varchar(40) NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"model_snapshot" varchar(100) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"total_tokens" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_product_volume_consumptions_valid" CHECK ("ai_product_volume_consumptions"."capability" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_product_volume_consumptions"."input_tokens" >= 0 AND "ai_product_volume_consumptions"."output_tokens" >= 0 AND "ai_product_volume_consumptions"."total_tokens" = "ai_product_volume_consumptions"."input_tokens" + "ai_product_volume_consumptions"."output_tokens")
);
--> statement-breakpoint
CREATE TABLE "ai_property_aggregate_heads" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"aggregate_revision" bigint NOT NULL,
	"terminal_analysis_sequence" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_aggregate_heads_pk" PRIMARY KEY("organization_id","property_id","source_epoch","review_analysis_epoch","property_profile_version"),
	CONSTRAINT "ai_property_aggregate_heads_versions_valid" CHECK ("ai_property_aggregate_heads"."source_epoch" >= 1 AND "ai_property_aggregate_heads"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_heads"."property_profile_version" >= 1 AND "ai_property_aggregate_heads"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_aggregate_heads"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "ai_read_barrier_heads" (
	"scope_kind" varchar(20) NOT NULL,
	"scope_id" varchar(255) NOT NULL,
	"domain_version" varchar(100) NOT NULL,
	"generation" integer NOT NULL,
	"state" varchar(20) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_read_barrier_heads_pk" PRIMARY KEY("scope_kind","scope_id"),
	CONSTRAINT "ai_read_barrier_heads_scope_valid" CHECK ("ai_read_barrier_heads"."scope_kind" IN ('organization', 'property', 'actor') AND length("ai_read_barrier_heads"."scope_id") BETWEEN 1 AND 255),
	CONSTRAINT "ai_read_barrier_heads_domain_valid" CHECK ("ai_read_barrier_heads"."domain_version" = 'ai-read-barrier-v1'),
	CONSTRAINT "ai_read_barrier_heads_generation_valid" CHECK ("ai_read_barrier_heads"."generation" >= 1),
	CONSTRAINT "ai_read_barrier_heads_state_valid" CHECK ("ai_read_barrier_heads"."state" IN ('open', 'closing')),
	CONSTRAINT "ai_read_barrier_heads_time_valid" CHECK ("ai_read_barrier_heads"."updated_at" >= "ai_read_barrier_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "ai_review_analysis_outcomes" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"event_envelope_id" uuid NOT NULL,
	"operation_id" uuid,
	"state" varchar(30) NOT NULL,
	"disposition_code" varchar(64),
	"applied_aggregate_revision" bigint,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_review_analysis_outcomes_pk" PRIMARY KEY("organization_id","property_id","source_epoch","review_analysis_epoch","analysis_sequence"),
	CONSTRAINT "ai_review_analysis_outcomes_sequence_valid" CHECK ("ai_review_analysis_outcomes"."analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_review_analysis_outcomes_state_valid" CHECK ((
        (
          "ai_review_analysis_outcomes"."state" = 'pending'
          AND "ai_review_analysis_outcomes"."disposition_code" IS NULL
          AND "ai_review_analysis_outcomes"."applied_aggregate_revision" IS NULL
          AND "ai_review_analysis_outcomes"."applied_at" IS NULL
        )
        OR (
          "ai_review_analysis_outcomes"."state" = 'ready'
          AND "ai_review_analysis_outcomes"."operation_id" IS NOT NULL
          AND "ai_review_analysis_outcomes"."disposition_code" IS NULL
          AND (
            (
              "ai_review_analysis_outcomes"."applied_aggregate_revision" IS NULL
              AND "ai_review_analysis_outcomes"."applied_at" IS NULL
            )
            OR (
              "ai_review_analysis_outcomes"."applied_aggregate_revision"
                BETWEEN 1 AND '9007199254740991'::bigint
              AND "ai_review_analysis_outcomes"."applied_at" IS NOT NULL
            )
          )
        )
        OR (
          "ai_review_analysis_outcomes"."state" = 'terminal_no_result'
          AND "ai_review_analysis_outcomes"."disposition_code" IN (
            'source_expired', 'provider_deleted', 'policy_disabled',
            'language_not_supported'
          )
          AND (
            (
              "ai_review_analysis_outcomes"."applied_aggregate_revision" IS NULL
              AND "ai_review_analysis_outcomes"."applied_at" IS NULL
            )
            OR (
              "ai_review_analysis_outcomes"."applied_aggregate_revision"
                BETWEEN 1 AND '9007199254740991'::bigint
              AND "ai_review_analysis_outcomes"."applied_at" IS NOT NULL
            )
          )
        )
      )),
	CONSTRAINT "ai_review_analysis_outcomes_time_valid" CHECK ("ai_review_analysis_outcomes"."updated_at" >= "ai_review_analysis_outcomes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "ai_review_event_cursors" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"analysis_start_sequence" bigint NOT NULL,
	"consumed_sequence" bigint NOT NULL,
	"terminal_analysis_sequence" bigint NOT NULL,
	"aggregate_revision" bigint NOT NULL,
	"last_consumed_event_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_review_event_cursors_pk" PRIMARY KEY("organization_id","property_id","source_epoch","review_analysis_epoch"),
	CONSTRAINT "ai_review_event_cursors_sequences_valid" CHECK ("ai_review_event_cursors"."source_epoch" >= 1 AND "ai_review_event_cursors"."review_analysis_epoch" >= 1
        AND "ai_review_event_cursors"."analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_event_cursors"."consumed_sequence" BETWEEN "ai_review_event_cursors"."analysis_start_sequence" AND '9007199254740991'::bigint
        AND "ai_review_event_cursors"."terminal_analysis_sequence" BETWEEN "ai_review_event_cursors"."analysis_start_sequence" AND "ai_review_event_cursors"."consumed_sequence"
        AND "ai_review_event_cursors"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_review_event_cursors_time_valid" CHECK ("ai_review_event_cursors"."updated_at" >= "ai_review_event_cursors"."created_at")
);
--> statement-breakpoint
ALTER TABLE "ai_control_heads" RENAME TO "ai_execution_control_heads";--> statement-breakpoint
ALTER TABLE "ai_control_history" RENAME TO "ai_execution_control_transitions";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_catalogues" RENAME TO "ai_property_calendar_authorities";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" RENAME COLUMN "state" TO "execution_state";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" RENAME COLUMN "state" TO "execution_state";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" DROP CONSTRAINT "ai_control_heads_generation_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" DROP CONSTRAINT "ai_control_heads_scope_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" DROP CONSTRAINT "ai_control_heads_state_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DROP CONSTRAINT "ai_control_history_generation_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DROP CONSTRAINT "ai_control_history_scope_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DROP CONSTRAINT "ai_control_history_state_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DROP CONSTRAINT "ai_control_history_reason_valid";--> statement-breakpoint
ALTER TABLE "ai_operation_attempts" DROP CONSTRAINT "ai_operation_attempts_terminal_valid";--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" DROP CONSTRAINT "ai_property_aggregate_contributions_derivative_valid";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" DROP CONSTRAINT "ai_property_calendar_profile_valid";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" DROP CONSTRAINT "ai_property_calendar_function_valid";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" DROP CONSTRAINT "ai_property_calendar_digests_valid";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" DROP CONSTRAINT "ai_property_calendar_range_valid";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" DROP CONSTRAINT "ai_control_heads_history_fk";
--> statement-breakpoint
ALTER TABLE "ai_execution_permits" DROP CONSTRAINT "ai_execution_permits_global_control_fk";
--> statement-breakpoint
ALTER TABLE "ai_execution_permits" DROP CONSTRAINT "ai_execution_permits_provider_control_fk";
--> statement-breakpoint
ALTER TABLE "ai_execution_permits" DROP CONSTRAINT "ai_execution_permits_capability_control_fk";
--> statement-breakpoint
ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_global_control_fk";
--> statement-breakpoint
ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_provider_control_fk";
--> statement-breakpoint
ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_capability_control_fk";
--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" DROP CONSTRAINT "ai_property_aggregate_contributions_calendar_profile_version_ai_property_calendar_catalogues_profile_version_fk";
--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP CONSTRAINT "ai_property_daily_aggregates_calendar_profile_version_ai_property_calendar_catalogues_profile_version_fk";
--> statement-breakpoint
DROP INDEX "ai_control_heads_control_unique";--> statement-breakpoint
DROP INDEX "ai_control_history_scope_generation_unique";--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DROP CONSTRAINT "ai_control_history_pk";--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ALTER COLUMN "sentiment" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ALTER COLUMN "primary_category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ALTER COLUMN "attention" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_pk" PRIMARY KEY("control_id","generation");--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD COLUMN "admission_state" varchar(20);--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD COLUMN "predecessor_generation" integer;--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD COLUMN "admission_state" varchar(20);--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD COLUMN "ticket_reference" varchar(255);--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD COLUMN "candidate_release_sha" varchar(40);--> statement-breakpoint
UPDATE "ai_execution_control_heads"
SET
  "admission_state" = CASE
    WHEN "scope_kind" = 'capability' OR "execution_state" <> 'running' THEN 'draining'
    ELSE 'accepting'
  END,
  "execution_state" = CASE
    WHEN "scope_kind" = 'capability' OR "execution_state" = 'killed' THEN 'killed'
    ELSE 'enabled'
  END;--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" DISABLE TRIGGER "ai_control_history_immutable";--> statement-breakpoint
UPDATE "ai_execution_control_transitions"
SET
  "predecessor_generation" = CASE WHEN "generation" = 1 THEN NULL ELSE "generation" - 1 END,
  "admission_state" = CASE
    WHEN "scope_kind" = 'capability' OR "execution_state" <> 'running' THEN 'draining'
    ELSE 'accepting'
  END,
  "execution_state" = CASE
    WHEN "scope_kind" = 'capability' OR "execution_state" = 'killed' THEN 'killed'
    ELSE 'enabled'
  END,
  "ticket_reference" = 'migration-0048';--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ENABLE TRIGGER "ai_control_history_immutable";--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ALTER COLUMN "admission_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ALTER COLUMN "admission_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ALTER COLUMN "ticket_reference" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_operation_attempts" ADD COLUMN "model_snapshot" varchar(100);--> statement-breakpoint
ALTER TABLE "ai_operation_attempts" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_operation_attempts" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD COLUMN "status" varchar(20);--> statement-breakpoint
UPDATE "ai_property_aggregate_contributions" SET "status" = 'ready';--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_canary_authorization_heads" ADD CONSTRAINT "ai_canary_authorization_heads_current_authorization_id_ai_canary_authorizations_id_fk" FOREIGN KEY ("current_authorization_id") REFERENCES "public"."ai_canary_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_canary_authorization_heads" ADD CONSTRAINT "ai_canary_authorization_heads_current_operation_id_ai_operations_id_fk" FOREIGN KEY ("current_operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_canary_authorization_heads" ADD CONSTRAINT "ai_canary_authorization_heads_current_permit_id_ai_execution_permits_id_fk" FOREIGN KEY ("current_permit_id") REFERENCES "public"."ai_execution_permits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_canary_authorizations" ADD CONSTRAINT "ai_canary_authorizations_predecessor_authorization_id_ai_canary_authorizations_id_fk" FOREIGN KEY ("predecessor_authorization_id") REFERENCES "public"."ai_canary_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_product_volume_consumptions" ADD CONSTRAINT "ai_product_volume_consumptions_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_product_volume_consumptions" ADD CONSTRAINT "ai_product_volume_consumptions_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_heads" ADD CONSTRAINT "ai_property_aggregate_heads_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_outcomes" ADD CONSTRAINT "ai_review_analysis_outcomes_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_analysis_outcomes" ADD CONSTRAINT "ai_review_analysis_outcomes_cursor_fk" FOREIGN KEY ("organization_id","property_id","source_epoch","review_analysis_epoch") REFERENCES "public"."ai_review_event_cursors"("organization_id","property_id","source_epoch","review_analysis_epoch") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_review_event_cursors" ADD CONSTRAINT "ai_review_event_cursors_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_canary_authorization_heads_id_unique" ON "ai_canary_authorization_heads" USING btree ("head_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_canary_authorizations_generation_unique" ON "ai_canary_authorizations" USING btree ("release_sha","canary_profile_version","authorization_generation");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_canary_authorizations_active_unique" ON "ai_canary_authorizations" USING btree ("release_sha","canary_profile_version") WHERE "ai_canary_authorizations"."state" IN ('issued', 'consumed');--> statement-breakpoint
CREATE INDEX "ai_product_volume_consumptions_org_time_idx" ON "ai_product_volume_consumptions" USING btree ("organization_id","completed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_property_aggregate_heads_current_idx" ON "ai_property_aggregate_heads" USING btree ("organization_id","property_id","source_epoch","review_analysis_epoch","property_profile_version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_outcomes_event_unique" ON "ai_review_analysis_outcomes" USING btree ("event_envelope_id");--> statement-breakpoint
CREATE INDEX "ai_review_analysis_outcomes_terminal_idx" ON "ai_review_analysis_outcomes" USING btree ("organization_id","property_id","source_epoch","review_analysis_epoch","analysis_sequence","state");--> statement-breakpoint
CREATE INDEX "ai_review_event_cursors_property_idx" ON "ai_review_event_cursors" USING btree ("organization_id","property_id");--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD CONSTRAINT "ai_execution_control_heads_transition_fk" FOREIGN KEY ("control_id","generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_global_control_fk" FOREIGN KEY ("global_control_id","global_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_provider_control_fk" FOREIGN KEY ("provider_control_id","provider_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_capability_control_fk" FOREIGN KEY ("capability_control_id","capability_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_canary_authorization_id_ai_canary_authorizations_id_fk" FOREIGN KEY ("canary_authorization_id") REFERENCES "public"."ai_canary_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_global_control_fk" FOREIGN KEY ("global_control_id","global_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_provider_control_fk" FOREIGN KEY ("provider_control_id","provider_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_capability_control_fk" FOREIGN KEY ("capability_control_id","capability_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_calendar_profile_version_ai_property_calendar_authorities_profile_version_fk" FOREIGN KEY ("calendar_profile_version") REFERENCES "public"."ai_property_calendar_authorities"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_calendar_profile_version_ai_property_calendar_authorities_profile_version_fk" FOREIGN KEY ("calendar_profile_version") REFERENCES "public"."ai_property_calendar_authorities"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_control_heads_control_unique" ON "ai_execution_control_heads" USING btree ("control_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_control_transitions_scope_generation_unique" ON "ai_execution_control_transitions" USING btree ("scope_key","generation");--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD CONSTRAINT "ai_execution_control_heads_generation_valid" CHECK ("ai_execution_control_heads"."generation" >= 1);--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD CONSTRAINT "ai_execution_control_heads_scope_valid" CHECK ((
        ("ai_execution_control_heads"."scope_kind" = 'global' AND "ai_execution_control_heads"."scope_key" = 'global' AND "ai_execution_control_heads"."scope_value" IS NULL)
        OR ("ai_execution_control_heads"."scope_kind" = 'provider_deployment_profile' AND "ai_execution_control_heads"."scope_value" ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND "ai_execution_control_heads"."scope_key" = 'provider:' || "ai_execution_control_heads"."scope_value")
        OR ("ai_execution_control_heads"."scope_kind" = 'capability' AND "ai_execution_control_heads"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_execution_control_heads"."scope_key" = 'capability:' || "ai_execution_control_heads"."scope_value")
      ));--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD CONSTRAINT "ai_execution_control_heads_state_valid" CHECK ("ai_execution_control_heads"."execution_state" IN ('enabled', 'killed') AND "ai_execution_control_heads"."admission_state" IN ('accepting', 'draining'));--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_generation_valid" CHECK ("ai_execution_control_transitions"."generation" >= 1 AND (("ai_execution_control_transitions"."generation" = 1 AND "ai_execution_control_transitions"."predecessor_generation" IS NULL) OR ("ai_execution_control_transitions"."generation" > 1 AND "ai_execution_control_transitions"."predecessor_generation" = "ai_execution_control_transitions"."generation" - 1)));--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_scope_valid" CHECK ((
        ("ai_execution_control_transitions"."scope_kind" = 'global' AND "ai_execution_control_transitions"."scope_key" = 'global' AND "ai_execution_control_transitions"."scope_value" IS NULL)
        OR ("ai_execution_control_transitions"."scope_kind" = 'provider_deployment_profile' AND "ai_execution_control_transitions"."scope_value" ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND "ai_execution_control_transitions"."scope_key" = 'provider:' || "ai_execution_control_transitions"."scope_value")
        OR ("ai_execution_control_transitions"."scope_kind" = 'capability' AND "ai_execution_control_transitions"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_execution_control_transitions"."scope_key" = 'capability:' || "ai_execution_control_transitions"."scope_value")
      ));--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_state_valid" CHECK ("ai_execution_control_transitions"."execution_state" IN ('enabled', 'killed') AND "ai_execution_control_transitions"."admission_state" IN ('accepting', 'draining'));--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_reason_valid" CHECK ("ai_execution_control_transitions"."reason_code" ~ '^[a-z][a-z0-9_]{2,63}$' AND length("ai_execution_control_transitions"."ticket_reference") BETWEEN 1 AND 255);--> statement-breakpoint
ALTER TABLE "ai_execution_control_transitions" ADD CONSTRAINT "ai_execution_control_transitions_release_valid" CHECK ("ai_execution_control_transitions"."candidate_release_sha" IS NULL OR "ai_execution_control_transitions"."candidate_release_sha" ~ '^[0-9a-f]{40}$');--> statement-breakpoint
ALTER TABLE "ai_operation_attempts" ADD CONSTRAINT "ai_operation_attempts_terminal_valid" CHECK ((
        ("ai_operation_attempts"."state" = 'executing' AND "ai_operation_attempts"."settled_at" IS NULL AND "ai_operation_attempts"."failure_code" IS NULL AND "ai_operation_attempts"."model_snapshot" IS NULL AND "ai_operation_attempts"."input_tokens" IS NULL AND "ai_operation_attempts"."output_tokens" IS NULL)
        OR ("ai_operation_attempts"."state" = 'completed' AND "ai_operation_attempts"."settled_at" IS NOT NULL AND "ai_operation_attempts"."failure_code" IS NULL AND "ai_operation_attempts"."model_snapshot" IS NOT NULL AND "ai_operation_attempts"."input_tokens" >= 0 AND "ai_operation_attempts"."output_tokens" >= 0)
        OR ("ai_operation_attempts"."state" IN ('failed', 'cancelled') AND "ai_operation_attempts"."settled_at" IS NOT NULL AND "ai_operation_attempts"."model_snapshot" IS NULL AND "ai_operation_attempts"."input_tokens" IS NULL AND "ai_operation_attempts"."output_tokens" IS NULL)
      ) AND ("ai_operation_attempts"."settled_at" IS NULL OR "ai_operation_attempts"."settled_at" >= "ai_operation_attempts"."started_at"));--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_result_valid" CHECK ((
        ("ai_property_aggregate_contributions"."status" = 'ready' AND "ai_property_aggregate_contributions"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_property_aggregate_contributions"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND "ai_property_aggregate_contributions"."attention" IN ('urgent', 'high', 'medium', 'low'))
        OR ("ai_property_aggregate_contributions"."status" = 'unavailable' AND "ai_property_aggregate_contributions"."sentiment" IS NULL AND "ai_property_aggregate_contributions"."primary_category" IS NULL AND "ai_property_aggregate_contributions"."attention" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" ADD CONSTRAINT "ai_property_calendar_authorities_profile_valid" CHECK ("ai_property_calendar_authorities"."profile_version" = 'property-calendar-v1');--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" ADD CONSTRAINT "ai_property_calendar_authorities_function_valid" CHECK ("ai_property_calendar_authorities"."epoch_millis_function_name" = 'ai_epoch_millis_v1' AND "ai_property_calendar_authorities"."local_date_function_name" = 'ai_property_local_date_v1' AND "ai_property_calendar_authorities"."local_midnight_function_name" = 'ai_property_local_midnight_v1');--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" ADD CONSTRAINT "ai_property_calendar_authorities_digests_valid" CHECK ("ai_property_calendar_authorities"."epoch_millis_function_digest" = '9367a74304ab003cf57e2aa988883d72b4b9782a9cc9e7e639033c4b1604fa35' AND "ai_property_calendar_authorities"."local_date_function_digest" = '6521dba5d8bc579bf55f8bf47d5db5c642032795949af54cb370189cac0d61a0' AND "ai_property_calendar_authorities"."local_midnight_function_digest" = 'ab121d8706ff847aea69b565d9571b3561e8289f0a417b8a35f13abb20edcbe1' AND "ai_property_calendar_authorities"."image_digest" = '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20' AND "ai_property_calendar_authorities"."vector_digest" = '0108713532775ad86be18c94c69eed42c9f2dfd24766608ff3592d87e7739545');--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" ADD CONSTRAINT "ai_property_calendar_authorities_range_valid" CHECK ("ai_property_calendar_authorities"."vector_count" = 10 AND "ai_property_calendar_authorities"."minimum_year" = 1970 AND "ai_property_calendar_authorities"."maximum_year" = 2100 AND "ai_property_calendar_authorities"."tested_postgres_major_versions" = ARRAY[16]::integer[] AND jsonb_typeof("ai_property_calendar_authorities"."test_vectors") = 'array' AND jsonb_array_length("ai_property_calendar_authorities"."test_vectors") = "ai_property_calendar_authorities"."vector_count");
--> statement-breakpoint
CREATE TRIGGER "ai_governance_policies_immutable"
BEFORE UPDATE OR DELETE ON "ai_governance_policies"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_governance_policies_no_truncate"
BEFORE TRUNCATE ON "ai_governance_policies"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_ai_read_barrier_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI read barrier heads cannot be deleted or truncated';
  END IF;
  IF NEW.scope_kind <> OLD.scope_kind
    OR NEW.scope_id <> OLD.scope_id
    OR NEW.domain_version <> OLD.domain_version
    OR NEW.created_at <> OLD.created_at
    OR OLD.state <> 'open'
    OR NEW.state <> 'closing'
    OR NEW.generation <> OLD.generation + 1
    OR NEW.updated_at < OLD.updated_at
  THEN
    RAISE EXCEPTION 'Invalid AI read barrier transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_read_barrier_heads_transition_guard"
BEFORE UPDATE OR DELETE ON "ai_read_barrier_heads"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_read_barrier_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_read_barrier_heads_no_truncate"
BEFORE TRUNCATE ON "ai_read_barrier_heads"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_read_barrier_mutation_v1"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "acquire_ai_read_delivery_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_actor_user_id text
)
RETURNS TABLE (
  organization_generation integer,
  property_generation integer,
  actor_generation integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
  v_organization_state text;
  v_property_state text;
  v_actor_state text;
BEGIN
  IF p_organization_id IS NULL OR length(p_organization_id) NOT BETWEEN 1 AND 255
    OR p_property_id IS NULL
    OR p_actor_user_id IS NULL OR length(p_actor_user_id) NOT BETWEEN 1 AND 255
  THEN
    RAISE EXCEPTION 'Invalid AI read delivery scope'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    'organization', p_organization_id, 'ai-read-barrier-v1', 1, 'open', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;
  SELECT generation, state
  INTO organization_generation, v_organization_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = 'organization' AND scope_id = p_organization_id
  FOR SHARE;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    'property', p_property_id::text, 'ai-read-barrier-v1', 1, 'open', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;
  SELECT generation, state
  INTO property_generation, v_property_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = 'property' AND scope_id = p_property_id::text
  FOR SHARE;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    'actor', p_actor_user_id, 'ai-read-barrier-v1', 1, 'open', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;
  SELECT generation, state
  INTO actor_generation, v_actor_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = 'actor' AND scope_id = p_actor_user_id
  FOR SHARE;

  IF v_organization_state <> 'open'
    OR v_property_state <> 'open'
    OR v_actor_state <> 'open'
  THEN
    RETURN;
  END IF;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_ai_read_delivery_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_actor_user_id text,
  p_organization_generation integer,
  p_property_generation integer,
  p_actor_generation integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.ai_read_barrier_heads
      WHERE scope_kind = 'organization'
        AND scope_id = p_organization_id
        AND generation = p_organization_generation
        AND state = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM public.ai_read_barrier_heads
      WHERE scope_kind = 'property'
        AND scope_id = p_property_id::text
        AND generation = p_property_generation
        AND state = 'open'
    )
    AND EXISTS (
      SELECT 1 FROM public.ai_read_barrier_heads
      WHERE scope_kind = 'actor'
        AND scope_id = p_actor_user_id
        AND generation = p_actor_generation
        AND state = 'open'
    );
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "close_ai_read_barrier_v1"(
  p_scope_kind text,
  p_scope_id text,
  p_expected_generation integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_generation integer;
  v_state text;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_scope_kind NOT IN ('organization', 'property', 'actor')
    OR p_scope_id IS NULL OR length(p_scope_id) NOT BETWEEN 1 AND 255
    OR p_expected_generation < 0
  THEN
    RAISE EXCEPTION 'Invalid AI read barrier close scope'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_read_barrier_heads (
    scope_kind, scope_id, domain_version, generation, state, created_at, updated_at
  ) VALUES (
    p_scope_kind, p_scope_id, 'ai-read-barrier-v1', 1, 'closing', v_now, v_now
  ) ON CONFLICT (scope_kind, scope_id) DO NOTHING;

  SELECT generation, state
  INTO v_generation, v_state
  FROM public.ai_read_barrier_heads
  WHERE scope_kind = p_scope_kind AND scope_id = p_scope_id
  FOR UPDATE;

  IF v_state = 'closing' THEN
    IF p_expected_generation NOT IN (0, v_generation) THEN
      RAISE EXCEPTION 'AI read barrier generation conflict'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_generation;
  END IF;
  IF p_expected_generation <> v_generation THEN
    RAISE EXCEPTION 'AI read barrier generation conflict'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.ai_read_barrier_heads
  SET generation = v_generation + 1, state = 'closing', updated_at = v_now
  WHERE scope_kind = p_scope_kind AND scope_id = p_scope_id;
  RETURN v_generation + 1;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "acquire_ai_read_delivery_v1"(text, uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_read_delivery_v1"(text, uuid, text, integer, integer, integer) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "close_ai_read_barrier_v1"(text, text, integer) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "consume_ai_review_event_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_source_epoch integer,
  p_review_analysis_epoch integer,
  p_analysis_start_sequence bigint,
  p_analysis_sequence bigint,
  p_event_envelope_id uuid,
  p_disposition text
)
RETURNS TABLE (
  status text,
  consumed_sequence bigint,
  terminal_analysis_sequence bigint,
  expected_sequence bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cursor public.ai_review_event_cursors%ROWTYPE;
  v_outcome public.ai_review_analysis_outcomes%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
  v_terminal bigint;
  v_next_state text;
BEGIN
  IF p_organization_id IS NULL OR length(p_organization_id) NOT BETWEEN 1 AND 255
    OR p_property_id IS NULL
    OR p_source_epoch < 1
    OR p_review_analysis_epoch < 1
    OR p_analysis_start_sequence NOT BETWEEN 0 AND 9007199254740991
    OR p_analysis_sequence NOT BETWEEN 1 AND 9007199254740991
    OR p_event_envelope_id IS NULL
    OR p_disposition NOT IN ('pending', 'source_expired', 'provider_deleted', 'policy_disabled')
  THEN
    RAISE EXCEPTION 'Invalid AI review event'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id || ':' || p_property_id::text, 0)
  );
  INSERT INTO public.ai_review_event_cursors (
    organization_id, property_id, source_epoch, review_analysis_epoch,
    analysis_start_sequence, consumed_sequence, terminal_analysis_sequence,
    aggregate_revision, last_consumed_event_id, created_at, updated_at
  ) VALUES (
    p_organization_id, p_property_id, p_source_epoch, p_review_analysis_epoch,
    p_analysis_start_sequence, p_analysis_start_sequence, p_analysis_start_sequence,
    0, NULL, v_now, v_now
  ) ON CONFLICT (
    organization_id, property_id, source_epoch, review_analysis_epoch
  ) DO NOTHING;

  SELECT *
  INTO v_cursor
  FROM public.ai_review_event_cursors
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
  FOR UPDATE;

  IF NOT FOUND OR v_cursor.analysis_start_sequence <> p_analysis_start_sequence THEN
    RETURN;
  END IF;

  IF p_analysis_sequence <= v_cursor.consumed_sequence THEN
    SELECT *
    INTO v_outcome
    FROM public.ai_review_analysis_outcomes
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch
      AND analysis_sequence = p_analysis_sequence;
    IF FOUND
      AND v_outcome.event_envelope_id = p_event_envelope_id
      AND (
        (p_disposition = 'pending' AND v_outcome.state = 'pending' AND v_outcome.disposition_code IS NULL)
        OR (
          p_disposition <> 'pending'
          AND v_outcome.state = 'terminal_no_result'
          AND v_outcome.disposition_code = p_disposition
        )
      )
    THEN
      status := 'duplicate';
      consumed_sequence := v_cursor.consumed_sequence;
      terminal_analysis_sequence := v_cursor.terminal_analysis_sequence;
      expected_sequence := NULL;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF p_analysis_sequence <> v_cursor.consumed_sequence + 1 THEN
    status := 'gap';
    consumed_sequence := NULL;
    terminal_analysis_sequence := NULL;
    expected_sequence := v_cursor.consumed_sequence + 1;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.ai_review_analysis_outcomes (
    organization_id, property_id, source_epoch, review_analysis_epoch,
    analysis_sequence, event_envelope_id, operation_id, state,
    disposition_code, created_at, updated_at
  ) VALUES (
    p_organization_id, p_property_id, p_source_epoch, p_review_analysis_epoch,
    p_analysis_sequence, p_event_envelope_id, NULL,
    CASE WHEN p_disposition = 'pending' THEN 'pending' ELSE 'terminal_no_result' END,
    CASE WHEN p_disposition = 'pending' THEN NULL ELSE p_disposition END,
    v_now, v_now
  );

  v_terminal := v_cursor.terminal_analysis_sequence;
  IF p_disposition <> 'pending' AND p_analysis_sequence = v_terminal + 1 THEN
    v_terminal := p_analysis_sequence;
  END IF;
  UPDATE public.ai_review_event_cursors
  SET
    consumed_sequence = p_analysis_sequence,
    terminal_analysis_sequence = v_terminal,
    last_consumed_event_id = p_event_envelope_id,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch;

  status := 'accepted';
  consumed_sequence := p_analysis_sequence;
  terminal_analysis_sequence := v_terminal;
  expected_sequence := NULL;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "settle_ai_review_analysis_outcome_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_source_epoch integer,
  p_review_analysis_epoch integer,
  p_analysis_sequence bigint,
  p_state text,
  p_operation_id uuid,
  p_disposition_code text
)
RETURNS TABLE (
  terminal_analysis_sequence bigint,
  aggregate_revision bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cursor public.ai_review_event_cursors%ROWTYPE;
  v_outcome public.ai_review_analysis_outcomes%ROWTYPE;
  v_terminal bigint;
  v_next_state text;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_state NOT IN ('ready', 'terminal_no_result')
    OR (p_state = 'ready' AND (p_operation_id IS NULL OR p_disposition_code IS NOT NULL))
    OR (
      p_state = 'terminal_no_result'
      AND p_disposition_code NOT IN (
        'language_not_supported', 'source_expired', 'provider_deleted', 'policy_disabled'
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid AI review analysis outcome'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id || ':' || p_property_id::text, 0)
  );
  SELECT *
  INTO v_cursor
  FROM public.ai_review_event_cursors
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT *
  INTO v_outcome
  FROM public.ai_review_analysis_outcomes
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
    AND analysis_sequence = p_analysis_sequence
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_outcome.state = 'pending' THEN
    UPDATE public.ai_review_analysis_outcomes
    SET
      state = p_state,
      operation_id = p_operation_id,
      disposition_code = p_disposition_code,
      updated_at = v_now
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch
      AND analysis_sequence = p_analysis_sequence;
  ELSIF v_outcome.state <> p_state
    OR v_outcome.operation_id IS DISTINCT FROM p_operation_id
    OR v_outcome.disposition_code IS DISTINCT FROM p_disposition_code
  THEN
    RETURN;
  END IF;

  v_terminal := v_cursor.terminal_analysis_sequence;
  LOOP
    SELECT state
    INTO v_next_state
    FROM public.ai_review_analysis_outcomes
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch
      AND analysis_sequence = v_terminal + 1;
    EXIT WHEN NOT FOUND OR v_next_state = 'pending';
    v_terminal := v_terminal + 1;
  END LOOP;

  IF v_terminal <> v_cursor.terminal_analysis_sequence THEN
    UPDATE public.ai_review_event_cursors
    SET terminal_analysis_sequence = v_terminal, updated_at = v_now
    WHERE organization_id = p_organization_id
      AND property_id = p_property_id
      AND source_epoch = p_source_epoch
      AND review_analysis_epoch = p_review_analysis_epoch;
  END IF;

  terminal_analysis_sequence := v_terminal;
  aggregate_revision := v_cursor.aggregate_revision;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "advance_ai_aggregate_revision_v1"(
  p_organization_id text,
  p_property_id uuid,
  p_source_epoch integer,
  p_review_analysis_epoch integer,
  p_analysis_sequence bigint,
  p_expected_aggregate_revision bigint
)
RETURNS TABLE (
  aggregate_revision bigint,
  applied_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_cursor public.ai_review_event_cursors%ROWTYPE;
  v_outcome public.ai_review_analysis_outcomes%ROWTYPE;
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_organization_id || ':' || p_property_id::text, 0)
  );
  SELECT *
  INTO v_cursor
  FROM public.ai_review_event_cursors
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT *
  INTO v_outcome
  FROM public.ai_review_analysis_outcomes
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
    AND analysis_sequence = p_analysis_sequence
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_outcome.applied_aggregate_revision IS NOT NULL THEN
    aggregate_revision := v_outcome.applied_aggregate_revision;
    applied_at := v_outcome.applied_at;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_outcome.state NOT IN ('ready', 'terminal_no_result')
    OR p_analysis_sequence <= v_cursor.analysis_start_sequence
    OR p_analysis_sequence > v_cursor.terminal_analysis_sequence
    OR EXISTS (
      SELECT 1
      FROM public.ai_review_analysis_outcomes AS prior
      WHERE prior.organization_id = p_organization_id
        AND prior.property_id = p_property_id
        AND prior.source_epoch = p_source_epoch
        AND prior.review_analysis_epoch = p_review_analysis_epoch
        AND prior.analysis_sequence > v_cursor.analysis_start_sequence
        AND prior.analysis_sequence < p_analysis_sequence
        AND prior.applied_aggregate_revision IS NULL
    )
    OR v_cursor.aggregate_revision <> p_expected_aggregate_revision
    OR v_cursor.aggregate_revision >= 9007199254740991
  THEN
    RETURN;
  END IF;
  UPDATE public.ai_review_analysis_outcomes
  SET
    applied_aggregate_revision = v_cursor.aggregate_revision + 1,
    applied_at = v_now,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch
    AND analysis_sequence = p_analysis_sequence;
  UPDATE public.ai_review_event_cursors
  SET
    aggregate_revision = v_cursor.aggregate_revision + 1,
    updated_at = v_now
  WHERE organization_id = p_organization_id
    AND property_id = p_property_id
    AND source_epoch = p_source_epoch
    AND review_analysis_epoch = p_review_analysis_epoch;
  aggregate_revision := v_cursor.aggregate_revision + 1;
  applied_at := v_now;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "consume_ai_review_event_v1"(text, uuid, integer, integer, bigint, bigint, uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "settle_ai_review_analysis_outcome_v1"(text, uuid, integer, integer, bigint, text, uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "advance_ai_aggregate_revision_v1"(text, uuid, integer, integer, bigint, bigint) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_ai_execution_control_head_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI execution control heads cannot be deleted';
  END IF;
  IF NEW.scope_key <> OLD.scope_key
    OR NEW.scope_kind <> OLD.scope_kind
    OR NEW.scope_value IS DISTINCT FROM OLD.scope_value
    OR NEW.control_id <> OLD.control_id
    OR NEW.generation <> OLD.generation + 1
    OR NEW.updated_at < OLD.updated_at
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_execution_control_transitions AS transition
      WHERE transition.control_id = NEW.control_id
        AND transition.generation = NEW.generation
        AND transition.predecessor_generation = OLD.generation
        AND transition.scope_key = NEW.scope_key
        AND transition.scope_kind = NEW.scope_kind
        AND transition.scope_value IS NOT DISTINCT FROM NEW.scope_value
        AND transition.execution_state = NEW.execution_state
        AND transition.admission_state = NEW.admission_state
        AND transition.occurred_at = NEW.updated_at
    )
  THEN
    RAISE EXCEPTION 'Invalid AI execution control head transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_execution_control_heads_transition_guard"
BEFORE UPDATE OR DELETE ON "ai_execution_control_heads"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_execution_control_head_mutation_v1"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "transition_ai_execution_control_v1"(
  p_scope_key text,
  p_provider_deployment_profile_version text,
  p_expected_control_id uuid,
  p_expected_generation integer,
  p_execution_state text,
  p_admission_state text,
  p_reason_code text,
  p_actor_user_id text,
  p_ticket_reference text,
  p_candidate_release_sha text
)
RETURNS TABLE (
  scope_key varchar,
  scope_kind varchar,
  scope_value varchar,
  control_id uuid,
  generation integer,
  execution_state varchar,
  admission_state varchar,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_global public.ai_execution_control_heads%ROWTYPE;
  v_provider public.ai_execution_control_heads%ROWTYPE;
  v_target public.ai_execution_control_heads%ROWTYPE;
  v_replay public.ai_execution_control_transitions%ROWTYPE;
  v_canary_state text;
  v_now timestamp with time zone := clock_timestamp();
  v_is_capability_activation boolean;
BEGIN
  IF p_expected_control_id IS NULL
    OR p_expected_generation < 1
    OR p_execution_state NOT IN ('enabled', 'killed')
    OR p_admission_state NOT IN ('accepting', 'draining')
    OR p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
    OR p_ticket_reference IS NULL OR length(p_ticket_reference) NOT BETWEEN 1 AND 255
    OR (
      p_candidate_release_sha IS NOT NULL
      AND p_candidate_release_sha !~ '^[0-9a-f]{40}$'
    )
  THEN
    RAISE EXCEPTION 'Invalid AI execution control transition'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_global
  FROM public.ai_execution_control_heads
  WHERE ai_execution_control_heads.scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_scope_key = 'global' THEN
    v_target := v_global;
  ELSE
    IF p_provider_deployment_profile_version IS NULL
      OR p_provider_deployment_profile_version !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    THEN
      RETURN;
    END IF;
    SELECT *
    INTO v_provider
    FROM public.ai_execution_control_heads
    WHERE ai_execution_control_heads.scope_key =
      'provider:' || p_provider_deployment_profile_version
    FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;

    IF p_scope_key = 'provider:' || p_provider_deployment_profile_version THEN
      v_target := v_provider;
    ELSIF p_scope_key IN (
      'capability:review_analysis',
      'capability:reply_drafting',
      'capability:property_trends'
    ) THEN
      SELECT *
      INTO v_target
      FROM public.ai_execution_control_heads
      WHERE ai_execution_control_heads.scope_key = p_scope_key
      FOR UPDATE;
      IF NOT FOUND THEN RETURN; END IF;
    ELSE
      RETURN;
    END IF;
  END IF;

  IF v_target.control_id = p_expected_control_id
    AND v_target.generation = p_expected_generation + 1
  THEN
    SELECT *
    INTO v_replay
    FROM public.ai_execution_control_transitions
    WHERE ai_execution_control_transitions.control_id = v_target.control_id
      AND ai_execution_control_transitions.generation = v_target.generation;
    IF FOUND
      AND v_replay.predecessor_generation = p_expected_generation
      AND v_replay.execution_state = p_execution_state
      AND v_replay.admission_state = p_admission_state
      AND v_replay.reason_code = p_reason_code
      AND v_replay.actor_user_id IS NOT DISTINCT FROM p_actor_user_id
      AND v_replay.ticket_reference = p_ticket_reference
      AND v_replay.candidate_release_sha IS NOT DISTINCT FROM p_candidate_release_sha
    THEN
      scope_key := v_target.scope_key;
      scope_kind := v_target.scope_kind;
      scope_value := v_target.scope_value;
      control_id := v_target.control_id;
      generation := v_target.generation;
      execution_state := v_target.execution_state;
      admission_state := v_target.admission_state;
      updated_at := v_target.updated_at;
      RETURN NEXT;
    END IF;
    RETURN;
  END IF;

  IF v_target.control_id <> p_expected_control_id
    OR v_target.generation <> p_expected_generation
  THEN
    RETURN;
  END IF;

  v_is_capability_activation :=
    v_target.scope_kind = 'capability'
    AND p_execution_state = 'enabled'
    AND p_admission_state = 'accepting';
  IF v_is_capability_activation THEN
    IF p_candidate_release_sha IS NULL
      OR v_global.execution_state <> 'enabled'
      OR v_global.admission_state <> 'accepting'
      OR v_provider.execution_state <> 'enabled'
      OR v_provider.admission_state <> 'accepting'
    THEN
      RETURN;
    END IF;
    SELECT authorization_head.state
    INTO v_canary_state
    FROM public.ai_canary_authorization_heads AS authorization_head
    WHERE authorization_head.release_sha = p_candidate_release_sha
      AND authorization_head.canary_profile_version = 'synthetic-canary-v1'
      AND EXISTS (
        SELECT 1
        FROM public.ai_operations AS canary_operation
        WHERE canary_operation.id = authorization_head.current_operation_id
          AND canary_operation.command = 'synthetic_canary'
          AND canary_operation.state = 'succeeded'
          AND canary_operation.provider_deployment_profile_version =
            p_provider_deployment_profile_version
      )
    FOR UPDATE;
    IF NOT FOUND OR v_canary_state <> 'passed' THEN RETURN; END IF;
  ELSIF p_candidate_release_sha IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_execution_control_transitions (
    control_id, generation, predecessor_generation,
    scope_key, scope_kind, scope_value,
    execution_state, admission_state, reason_code, actor_user_id,
    ticket_reference, candidate_release_sha, occurred_at
  ) VALUES (
    v_target.control_id, v_target.generation + 1, v_target.generation,
    v_target.scope_key, v_target.scope_kind, v_target.scope_value,
    p_execution_state, p_admission_state, p_reason_code, p_actor_user_id,
    p_ticket_reference, p_candidate_release_sha, v_now
  );
  UPDATE public.ai_execution_control_heads
  SET
    generation = v_target.generation + 1,
    execution_state = p_execution_state,
    admission_state = p_admission_state,
    updated_at = v_now
  WHERE ai_execution_control_heads.scope_key = v_target.scope_key;

  scope_key := v_target.scope_key;
  scope_kind := v_target.scope_kind;
  scope_value := v_target.scope_value;
  control_id := v_target.control_id;
  generation := v_target.generation + 1;
  execution_state := p_execution_state;
  admission_state := p_admission_state;
  updated_at := v_now;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "transition_ai_execution_control_v1"(text, text, uuid, integer, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_ai_canary_authorization_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI canary authorizations cannot be deleted';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.release_sha <> OLD.release_sha
    OR NEW.canary_profile_version <> OLD.canary_profile_version
    OR NEW.authorization_generation <> OLD.authorization_generation
    OR NEW.predecessor_authorization_id IS DISTINCT FROM OLD.predecessor_authorization_id
    OR NEW.nonce <> OLD.nonce
    OR NEW.operator_user_id <> OLD.operator_user_id
    OR NEW.issued_at <> OLD.issued_at
    OR NEW.expires_at <> OLD.expires_at
    OR NOT (
      (
        OLD.state = 'issued'
        AND NEW.state IN ('consumed', 'revoked', 'expired', 'released_no_dispatch')
      )
      OR (
        OLD.state = 'consumed'
        AND NEW.state IN ('released_no_dispatch', 'passed', 'terminal_failed')
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid AI canary authorization transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_canary_authorizations_transition_guard"
BEFORE UPDATE OR DELETE ON "ai_canary_authorizations"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_canary_authorization_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_canary_authorizations_no_truncate"
BEFORE TRUNCATE ON "ai_canary_authorizations"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_ai_canary_authorization_head_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI canary authorization heads cannot be deleted';
  END IF;
  IF NEW.release_sha <> OLD.release_sha
    OR NEW.canary_profile_version <> OLD.canary_profile_version
    OR NEW.head_id <> OLD.head_id
    OR NEW.transition_generation <> OLD.transition_generation + 1
    OR NEW.updated_at < OLD.updated_at
    OR NOT (
      (
        OLD.state = 'eligible'
        AND NEW.state = 'issued'
        AND NEW.next_authorization_generation = OLD.next_authorization_generation + 1
      )
      OR (
        OLD.state = 'issued'
        AND NEW.state IN ('eligible', 'in_flight')
        AND NEW.next_authorization_generation = OLD.next_authorization_generation
      )
      OR (
        OLD.state = 'in_flight'
        AND NEW.state IN ('eligible', 'passed', 'terminal_failed')
        AND NEW.next_authorization_generation = OLD.next_authorization_generation
      )
    )
  THEN
    RAISE EXCEPTION 'Invalid AI canary authorization head transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_canary_authorization_heads_transition_guard"
BEFORE UPDATE OR DELETE ON "ai_canary_authorization_heads"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_canary_authorization_head_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_canary_authorization_heads_no_truncate"
BEFORE TRUNCATE ON "ai_canary_authorization_heads"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "issue_ai_canary_authorization_v1"(
  p_release_sha text,
  p_canary_profile_version text,
  p_expected_head_generation integer,
  p_expected_stop_fence jsonb,
  p_nonce text,
  p_operator_user_id text
)
RETURNS TABLE (
  operation_id uuid,
  permit_id uuid,
  attempt_number integer,
  deadline_epoch_millis bigint,
  canary_authorization_id uuid,
  canary_authorization_generation integer,
  release_sha text,
  canary_profile_version text,
  safety_identifier_profile_version text,
  provider_deployment_profile_version text,
  operation_profile_version text,
  global_control_id uuid,
  global_generation integer,
  provider_control_id uuid,
  provider_generation integer,
  review_analysis_control_id uuid,
  review_analysis_generation integer,
  reply_drafting_control_id uuid,
  reply_drafting_generation integer,
  property_trends_control_id uuid,
  property_trends_generation integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_global public.ai_execution_control_heads%ROWTYPE;
  v_provider public.ai_execution_control_heads%ROWTYPE;
  v_review_analysis public.ai_execution_control_heads%ROWTYPE;
  v_reply_drafting public.ai_execution_control_heads%ROWTYPE;
  v_property_trends public.ai_execution_control_heads%ROWTYPE;
  v_head public.ai_canary_authorization_heads%ROWTYPE;
  v_current public.ai_canary_authorizations%ROWTYPE;
  v_operation public.ai_operations%ROWTYPE;
  v_attempt public.ai_operation_attempts%ROWTYPE;
  v_permit public.ai_execution_permits%ROWTYPE;
  v_stop_fence jsonb;
  v_predecessor_id uuid;
  v_authorization_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_permit_id uuid := gen_random_uuid();
  v_now timestamp with time zone := transaction_timestamp();
  v_authorization_expires_at timestamp with time zone;
  v_deadline timestamp with time zone;
  v_idempotency_scope text;
  v_idempotency_key text;
  v_profile_bytes bytea;
BEGIN
  IF p_release_sha IS NULL
    OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_canary_profile_version IS NULL
    OR p_canary_profile_version <> 'synthetic-canary-v1'
    OR p_expected_head_generation IS NULL
    OR p_expected_head_generation < 1
    OR p_expected_stop_fence IS NULL
    OR jsonb_typeof(p_expected_stop_fence) <> 'object'
    OR p_nonce IS NULL
    OR p_nonce !~ '^[0-9a-f]{64}$'
    OR p_operator_user_id IS NULL
    OR length(p_operator_user_id) NOT BETWEEN 1 AND 255
    OR p_operator_user_id !~ '^[A-Za-z0-9][-A-Za-z0-9._@:/+]{0,254}$'
  THEN
    RAISE EXCEPTION 'Invalid AI canary authorization request'
      USING ERRCODE = '22023';
  END IF;

  -- Operator authority is established before this database boundary by the
  -- sole ops:ai-canary entry point: --operator is byte-matched against the
  -- trimmed, non-empty OPS_OPERATOR_IDENTITIES allowlist, ExecutionPolicy
  -- authorizes the global operator action, and the decision audit is flushed
  -- before its database pool closes. This function stores only that canonical
  -- ASCII audit identity; it does not reinterpret it as an application user.

  PERFORM pg_advisory_xact_lock(public.ai_advisory_lock_key_v1(
    'canary-release|' || p_release_sha || '|' || p_canary_profile_version
  ));

  SELECT * INTO v_global
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_provider
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'provider:private-beta-global-v1'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_review_analysis
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:review_analysis'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_reply_drafting
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:reply_drafting'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_property_trends
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:property_trends'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_stop_fence := jsonb_build_object(
    'globalControlId', v_global.control_id,
    'globalGeneration', v_global.generation,
    'providerControlId', v_provider.control_id,
    'providerGeneration', v_provider.generation,
    'allCapabilityStopFences', jsonb_build_array(
      jsonb_build_object(
        'capability', 'review_analysis',
        'capabilityControlId', v_review_analysis.control_id,
        'capabilityGeneration', v_review_analysis.generation
      ),
      jsonb_build_object(
        'capability', 'reply_drafting',
        'capabilityControlId', v_reply_drafting.control_id,
        'capabilityGeneration', v_reply_drafting.generation
      ),
      jsonb_build_object(
        'capability', 'property_trends',
        'capabilityControlId', v_property_trends.control_id,
        'capabilityGeneration', v_property_trends.generation
      )
    )
  );
  IF p_expected_stop_fence IS DISTINCT FROM v_stop_fence
    OR v_global.execution_state <> 'enabled'
    OR v_global.admission_state <> 'accepting'
    OR v_provider.execution_state <> 'enabled'
    OR v_provider.admission_state <> 'accepting'
    OR v_review_analysis.execution_state <> 'killed'
    OR v_review_analysis.admission_state <> 'draining'
    OR v_reply_drafting.execution_state <> 'killed'
    OR v_reply_drafting.admission_state <> 'draining'
    OR v_property_trends.execution_state <> 'killed'
    OR v_property_trends.admission_state <> 'draining'
  THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ai_provider_deployment_profiles AS provider_profile
    WHERE provider_profile.profile_version = 'private-beta-global-v1'
      AND provider_profile.profile_digest =
        'ca16fd5b5870237e23482bd234f2d61b951e643c86e38170f3aec1bba2aa76eb'
      AND provider_profile.provider = 'openai'
      AND provider_profile.model_snapshot = 'gpt-5.4-mini-2026-03-17'
  )
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_operation_profiles AS operation_profile
      WHERE operation_profile.profile_version = p_canary_profile_version
        AND operation_profile.profile_digest =
          '808506f6121460cf6f6e5d9ddbf3e7637b8e582f63d19358c376500e4487a9dc'
        AND operation_profile.command = 'synthetic_canary'
        AND operation_profile.capability IS NULL
        AND operation_profile.purpose = 'ai.synthetic_canary'
        AND operation_profile.source_route = 'synthetic-canary'
        AND operation_profile.gateway_path = 'internal:synthetic-canary'
        AND operation_profile.caller_role = 'release_canary'
        AND operation_profile.capability_runtime_profile_version IS NULL
        AND operation_profile.provider_deployment_profile_version =
          'private-beta-global-v1'
        AND operation_profile.artifact_attestations->>'canaryProfileVersion' =
          p_canary_profile_version
        AND operation_profile.artifact_attestations->
          'safetyIdentifierProfileVersion' =
          to_jsonb('synthetic-canary-safety-v1'::text)
        AND operation_profile.artifact_attestations->'promptCacheShard' = '0'::jsonb
        AND operation_profile.request_deadline_ms = 70000
    )
    OR (
      SELECT count(*)
      FROM public.ai_provider_deployment_capabilities AS membership
      WHERE membership.provider_deployment_profile_version =
          'private-beta-global-v1'
        AND membership.catalogue_digest =
          '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5'
        AND (membership.capability, membership.runtime_profile_version) IN (
          ('review_analysis', 'review-analysis-runtime-v1'),
          ('reply_drafting', 'reply-drafting-runtime-v1'),
          ('property_trends', 'property-trends-runtime-v1')
        )
    ) <> 3
    OR (
      SELECT count(*)
      FROM public.ai_provider_deployment_capabilities AS membership
      WHERE membership.provider_deployment_profile_version =
        'private-beta-global-v1'
    ) <> 3
  THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_canary_authorization_heads (
    release_sha, canary_profile_version, head_id, transition_generation,
    next_authorization_generation, current_authorization_id,
    current_operation_id, current_permit_id, state, updated_at
  )
  SELECT
    p_release_sha, p_canary_profile_version, gen_random_uuid(), 1,
    1, NULL, NULL, NULL, 'eligible', v_now
  WHERE p_expected_head_generation = 1
  ON CONFLICT ON CONSTRAINT ai_canary_authorization_heads_pk DO NOTHING;

  SELECT * INTO v_head
  FROM public.ai_canary_authorization_heads AS authorization_head
  WHERE authorization_head.release_sha = p_release_sha
    AND authorization_head.canary_profile_version = p_canary_profile_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_head.state = 'issued' THEN
    IF p_expected_head_generation <> v_head.transition_generation - 1
    THEN RETURN; END IF;
    SELECT * INTO v_current
    FROM public.ai_canary_authorizations AS current_authorization
    WHERE current_authorization.id = v_head.current_authorization_id
    FOR UPDATE;
    v_profile_bytes := convert_to(p_canary_profile_version, 'UTF8');
    v_idempotency_scope := encode(sha256(
      convert_to('synthetic_canary', 'UTF8') || decode('00', 'hex') ||
      convert_to(p_release_sha, 'UTF8')
    ), 'hex');
    v_idempotency_key := encode(sha256(
      convert_to('ai-canary-operation-v1', 'UTF8') || decode('00', 'hex') ||
      decode(p_release_sha, 'hex') ||
      int2send(octet_length(v_profile_bytes)::smallint) ||
      v_profile_bytes ||
      int4send(v_current.authorization_generation)
    ), 'hex');
    SELECT * INTO v_operation
    FROM public.ai_operations AS current_operation
    WHERE current_operation.id = v_head.current_operation_id
    FOR UPDATE;
    SELECT * INTO v_attempt
    FROM public.ai_operation_attempts AS current_attempt
    WHERE current_attempt.operation_id = v_head.current_operation_id
      AND current_attempt.attempt = 1
    FOR UPDATE;
    SELECT * INTO v_permit
    FROM public.ai_execution_permits AS current_permit
    WHERE current_permit.id = v_head.current_permit_id
    FOR UPDATE;
    IF v_current.id IS NULL
      OR v_operation.id IS NULL
      OR v_attempt.operation_id IS NULL
      OR v_permit.id IS NULL
      OR v_current.state <> 'issued'
      OR v_current.nonce <> p_nonce
      OR v_head.next_authorization_generation <>
        v_current.authorization_generation + 1
      OR v_current.operator_user_id <> p_operator_user_id
      OR v_current.expires_at <> v_current.issued_at + interval '5 minutes'
      OR v_operation.command <> 'synthetic_canary'
      OR v_operation.state <> 'executing'
      OR v_operation.execution_attempt <> 1
      OR v_operation.canary_authorization_id <> v_current.id
      OR v_operation.canary_authorization_generation <>
        v_current.authorization_generation
      OR v_operation.release_sha <> p_release_sha
      OR v_operation.canary_profile_version <> p_canary_profile_version
      OR v_operation.provider_deployment_profile_version <>
        'private-beta-global-v1'
      OR v_operation.idempotency_scope <> v_idempotency_scope
      OR v_operation.idempotency_key <> v_idempotency_key
      OR v_operation.request_fingerprint <> v_idempotency_key
      OR v_operation.created_at <> v_current.issued_at
      OR (v_operation.expires_at > v_now
        AND v_operation.expires_at <> v_current.issued_at + interval '70 seconds')
      OR v_operation.operation_profile_version <> 'synthetic-canary-v1'
      OR v_operation.global_control_id <> v_global.control_id
      OR v_operation.global_control_generation <> v_global.generation
      OR v_operation.provider_control_id <> v_provider.control_id
      OR v_operation.provider_control_generation <> v_provider.generation
      OR v_operation.capability_fences <>
        v_stop_fence->'allCapabilityStopFences'
      OR v_attempt.state <> 'executing'
      OR v_attempt.started_at <> v_current.issued_at
      OR v_permit.operation_id <> v_operation.id
      OR v_permit.execution_attempt <> 1
      OR v_permit.global_control_id <> v_global.control_id
      OR v_permit.global_control_generation <> v_global.generation
      OR v_permit.provider_control_id <> v_provider.control_id
      OR v_permit.provider_control_generation <> v_provider.generation
      OR v_permit.capability_control_id IS NOT NULL
      OR v_permit.capability_control_generation IS NOT NULL
      OR v_permit.state <> 'issued'
      OR v_permit.route <> 'synthetic-canary'
      OR v_permit.admitted_at <> v_current.issued_at
      OR v_permit.expires_at <> v_operation.expires_at
    THEN
      RETURN;
    END IF;
    IF v_current.expires_at <= v_now
      OR v_operation.expires_at <= v_now
      OR v_permit.expires_at <= v_now
    THEN
      PERFORM public.terminalize_unconsumed_ai_canary_authorization_v1(
        v_current.id, v_head.transition_generation, 'expired'
      );
      RETURN;
    END IF;

    operation_id := v_operation.id;
    permit_id := v_permit.id;
    attempt_number := 1;
    deadline_epoch_millis := public.ai_epoch_millis_v1(v_operation.expires_at);
    canary_authorization_id := v_current.id;
    canary_authorization_generation := v_current.authorization_generation;
    release_sha := p_release_sha;
    canary_profile_version := p_canary_profile_version;
    safety_identifier_profile_version := 'synthetic-canary-safety-v1';
    provider_deployment_profile_version := 'private-beta-global-v1';
    operation_profile_version := 'synthetic-canary-v1';
    global_control_id := v_global.control_id;
    global_generation := v_global.generation;
    provider_control_id := v_provider.control_id;
    provider_generation := v_provider.generation;
    review_analysis_control_id := v_review_analysis.control_id;
    review_analysis_generation := v_review_analysis.generation;
    reply_drafting_control_id := v_reply_drafting.control_id;
    reply_drafting_generation := v_reply_drafting.generation;
    property_trends_control_id := v_property_trends.control_id;
    property_trends_generation := v_property_trends.generation;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_head.state <> 'eligible'
    OR v_head.transition_generation <> p_expected_head_generation
    OR v_head.next_authorization_generation > 3
  THEN
    RETURN;
  END IF;

  IF v_head.next_authorization_generation > 1 THEN
    SELECT prior.id INTO v_predecessor_id
    FROM public.ai_canary_authorizations AS prior
    WHERE prior.release_sha = p_release_sha
      AND prior.canary_profile_version = p_canary_profile_version
      AND prior.authorization_generation =
        v_head.next_authorization_generation - 1;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  v_profile_bytes := convert_to(p_canary_profile_version, 'UTF8');
  v_idempotency_scope := encode(sha256(
    convert_to('synthetic_canary', 'UTF8') || decode('00', 'hex') ||
    convert_to(p_release_sha, 'UTF8')
  ), 'hex');
  v_idempotency_key := encode(sha256(
    convert_to('ai-canary-operation-v1', 'UTF8') || decode('00', 'hex') ||
    decode(p_release_sha, 'hex') ||
    int2send(octet_length(v_profile_bytes)::smallint) ||
    v_profile_bytes ||
    int4send(v_head.next_authorization_generation)
  ), 'hex');
  IF EXISTS (
    SELECT 1
    FROM public.ai_operations AS existing_operation
    WHERE existing_operation.idempotency_scope = v_idempotency_scope
      AND existing_operation.idempotency_key = v_idempotency_key
    FOR UPDATE
  ) THEN
    RETURN;
  END IF;

  v_authorization_expires_at := v_now + interval '5 minutes';
  v_deadline := v_now + interval '70 seconds';
  INSERT INTO public.ai_canary_authorizations (
    id, release_sha, canary_profile_version, authorization_generation,
    predecessor_authorization_id, nonce, operator_user_id, state,
    issued_at, expires_at, settled_at
  ) VALUES (
    v_authorization_id, p_release_sha, p_canary_profile_version,
    v_head.next_authorization_generation, v_predecessor_id, p_nonce,
    p_operator_user_id, 'issued', v_now, v_authorization_expires_at, NULL
  );

  INSERT INTO public.ai_operations (
    id, idempotency_scope, idempotency_key, request_fingerprint,
    command, capability, organization_id, property_id, actor_user_id,
    system_principal, release_sha, canary_authorization_id,
    canary_authorization_generation, canary_profile_version,
    provider_deployment_profile_version, operation_profile_version,
    capability_runtime_profile_version, global_control_id,
    global_control_generation, provider_control_id,
    provider_control_generation, capability_control_id,
    capability_control_generation, capability_fences, state,
    execution_attempt, next_attempt_at, failure_code, created_at,
    updated_at, expires_at, delivered_at
  ) VALUES (
    v_operation_id, v_idempotency_scope, v_idempotency_key, v_idempotency_key,
    'synthetic_canary', NULL, NULL, NULL, NULL, 'release_canary',
    p_release_sha, v_authorization_id, v_head.next_authorization_generation,
    p_canary_profile_version, 'private-beta-global-v1',
    'synthetic-canary-v1', NULL, v_global.control_id, v_global.generation,
    v_provider.control_id, v_provider.generation, NULL, NULL,
    v_stop_fence->'allCapabilityStopFences', 'executing', 1, NULL, NULL,
    v_now, v_now, v_deadline, NULL
  );
  INSERT INTO public.ai_operation_attempts (
    operation_id, attempt, state, failure_code, started_at, settled_at,
    model_snapshot, input_tokens, output_tokens
  ) VALUES (
    v_operation_id, 1, 'executing', NULL, v_now, NULL, NULL, NULL, NULL
  );
  INSERT INTO public.ai_execution_permits (
    id, operation_id, execution_attempt, global_control_id,
    global_control_generation, provider_control_id,
    provider_control_generation, capability_control_id,
    capability_control_generation, admitted_at, expires_at, route
  ) VALUES (
    v_permit_id, v_operation_id, 1, v_global.control_id, v_global.generation,
    v_provider.control_id, v_provider.generation, NULL, NULL,
    v_now, v_deadline, 'synthetic-canary'
  );
  UPDATE public.ai_canary_authorization_heads
  SET
    transition_generation = v_head.transition_generation + 1,
    next_authorization_generation = v_head.next_authorization_generation + 1,
    current_authorization_id = v_authorization_id,
    current_operation_id = v_operation_id,
    current_permit_id = v_permit_id,
    state = 'issued',
    updated_at = v_now
  WHERE ai_canary_authorization_heads.release_sha = p_release_sha
    AND ai_canary_authorization_heads.canary_profile_version =
      p_canary_profile_version;

  operation_id := v_operation_id;
  permit_id := v_permit_id;
  attempt_number := 1;
  deadline_epoch_millis := public.ai_epoch_millis_v1(v_deadline);
  canary_authorization_id := v_authorization_id;
  canary_authorization_generation := v_head.next_authorization_generation;
  release_sha := p_release_sha;
  canary_profile_version := p_canary_profile_version;
  safety_identifier_profile_version := 'synthetic-canary-safety-v1';
  provider_deployment_profile_version := 'private-beta-global-v1';
  operation_profile_version := 'synthetic-canary-v1';
  global_control_id := v_global.control_id;
  global_generation := v_global.generation;
  provider_control_id := v_provider.control_id;
  provider_generation := v_provider.generation;
  review_analysis_control_id := v_review_analysis.control_id;
  review_analysis_generation := v_review_analysis.generation;
  reply_drafting_control_id := v_reply_drafting.control_id;
  reply_drafting_generation := v_reply_drafting.generation;
  property_trends_control_id := v_property_trends.control_id;
  property_trends_generation := v_property_trends.generation;
  RETURN NEXT;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "issue_ai_canary_authorization_v1"(
  text, text, integer, jsonb, text, text
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "terminalize_unconsumed_ai_canary_authorization_v1"(
  p_authorization_id uuid,
  p_expected_head_generation integer,
  p_terminal_state text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_discovered record;
  v_head public.ai_canary_authorization_heads%ROWTYPE;
  v_authorization public.ai_canary_authorizations%ROWTYPE;
  v_operation public.ai_operations%ROWTYPE;
  v_attempt public.ai_operation_attempts%ROWTYPE;
  v_permit public.ai_execution_permits%ROWTYPE;
  v_now timestamp with time zone := transaction_timestamp();
  v_failure_code text;
  v_control public.ai_execution_control_heads%ROWTYPE;
BEGIN
  IF p_authorization_id IS NULL
    OR p_expected_head_generation IS NULL
    OR p_expected_head_generation < 1
    OR p_terminal_state IS NULL
    OR p_terminal_state NOT IN ('revoked', 'expired')
  THEN
    RAISE EXCEPTION 'Invalid AI canary terminal request'
      USING ERRCODE = '22023';
  END IF;

  SELECT release_sha, canary_profile_version
  INTO v_discovered
  FROM public.ai_canary_authorizations
  WHERE id = p_authorization_id;
  IF NOT FOUND THEN RETURN 'denied'; END IF;

  PERFORM pg_advisory_xact_lock(public.ai_advisory_lock_key_v1(
    'canary-release|' || v_discovered.release_sha || '|' ||
      v_discovered.canary_profile_version
  ));
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'global'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'provider:private-beta-global-v1'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:review_analysis'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:reply_drafting'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_control
  FROM public.ai_execution_control_heads
  WHERE scope_key = 'capability:property_trends'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;

  SELECT * INTO v_head
  FROM public.ai_canary_authorization_heads
  WHERE release_sha = v_discovered.release_sha
    AND canary_profile_version = v_discovered.canary_profile_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_authorization
  FROM public.ai_canary_authorizations
  WHERE id = p_authorization_id
    AND release_sha = v_head.release_sha
    AND canary_profile_version = v_head.canary_profile_version
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_operation
  FROM public.ai_operations
  WHERE canary_authorization_id = v_authorization.id
    AND canary_authorization_generation =
      v_authorization.authorization_generation
    AND command = 'synthetic_canary'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_attempt
  FROM public.ai_operation_attempts
  WHERE operation_id = v_operation.id AND attempt = 1
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;
  SELECT * INTO v_permit
  FROM public.ai_execution_permits
  WHERE operation_id = v_operation.id AND execution_attempt = 1
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'denied'; END IF;

  IF v_authorization.state = p_terminal_state THEN
    IF v_head.state = 'eligible'
      AND v_head.transition_generation = p_expected_head_generation + 1
      AND v_head.current_authorization_id IS NULL
      AND v_head.current_operation_id IS NULL
      AND v_head.current_permit_id IS NULL
      AND v_operation.state = 'cancelled'
      AND v_attempt.state = 'cancelled'
      AND v_permit.state = 'released'
    THEN
      RETURN 'replayed';
    END IF;
    RETURN 'denied';
  END IF;
  IF v_head.transition_generation <> p_expected_head_generation
    OR v_head.state <> 'issued'
    OR v_head.current_authorization_id <> v_authorization.id
    OR v_head.current_operation_id <> v_operation.id
    OR v_head.current_permit_id <> v_permit.id
    OR v_authorization.state <> 'issued'
    OR (
      p_terminal_state = 'expired'
      AND v_authorization.expires_at > v_now
      AND v_operation.expires_at > v_now
      AND v_permit.expires_at > v_now
    )
    OR v_operation.state <> 'executing'
    OR v_operation.execution_attempt <> 1
    OR v_attempt.state <> 'executing'
    OR v_permit.state <> 'issued'
    OR v_permit.route <> 'synthetic-canary'
  THEN
    RETURN 'denied';
  END IF;

  v_failure_code := CASE p_terminal_state
    WHEN 'revoked' THEN 'canary_authorization_revoked'
    ELSE 'canary_authorization_expired'
  END;
  UPDATE public.ai_operation_attempts
  SET state = 'cancelled', failure_code = v_failure_code, settled_at = v_now
  WHERE operation_id = v_operation.id AND attempt = 1 AND state = 'executing';
  UPDATE public.ai_operations
  SET state = 'cancelled', failure_code = v_failure_code,
    next_attempt_at = NULL, updated_at = v_now
  WHERE id = v_operation.id AND state = 'executing';
  UPDATE public.ai_execution_permits
  SET state = 'released'
  WHERE id = v_permit.id AND state = 'issued';
  UPDATE public.ai_canary_authorizations
  SET state = p_terminal_state, settled_at = v_now
  WHERE id = v_authorization.id AND state = 'issued';
  UPDATE public.ai_canary_authorization_heads
  SET
    transition_generation = v_head.transition_generation + 1,
    current_authorization_id = NULL,
    current_operation_id = NULL,
    current_permit_id = NULL,
    state = 'eligible',
    updated_at = v_now
  WHERE release_sha = v_head.release_sha
    AND canary_profile_version = v_head.canary_profile_version
    AND transition_generation = v_head.transition_generation
    AND state = 'issued';
  RETURN CASE WHEN FOUND THEN 'terminalized' ELSE 'denied' END;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "terminalize_unconsumed_ai_canary_authorization_v1"(
  uuid, integer, text
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "revoke_ai_canary_authorization_v1"(
  p_authorization_id uuid,
  p_expected_head_generation integer
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.terminalize_unconsumed_ai_canary_authorization_v1(
    p_authorization_id, p_expected_head_generation, 'revoked'
  ) IN ('terminalized', 'replayed');
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "revoke_ai_canary_authorization_v1"(
  uuid, integer
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reap_expired_ai_canary_authorizations_v1"(
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_candidate record;
  v_reaped integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid AI canary reaper limit'
      USING ERRCODE = '22023';
  END IF;
  FOR v_candidate IN
    SELECT
      auth_row.id AS authorization_id,
      auth_head.transition_generation AS head_generation
    FROM public.ai_canary_authorizations AS auth_row
    INNER JOIN public.ai_canary_authorization_heads AS auth_head
      ON auth_head.release_sha = auth_row.release_sha
     AND auth_head.canary_profile_version = auth_row.canary_profile_version
     AND auth_head.current_authorization_id = auth_row.id
     AND auth_head.state = 'issued'
    INNER JOIN public.ai_operations AS operation_row
      ON operation_row.id = auth_head.current_operation_id
     AND operation_row.canary_authorization_id = auth_row.id
     AND operation_row.command = 'synthetic_canary'
     AND operation_row.state = 'executing'
    INNER JOIN public.ai_execution_permits AS permit_row
      ON permit_row.id = auth_head.current_permit_id
     AND permit_row.operation_id = operation_row.id
     AND permit_row.state = 'issued'
    WHERE auth_row.state = 'issued'
      AND (
        auth_row.expires_at <= transaction_timestamp()
        OR operation_row.expires_at <= transaction_timestamp()
        OR permit_row.expires_at <= transaction_timestamp()
      )
    ORDER BY LEAST(
      auth_row.expires_at, operation_row.expires_at, permit_row.expires_at
    ), auth_row.id
    LIMIT p_limit
  LOOP
    IF public.terminalize_unconsumed_ai_canary_authorization_v1(
      v_candidate.authorization_id,
      v_candidate.head_generation,
      'expired'
    ) = 'terminalized' THEN
      v_reaped := v_reaped + 1;
    END IF;
  END LOOP;
  RETURN v_reaped;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "reap_expired_ai_canary_authorizations_v1"(
  integer
) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "resolve_ai_property_local_date_v1"(
  p_reviewed_at timestamp with time zone,
  p_timezone text,
  p_calendar_profile_version text
)
RETURNS date
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_authority public.ai_property_calendar_authorities%ROWTYPE;
  v_epoch_millis_function_digest text;
  v_local_date_function_digest text;
  v_local_midnight_function_digest text;
  v_vector_digest text;
  v_postgres_major integer;
BEGIN
  IF p_calendar_profile_version <> 'property-calendar-v1' THEN RETURN NULL; END IF;
  SELECT *
  INTO v_authority
  FROM public.ai_property_calendar_authorities
  WHERE profile_version = p_calendar_profile_version;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_epoch_millis_function_digest := encode(
    sha256(convert_to(pg_get_functiondef(
      'public.ai_epoch_millis_v1(timestamptz)'::regprocedure
    ), 'UTF8')),
    'hex'
  );
  v_local_date_function_digest := encode(
    sha256(convert_to(pg_get_functiondef(
      'public.ai_property_local_date_v1(timestamptz,text)'::regprocedure
    ), 'UTF8')),
    'hex'
  );
  v_local_midnight_function_digest := encode(
    sha256(convert_to(pg_get_functiondef(
      'public.ai_property_local_midnight_v1(date,text)'::regprocedure
    ), 'UTF8')),
    'hex'
  );
  v_vector_digest := encode(
    sha256(convert_to(v_authority.test_vectors::text, 'UTF8')),
    'hex'
  );
  v_postgres_major := current_setting('server_version_num')::integer / 10000;
  IF v_authority.epoch_millis_function_name <> 'ai_epoch_millis_v1'
    OR v_authority.epoch_millis_function_digest <> v_epoch_millis_function_digest
    OR v_authority.local_date_function_name <> 'ai_property_local_date_v1'
    OR v_authority.local_date_function_digest <> v_local_date_function_digest
    OR v_authority.local_midnight_function_name <> 'ai_property_local_midnight_v1'
    OR v_authority.local_midnight_function_digest <> v_local_midnight_function_digest
    OR v_authority.image_digest <> '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20'
    OR v_authority.vector_digest <> v_vector_digest
    OR v_authority.vector_count <> jsonb_array_length(v_authority.test_vectors)
    OR v_authority.tested_postgres_major_versions <> ARRAY[16]::integer[]
    OR v_postgres_major <> 16
  THEN
    RETURN NULL;
  END IF;
  RETURN public.ai_property_local_date_v1(p_reviewed_at, p_timezone);
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "ai_property_local_midnight_v1"(
  p_local_date date,
  p_timezone text
)
RETURNS timestamp with time zone
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_midnight timestamp with time zone;
BEGIN
  IF extract(year FROM p_local_date) NOT BETWEEN 1970 AND 2100
    OR length(p_timezone) NOT BETWEEN 1 AND 64
    OR p_timezone !~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$'
  THEN
    RETURN NULL;
  END IF;
  v_midnight := p_local_date::timestamp AT TIME ZONE p_timezone;
  IF public.ai_property_local_date_v1(v_midnight, p_timezone) <> p_local_date THEN
    RETURN NULL;
  END IF;
  RETURN v_midnight;
EXCEPTION
  WHEN invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_ai_property_calendar_authority_v1"()
RETURNS boolean
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_authority public.ai_property_calendar_authorities%ROWTYPE;
  v_vector jsonb;
  v_actual date;
BEGIN
  SELECT *
  INTO v_authority
  FROM public.ai_property_calendar_authorities
  WHERE profile_version = 'property-calendar-v1';
  IF NOT FOUND
    OR public.resolve_ai_property_local_date_v1(
      '2026-01-01T00:00:00Z'::timestamp with time zone,
      'UTC',
      'property-calendar-v1'
    ) IS NULL
  THEN
    RETURN false;
  END IF;

  FOR v_vector IN
    SELECT value FROM jsonb_array_elements(v_authority.test_vectors)
  LOOP
    IF jsonb_typeof(v_vector) <> 'object'
      OR v_vector->>'reviewedAt' IS NULL
      OR v_vector->>'timezone' IS NULL
      OR v_vector->>'expectedLocalDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR (SELECT count(*) FROM jsonb_object_keys(v_vector)) <> 3
    THEN
      RETURN false;
    END IF;
    v_actual := public.resolve_ai_property_local_date_v1(
      (v_vector->>'reviewedAt')::timestamp with time zone,
      v_vector->>'timezone',
      'property-calendar-v1'
    );
    IF v_actual IS NULL OR v_actual::text <> v_vector->>'expectedLocalDate' THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN RETURN false;
END;
$$;--> statement-breakpoint
WITH calendar_vectors(test_vectors) AS (
  VALUES (
    '[
      {"expectedLocalDate":"2026-03-08","reviewedAt":"2026-03-08T06:59:59Z","timezone":"America/New_York"},
      {"expectedLocalDate":"2026-03-08","reviewedAt":"2026-03-08T07:00:00Z","timezone":"America/New_York"},
      {"expectedLocalDate":"2026-11-01","reviewedAt":"2026-11-01T05:59:59Z","timezone":"America/New_York"},
      {"expectedLocalDate":"2026-11-01","reviewedAt":"2026-11-01T06:00:00Z","timezone":"America/New_York"},
      {"expectedLocalDate":"2024-03-01","reviewedAt":"2024-02-29T23:30:00Z","timezone":"Pacific/Kiritimati"},
      {"expectedLocalDate":"2024-02-29","reviewedAt":"2024-03-01T00:30:00Z","timezone":"America/Los_Angeles"},
      {"expectedLocalDate":"2026-04-01","reviewedAt":"2026-03-31T21:30:00Z","timezone":"Europe/Sofia"},
      {"expectedLocalDate":"2025-12-31","reviewedAt":"2026-01-01T05:00:00Z","timezone":"Pacific/Pago_Pago"},
      {"expectedLocalDate":"2027-01-01","reviewedAt":"2026-12-31T18:30:00Z","timezone":"Asia/Kathmandu"},
      {"expectedLocalDate":"2026-01-31","reviewedAt":"2026-01-31T23:59:59Z","timezone":"UTC"}
    ]'::jsonb
  )
)
INSERT INTO "ai_property_calendar_authorities" (
  "profile_version",
  "epoch_millis_function_name",
  "epoch_millis_function_digest",
  "local_date_function_name",
  "local_date_function_digest",
  "local_midnight_function_name",
  "local_midnight_function_digest",
  "image_digest",
  "vector_digest",
  "vector_count",
  "minimum_year",
  "maximum_year",
  "tested_postgres_major_versions",
  "test_vectors",
  "created_at"
)
SELECT
  'property-calendar-v1',
  'ai_epoch_millis_v1',
  '9367a74304ab003cf57e2aa988883d72b4b9782a9cc9e7e639033c4b1604fa35',
  'ai_property_local_date_v1',
  '6521dba5d8bc579bf55f8bf47d5db5c642032795949af54cb370189cac0d61a0',
  'ai_property_local_midnight_v1',
  'ab121d8706ff847aea69b565d9571b3561e8289f0a417b8a35f13abb20edcbe1',
  '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20',
  '0108713532775ad86be18c94c69eed42c9f2dfd24766608ff3592d87e7739545',
  jsonb_array_length(test_vectors),
  1970,
  2100,
  ARRAY[16],
  test_vectors,
  '2026-08-16T00:00:00Z'::timestamp with time zone
FROM calendar_vectors;
DO $$
BEGIN
  IF NOT public.assert_ai_property_calendar_authority_v1() THEN
    RAISE EXCEPTION 'property-calendar-v1 authority mismatch' USING ERRCODE = '22023';
  END IF;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "ai_property_local_midnight_v1"(date, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_ai_property_local_date_v1"(timestamp with time zone, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_property_calendar_authority_v1"() FROM PUBLIC;