CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'degraded', 'reauth_required', 'disconnecting', 'disconnected', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."connection_visibility" AS ENUM('private', 'organization');
--> statement-breakpoint
CREATE TYPE "public"."google_credential_use_state" AS ENUM('active', 'cleanup_only', 'none');
--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_action" AS ENUM('create', 'relink');
--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_item_status" AS ENUM('pending', 'processing', 'imported', 'relinked', 'already_exists', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_outcome" AS ENUM('imported', 'relinked', 'already_exists', 'active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'authorization_changed', 'user_cancelled', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted', 'temporarily_unavailable', 'cleanup_required', 'internal_error');
--> statement-breakpoint
CREATE TYPE "public"."google_import_v2_parent_status" AS ENUM('queued', 'processing', 'completed', 'completed_with_issues', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."authorization_execution_permit_state" AS ENUM('admitted', 'started', 'completed', 'fenced');
--> statement-breakpoint
CREATE TYPE "public"."credential_revoke_permit_state" AS ENUM('dormant', 'active', 'dispatching', 'consumed_no_revoke', 'confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous', 'provider_reset_confirmed');
--> statement-breakpoint
CREATE TYPE "public"."google_content_capability" AS ENUM('property.import_gbp_v2', 'property.read_gbp_performance', 'property.connect_gbp', 'property.publish_reply');
--> statement-breakpoint
CREATE TYPE "public"."google_credential_source_kind" AS ENUM('refresh', 'reauth', 'reconnect');
--> statement-breakpoint
CREATE TYPE "public"."google_credential_source_state" AS ENUM('registered', 'provider_started', 'terminal', 'provider_outcome_ambiguous', 'provider_reset_terminal');
--> statement-breakpoint
CREATE TYPE "public"."google_subject_authority_guard_state" AS ENUM('open', 'source_active', 'cleanup_pending', 'drained', 'provider_reset_required', 'ambiguous', 'provider_reset_terminal');
--> statement-breakpoint
CREATE TYPE "public"."inbox_assignment_reason" AS ENUM('claim', 'assign', 'reassign', 'release', 'eligibility_lost', 'reopen_restore');
--> statement-breakpoint
CREATE TYPE "public"."inbox_source_type" AS ENUM('review', 'feedback');
--> statement-breakpoint
CREATE TYPE "public"."inbox_status" AS ENUM('open', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."grant_kind" AS ENUM('full_access', 'manage', 'respond', 'view');
--> statement-breakpoint
CREATE TYPE "public"."grant_status" AS ENUM('active', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('active', 'inactive', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."responsibility_kind" AS ENUM('primary', 'supporting');
--> statement-breakpoint
CREATE TYPE "public"."staff_participant_status" AS ENUM('active', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."reply_authorship" AS ENUM('human', 'ai_assisted');
--> statement-breakpoint
CREATE TYPE "public"."reply_source" AS ENUM('google_sync', 'internal');
--> statement-breakpoint
CREATE TYPE "public"."reply_status" AS ENUM('draft', 'pending_approval', 'approved', 'published', 'rejected', 'publish_failed');
--> statement-breakpoint
CREATE TYPE "public"."review_platform" AS ENUM('google');
--> statement-breakpoint
CREATE SEQUENCE "public"."google_reply_observation_read_generation_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9007199254740991 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE TABLE "ai_execution_control_heads" (
	"scope_key" varchar(150) PRIMARY KEY NOT NULL,
	"scope_kind" varchar(40) NOT NULL,
	"scope_value" varchar(100),
	"control_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"execution_state" varchar(20) NOT NULL,
	"admission_state" varchar(20) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_execution_control_heads_generation_valid" CHECK ("ai_execution_control_heads"."generation" >= 1),
	CONSTRAINT "ai_execution_control_heads_scope_valid" CHECK ((
        ("ai_execution_control_heads"."scope_kind" = 'global' AND "ai_execution_control_heads"."scope_key" = 'global' AND "ai_execution_control_heads"."scope_value" IS NULL)
        OR ("ai_execution_control_heads"."scope_kind" = 'provider_deployment_profile' AND "ai_execution_control_heads"."scope_value" ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND "ai_execution_control_heads"."scope_key" = 'provider:' || "ai_execution_control_heads"."scope_value")
        OR ("ai_execution_control_heads"."scope_kind" = 'capability' AND "ai_execution_control_heads"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_execution_control_heads"."scope_key" = 'capability:' || "ai_execution_control_heads"."scope_value")
      )),
	CONSTRAINT "ai_execution_control_heads_state_valid" CHECK ("ai_execution_control_heads"."execution_state" IN ('enabled', 'killed') AND "ai_execution_control_heads"."admission_state" IN ('accepting', 'draining'))
);
--> statement-breakpoint
CREATE TABLE "ai_execution_control_transitions" (
	"control_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"predecessor_generation" integer,
	"scope_key" varchar(150) NOT NULL,
	"scope_kind" varchar(40) NOT NULL,
	"scope_value" varchar(100),
	"execution_state" varchar(20) NOT NULL,
	"admission_state" varchar(20) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"actor_user_id" varchar(255),
	"ticket_reference" varchar(255) NOT NULL,
	"candidate_release_sha" varchar(40),
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_execution_control_transitions_pk" PRIMARY KEY("control_id","generation"),
	CONSTRAINT "ai_execution_control_transitions_generation_valid" CHECK ("ai_execution_control_transitions"."generation" >= 1 AND (("ai_execution_control_transitions"."generation" = 1 AND "ai_execution_control_transitions"."predecessor_generation" IS NULL) OR ("ai_execution_control_transitions"."generation" > 1 AND "ai_execution_control_transitions"."predecessor_generation" = "ai_execution_control_transitions"."generation" - 1))),
	CONSTRAINT "ai_execution_control_transitions_scope_valid" CHECK ((
        ("ai_execution_control_transitions"."scope_kind" = 'global' AND "ai_execution_control_transitions"."scope_key" = 'global' AND "ai_execution_control_transitions"."scope_value" IS NULL)
        OR ("ai_execution_control_transitions"."scope_kind" = 'provider_deployment_profile' AND "ai_execution_control_transitions"."scope_value" ~ '^[a-z0-9][a-z0-9._-]{0,99}$' AND "ai_execution_control_transitions"."scope_key" = 'provider:' || "ai_execution_control_transitions"."scope_value")
        OR ("ai_execution_control_transitions"."scope_kind" = 'capability' AND "ai_execution_control_transitions"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_execution_control_transitions"."scope_key" = 'capability:' || "ai_execution_control_transitions"."scope_value")
      )),
	CONSTRAINT "ai_execution_control_transitions_state_valid" CHECK ("ai_execution_control_transitions"."execution_state" IN ('enabled', 'killed') AND "ai_execution_control_transitions"."admission_state" IN ('accepting', 'draining')),
	CONSTRAINT "ai_execution_control_transitions_reason_valid" CHECK ("ai_execution_control_transitions"."reason_code" ~ '^[a-z][a-z0-9_]{2,63}$' AND length("ai_execution_control_transitions"."ticket_reference") BETWEEN 1 AND 255),
	CONSTRAINT "ai_execution_control_transitions_release_valid" CHECK ("ai_execution_control_transitions"."candidate_release_sha" IS NULL OR "ai_execution_control_transitions"."candidate_release_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "ai_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_scope" varchar(255) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	"source_byte_count" integer NOT NULL,
	"command" varchar(32) NOT NULL,
	"capability" varchar(40) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"actor_user_id" varchar(255),
	"system_principal" varchar(64),
	"review_id" uuid,
	"origin_event_id" uuid,
	"subject_hmac" varchar(64),
	"subject_hmac_key_version" varchar(100),
	"source_epoch" integer,
	"source_revision" bigint,
	"reviewed_at_epoch_millis" bigint,
	"analysis_sequence" bigint,
	"tone" varchar(20),
	"base_reply_state_revision" bigint,
	"due_local_date" date,
	"terminal_analysis_sequence" bigint,
	"aggregate_revision" bigint,
	"authorization_lineage_id" uuid,
	"notice_version" varchar(100),
	"notice_digest" varchar(64),
	"evaluated_language" varchar(35),
	"concrete_reply_language_tag" varchar(35),
	"concrete_reply_template_group" varchar(64),
	"language_catalogue_digest" varchar(64),
	"reply_language_verifier_digest" varchar(64),
	"language_script_consistency_digest" varchar(64),
	"zh_orthography_verifier_digest" varchar(64),
	"property_profile_version" integer,
	"reply_brand_profile_version" integer,
	"reply_brand_display_name_digest" varchar(64),
	"routing_policy_version" integer,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"operation_profile_version" varchar(100) NOT NULL,
	"capability_runtime_profile_version" varchar(100),
	"source_policy_id" varchar(150),
	"source_canonicalizer_digest" varchar(64),
	"redaction_profile_version" varchar(100),
	"output_leakage_profile_version" varchar(100),
	"output_leakage_profile_digest" varchar(64),
	"reply_template_catalogue_version" varchar(100),
	"reply_template_catalogue_digest" varchar(64),
	"global_control_id" uuid NOT NULL,
	"global_control_generation" integer NOT NULL,
	"provider_control_id" uuid NOT NULL,
	"provider_control_generation" integer NOT NULL,
	"capability_control_id" uuid NOT NULL,
	"capability_control_generation" integer NOT NULL,
	"capability_fences" jsonb NOT NULL,
	"route_key" varchar(64),
	"execution_permit_id" uuid,
	"admission_nonce" varchar(64),
	"request_binding_key_id" varchar(64),
	"request_binding_hmac" varchar(43),
	"grant_kid" varchar(32),
	"cost_window_id" uuid,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"actual_micros" bigint,
	"budget_reserved_at" timestamp with time zone,
	"budget_settled_at" timestamp with time zone,
	"state" varchar(40) NOT NULL,
	"execution_attempt" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"failure_code" varchar(64),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"reply_adoption_disposition" varchar(20) DEFAULT 'none' NOT NULL,
	"adopted_reply_revision" bigint,
	"adopted_review_reply_state_revision" bigint,
	CONSTRAINT "ai_operations_fingerprint_valid" CHECK ("ai_operations"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_operations_source_provenance_valid" CHECK ("ai_operations"."source_digest" ~ '^[0-9a-f]{64}$' AND "ai_operations"."source_byte_count" BETWEEN 1 AND 131072),
	CONSTRAINT "ai_operations_state_valid" CHECK ("ai_operations"."state" IN ('pending', 'executing', 'succeeded_pending_delivery', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_operations_attempt_valid" CHECK ("ai_operations"."execution_attempt" >= 0 AND "ai_operations"."expires_at" > "ai_operations"."created_at" AND "ai_operations"."updated_at" >= "ai_operations"."created_at" AND ("ai_operations"."next_attempt_at" IS NULL OR "ai_operations"."next_attempt_at" >= "ai_operations"."updated_at")),
	CONSTRAINT "ai_operations_budget_valid" CHECK ("ai_operations"."reserved_micros" BETWEEN 0 AND '9007199254740991'::bigint
        AND ("ai_operations"."actual_micros" IS NULL OR "ai_operations"."actual_micros" BETWEEN 0 AND "ai_operations"."reserved_micros")
        AND (("ai_operations"."cost_window_id" IS NULL AND "ai_operations"."reserved_micros" = 0 AND "ai_operations"."budget_reserved_at" IS NULL)
          OR ("ai_operations"."cost_window_id" IS NOT NULL AND "ai_operations"."reserved_micros" > 0 AND "ai_operations"."budget_reserved_at" IS NOT NULL))
        AND (("ai_operations"."budget_settled_at" IS NULL AND "ai_operations"."actual_micros" IS NULL)
          OR ("ai_operations"."budget_settled_at" IS NOT NULL AND "ai_operations"."actual_micros" IS NOT NULL AND "ai_operations"."budget_settled_at" >= "ai_operations"."budget_reserved_at"))),
	CONSTRAINT "ai_operations_safe_integers" CHECK (COALESCE("ai_operations"."source_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."reviewed_at_epoch_millis", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."analysis_sequence", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."base_reply_state_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."terminal_analysis_sequence", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."aggregate_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."adopted_reply_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."adopted_review_reply_state_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_operations_branch_valid" CHECK ((
        ("ai_operations"."command" = 'analysis' AND "ai_operations"."capability" = 'review_analysis' AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'review_event_consumer' AND "ai_operations"."review_id" IS NOT NULL AND "ai_operations"."origin_event_id" IS NOT NULL AND "ai_operations"."subject_hmac" ~ '^[0-9a-f]{64}$' AND "ai_operations"."subject_hmac_key_version" IS NOT NULL AND "ai_operations"."source_epoch" >= 0 AND "ai_operations"."source_revision" >= 1 AND "ai_operations"."analysis_sequence" >= 1)
        OR ("ai_operations"."command" = 'reply' AND "ai_operations"."capability" = 'reply_drafting' AND "ai_operations"."actor_user_id" IS NOT NULL AND "ai_operations"."system_principal" IS NULL AND "ai_operations"."review_id" IS NOT NULL AND "ai_operations"."source_epoch" >= 0 AND "ai_operations"."source_revision" >= 1 AND "ai_operations"."tone" IN ('professional', 'friendly', 'casual') AND "ai_operations"."base_reply_state_revision" >= 0)
        OR ("ai_operations"."command" = 'trend' AND "ai_operations"."capability" = 'property_trends' AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'property_trend_coordinator' AND "ai_operations"."source_epoch" >= 0 AND "ai_operations"."due_local_date" IS NOT NULL AND "ai_operations"."terminal_analysis_sequence" >= 0 AND "ai_operations"."aggregate_revision" >= 0)
      )),
	CONSTRAINT "ai_operations_reply_brand_binding_valid" CHECK ((("ai_operations"."command" = 'reply' AND (("ai_operations"."reply_brand_profile_version" IS NULL AND "ai_operations"."reply_brand_display_name_digest" IS NULL) OR ("ai_operations"."reply_brand_profile_version" >= 1 AND "ai_operations"."reply_brand_display_name_digest" ~ '^[0-9a-f]{64}$')))
        OR ("ai_operations"."command" <> 'reply' AND "ai_operations"."reply_brand_profile_version" IS NULL AND "ai_operations"."reply_brand_display_name_digest" IS NULL))),
	CONSTRAINT "ai_operations_reply_adoption_valid" CHECK ((("ai_operations"."command" = 'reply' AND "ai_operations"."reply_adoption_disposition" IN ('none', 'adopted', 'invalidated')
          AND (("ai_operations"."reply_adoption_disposition" = 'none' AND "ai_operations"."adopted_reply_revision" IS NULL AND "ai_operations"."adopted_review_reply_state_revision" IS NULL)
            OR ("ai_operations"."reply_adoption_disposition" = 'adopted' AND "ai_operations"."adopted_reply_revision" >= 1 AND "ai_operations"."adopted_review_reply_state_revision" >= 1)
            OR ("ai_operations"."reply_adoption_disposition" = 'invalidated' AND (("ai_operations"."adopted_reply_revision" IS NULL AND "ai_operations"."adopted_review_reply_state_revision" IS NULL) OR ("ai_operations"."adopted_reply_revision" >= 1 AND "ai_operations"."adopted_review_reply_state_revision" >= 1)))))
        OR ("ai_operations"."command" <> 'reply' AND "ai_operations"."reply_adoption_disposition" = 'none' AND "ai_operations"."adopted_reply_revision" IS NULL AND "ai_operations"."adopted_review_reply_state_revision" IS NULL))),
	CONSTRAINT "ai_operations_control_fence_valid" CHECK ("ai_operations"."global_control_generation" >= 1 AND "ai_operations"."provider_control_generation" >= 1
        AND "ai_operations"."capability_control_generation" >= 1 AND jsonb_typeof("ai_operations"."capability_fences") = 'object')
);
--> statement-breakpoint
CREATE TABLE "ai_organization_cost_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"settled_micros" bigint DEFAULT 0 NOT NULL,
	"cap_micros" bigint DEFAULT 50000000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_organization_cost_windows_valid" CHECK ("ai_organization_cost_windows"."reserved_micros" BETWEEN 0 AND "ai_organization_cost_windows"."cap_micros"
        AND "ai_organization_cost_windows"."settled_micros" BETWEEN 0 AND "ai_organization_cost_windows"."cap_micros"
        AND "ai_organization_cost_windows"."reserved_micros" + "ai_organization_cost_windows"."settled_micros" <= "ai_organization_cost_windows"."cap_micros"
        AND "ai_organization_cost_windows"."cap_micros" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_organization_cost_windows"."window_start" = date_trunc('month', "ai_organization_cost_windows"."window_start"))
);
--> statement-breakpoint
CREATE TABLE "ai_property_aggregate_contributions" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"calendar_profile_version" varchar(100) NOT NULL,
	"local_date" date NOT NULL,
	"status" varchar(20) NOT NULL,
	"rating" integer NOT NULL,
	"sentiment" varchar(20),
	"primary_category" varchar(40),
	"attention" varchar(20),
	"applied_aggregate_revision" bigint NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_aggregate_contributions_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence"),
	CONSTRAINT "ai_property_aggregate_contributions_values_valid" CHECK ("ai_property_aggregate_contributions"."source_epoch" >= 0 AND "ai_property_aggregate_contributions"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contributions"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contributions"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_contributions"."property_profile_version" >= 1 AND "ai_property_aggregate_contributions"."rating" BETWEEN 1 AND 5 AND "ai_property_aggregate_contributions"."applied_aggregate_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_property_aggregate_contributions_result_valid" CHECK ((
        ("ai_property_aggregate_contributions"."status" = 'ready' AND "ai_property_aggregate_contributions"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_property_aggregate_contributions"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND "ai_property_aggregate_contributions"."attention" IN ('urgent', 'high', 'medium', 'low'))
        OR ("ai_property_aggregate_contributions"."status" = 'unavailable' AND "ai_property_aggregate_contributions"."sentiment" IS NULL AND "ai_property_aggregate_contributions"."primary_category" IS NULL AND "ai_property_aggregate_contributions"."attention" IS NULL)
      ))
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
	CONSTRAINT "ai_property_aggregate_heads_versions_valid" CHECK ("ai_property_aggregate_heads"."source_epoch" >= 0 AND "ai_property_aggregate_heads"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_heads"."property_profile_version" >= 1 AND "ai_property_aggregate_heads"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_aggregate_heads"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "ai_property_daily_aggregates" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"calendar_profile_version" varchar(100) NOT NULL,
	"aggregate_revision" bigint NOT NULL,
	"terminal_analysis_sequence" bigint NOT NULL,
	"review_count" integer NOT NULL,
	"rating_sum" integer NOT NULL,
	"positive_count" integer NOT NULL,
	"neutral_count" integer NOT NULL,
	"negative_count" integer NOT NULL,
	"mixed_count" integer NOT NULL,
	"service_count" integer NOT NULL,
	"staff_count" integer NOT NULL,
	"quality_count" integer NOT NULL,
	"value_count" integer NOT NULL,
	"cleanliness_count" integer NOT NULL,
	"wait_time_count" integer NOT NULL,
	"atmosphere_count" integer NOT NULL,
	"location_count" integer NOT NULL,
	"accessibility_count" integer NOT NULL,
	"other_count" integer NOT NULL,
	"urgent_count" integer NOT NULL,
	"high_count" integer NOT NULL,
	"medium_count" integer NOT NULL,
	"low_count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_daily_aggregates_pk" PRIMARY KEY("organization_id","property_id","local_date","source_epoch","review_analysis_epoch","property_profile_version"),
	CONSTRAINT "ai_property_daily_aggregates_versions_valid" CHECK ("ai_property_daily_aggregates"."source_epoch" >= 0 AND "ai_property_daily_aggregates"."review_analysis_epoch" >= 1 AND "ai_property_daily_aggregates"."property_profile_version" >= 1 AND "ai_property_daily_aggregates"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_daily_aggregates"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_property_daily_aggregates_counts_nonnegative" CHECK ("ai_property_daily_aggregates"."review_count" >= 0 AND "ai_property_daily_aggregates"."rating_sum" >= 0 AND "ai_property_daily_aggregates"."positive_count" >= 0 AND "ai_property_daily_aggregates"."neutral_count" >= 0 AND "ai_property_daily_aggregates"."negative_count" >= 0 AND "ai_property_daily_aggregates"."mixed_count" >= 0 AND "ai_property_daily_aggregates"."service_count" >= 0 AND "ai_property_daily_aggregates"."staff_count" >= 0 AND "ai_property_daily_aggregates"."quality_count" >= 0 AND "ai_property_daily_aggregates"."value_count" >= 0 AND "ai_property_daily_aggregates"."cleanliness_count" >= 0 AND "ai_property_daily_aggregates"."wait_time_count" >= 0 AND "ai_property_daily_aggregates"."atmosphere_count" >= 0 AND "ai_property_daily_aggregates"."location_count" >= 0 AND "ai_property_daily_aggregates"."accessibility_count" >= 0 AND "ai_property_daily_aggregates"."other_count" >= 0 AND "ai_property_daily_aggregates"."urgent_count" >= 0 AND "ai_property_daily_aggregates"."high_count" >= 0 AND "ai_property_daily_aggregates"."medium_count" >= 0 AND "ai_property_daily_aggregates"."low_count" >= 0),
	CONSTRAINT "ai_property_daily_aggregates_count_sums_valid" CHECK ("ai_property_daily_aggregates"."positive_count" + "ai_property_daily_aggregates"."neutral_count" + "ai_property_daily_aggregates"."negative_count" + "ai_property_daily_aggregates"."mixed_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."service_count" + "ai_property_daily_aggregates"."staff_count" + "ai_property_daily_aggregates"."quality_count" + "ai_property_daily_aggregates"."value_count" + "ai_property_daily_aggregates"."cleanliness_count" + "ai_property_daily_aggregates"."wait_time_count" + "ai_property_daily_aggregates"."atmosphere_count" + "ai_property_daily_aggregates"."location_count" + "ai_property_daily_aggregates"."accessibility_count" + "ai_property_daily_aggregates"."other_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."urgent_count" + "ai_property_daily_aggregates"."high_count" + "ai_property_daily_aggregates"."medium_count" + "ai_property_daily_aggregates"."low_count" = "ai_property_daily_aggregates"."review_count" AND "ai_property_daily_aggregates"."rating_sum" <= "ai_property_daily_aggregates"."review_count" * 5)
);
--> statement-breakpoint
CREATE TABLE "ai_property_processing_profiles" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"country_code" varchar(2) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"processing_region" varchar(20) NOT NULL,
	"routing_policy_version" integer NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"source_epoch" integer NOT NULL,
	"profile_version" integer NOT NULL,
	"lifecycle_state" varchar(20) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_property_profiles_country_valid" CHECK ("ai_property_processing_profiles"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "ai_property_profiles_timezone_valid" CHECK (length("ai_property_processing_profiles"."timezone") BETWEEN 1 AND 64),
	CONSTRAINT "ai_property_profiles_region_valid" CHECK ("ai_property_processing_profiles"."processing_region" = 'global'),
	CONSTRAINT "ai_property_profiles_versions_valid" CHECK ("ai_property_processing_profiles"."source_epoch" >= 0 AND "ai_property_processing_profiles"."profile_version" >= 1),
	CONSTRAINT "ai_property_profiles_lifecycle_valid" CHECK ("ai_property_processing_profiles"."lifecycle_state" IN ('active', 'deleting'))
);
--> statement-breakpoint
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
	"definition_version" varchar(100),
	"definition_digest" varchar(64),
	"evidence" jsonb,
	"provider_selection_recorded_at" timestamp with time zone,
	"recorded_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "ai_property_trend_outcomes_valid" CHECK ((
        "ai_property_trend_outcomes"."disposition" = 'ready'
        AND ("ai_property_trend_outcomes"."operation_id" IS NOT NULL OR "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL)
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
        AND (
          ("ai_property_trend_outcomes"."definition_version" IS NULL AND "ai_property_trend_outcomes"."definition_digest" IS NULL AND "ai_property_trend_outcomes"."evidence" IS NULL)
          OR ("ai_property_trend_outcomes"."definition_version" = 'property-trend-definition-v1'
            AND "ai_property_trend_outcomes"."definition_digest" ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof("ai_property_trend_outcomes"."evidence") = 'object')
        )
        AND (
          ("ai_property_trend_outcomes"."operation_id" IS NOT NULL
            AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NOT NULL
            AND "ai_property_trend_outcomes"."recorded_at" = "ai_property_trend_outcomes"."provider_selection_recorded_at")
          OR ("ai_property_trend_outcomes"."operation_id" IS NULL AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL)
        )
        AND "ai_property_trend_outcomes"."expires_at" > "ai_property_trend_outcomes"."recorded_at"
      ) OR (
        "ai_property_trend_outcomes"."disposition" IN ('updating', 'insufficient_data', 'no_material_change')
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
        AND (
          ("ai_property_trend_outcomes"."definition_version" IS NULL AND "ai_property_trend_outcomes"."definition_digest" IS NULL AND "ai_property_trend_outcomes"."evidence" IS NULL AND "ai_property_trend_outcomes"."expires_at" IS NULL)
          OR ("ai_property_trend_outcomes"."definition_version" = 'property-trend-definition-v1'
            AND "ai_property_trend_outcomes"."definition_digest" ~ '^[0-9a-f]{64}$'
            AND jsonb_typeof("ai_property_trend_outcomes"."evidence") = 'object'
            AND "ai_property_trend_outcomes"."expires_at" > "ai_property_trend_outcomes"."recorded_at")
        )
        AND "ai_property_trend_outcomes"."provider_selection_recorded_at" IS NULL
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
	CONSTRAINT "ai_property_trend_schedules_versions_valid" CHECK ("ai_property_trend_schedules"."source_epoch" >= 0 AND "ai_property_trend_schedules"."review_analysis_epoch" >= 1 AND "ai_property_trend_schedules"."property_trends_epoch" >= 1
        AND "ai_property_trend_schedules"."property_profile_version" >= 1 AND "ai_property_trend_schedules"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."scheduler_generation" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$')
);
--> statement-breakpoint
CREATE TABLE "ai_review_analyses" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"analysis_sequence" bigint NOT NULL,
	"operation_id" uuid NOT NULL,
	"authorization_lineage_id" uuid NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"property_profile_version" integer NOT NULL,
	"analysis_profile_version" varchar(100) NOT NULL,
	"status" varchar(20) NOT NULL,
	"unavailable_reason" varchar(40),
	"sentiment" varchar(20),
	"primary_category" varchar(40),
	"attention" varchar(20),
	"generated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_review_analyses_pk" PRIMARY KEY("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence"),
	CONSTRAINT "ai_review_analyses_versions_valid" CHECK ("ai_review_analyses"."source_epoch" >= 0 AND "ai_review_analyses"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analyses"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analyses"."review_analysis_epoch" >= 1 AND "ai_review_analyses"."property_profile_version" >= 1),
	CONSTRAINT "ai_review_analyses_result_valid" CHECK ((
        ("ai_review_analyses"."status" = 'ready' AND "ai_review_analyses"."unavailable_reason" IS NULL AND "ai_review_analyses"."sentiment" IN ('positive', 'neutral', 'negative', 'mixed') AND "ai_review_analyses"."primary_category" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other') AND "ai_review_analyses"."attention" IN ('urgent', 'high', 'medium', 'low'))
        OR ("ai_review_analyses"."status" = 'unavailable' AND "ai_review_analyses"."unavailable_reason" = 'language_not_supported' AND "ai_review_analyses"."sentiment" IS NULL AND "ai_review_analyses"."primary_category" IS NULL AND "ai_review_analyses"."attention" IS NULL)
      )),
	CONSTRAINT "ai_review_analyses_retention_valid" CHECK ("ai_review_analyses"."expires_at" > "ai_review_analyses"."generated_at")
);
--> statement-breakpoint
CREATE TABLE "ai_review_analysis_enrollments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"authorization_lineage_id" uuid NOT NULL,
	"authorization_state_version" integer NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"analysis_start_sequence" bigint NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"trigger_event_envelope_id" uuid NOT NULL,
	"state" varchar(32) NOT NULL,
	"snapshot_revision_count" bigint NOT NULL,
	"snapshot_revision_set_digest" varchar(64) NOT NULL,
	"snapshot_captured_at" timestamp with time zone NOT NULL,
	"safety_ceiling" integer DEFAULT 10000 NOT NULL,
	"assisted_approval_required" boolean DEFAULT false NOT NULL,
	"assisted_approved_at" timestamp with time zone,
	"assisted_approved_by" varchar(255),
	"assisted_approval_evidence_digest" varchar(64),
	"assisted_approval_correlation_id" uuid,
	"enrolled_revision_count" bigint DEFAULT 0 NOT NULL,
	"caught_up_eligible_revision_count" bigint,
	"caught_up_analysis_sequence" bigint,
	"caught_up_revision_set_digest" varchar(64),
	"caught_up_at" timestamp with time zone,
	"terminal_reason" varchar(64),
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_analysis_enrollments_state_valid" CHECK ("ai_review_analysis_enrollments"."state" IN ('awaiting_assisted_approval', 'queued', 'running', 'caught_up', 'superseded', 'stalled')),
	CONSTRAINT "ai_review_analysis_enrollments_fence_safe" CHECK ("ai_review_analysis_enrollments"."authorization_state_version" BETWEEN 1 AND 2147483647
        AND "ai_review_analysis_enrollments"."source_epoch" BETWEEN 0 AND 2147483647
        AND "ai_review_analysis_enrollments"."review_analysis_epoch" BETWEEN 1 AND 2147483647
        AND "ai_review_analysis_enrollments"."analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_review_analysis_enrollments_snapshot_valid" CHECK ("ai_review_analysis_enrollments"."snapshot_revision_count" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollments"."snapshot_revision_set_digest" ~ '^[0-9a-f]{64}$'
        AND (
          ("ai_review_analysis_enrollments"."snapshot_revision_count" = 0 AND "ai_review_analysis_enrollments"."snapshot_revision_set_digest" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
          OR ("ai_review_analysis_enrollments"."snapshot_revision_count" > 0 AND "ai_review_analysis_enrollments"."snapshot_revision_set_digest" <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        )
        AND "ai_review_analysis_enrollments"."enrolled_revision_count" BETWEEN 0 AND "ai_review_analysis_enrollments"."snapshot_revision_count"),
	CONSTRAINT "ai_review_analysis_enrollments_assisted_approval_valid" CHECK ("ai_review_analysis_enrollments"."safety_ceiling" = 10000
        AND "ai_review_analysis_enrollments"."assisted_approval_required" = ("ai_review_analysis_enrollments"."snapshot_revision_count" > "ai_review_analysis_enrollments"."safety_ceiling")
        AND (
          ("ai_review_analysis_enrollments"."assisted_approved_at" IS NULL
            AND "ai_review_analysis_enrollments"."assisted_approved_by" IS NULL
            AND "ai_review_analysis_enrollments"."assisted_approval_evidence_digest" IS NULL
            AND "ai_review_analysis_enrollments"."assisted_approval_correlation_id" IS NULL)
          OR ("ai_review_analysis_enrollments"."assisted_approval_required"
            AND "ai_review_analysis_enrollments"."assisted_approved_at" IS NOT NULL
            AND length("ai_review_analysis_enrollments"."assisted_approved_by") BETWEEN 1 AND 255
            AND btrim("ai_review_analysis_enrollments"."assisted_approved_by") = "ai_review_analysis_enrollments"."assisted_approved_by"
            AND "ai_review_analysis_enrollments"."assisted_approval_evidence_digest" ~ '^[0-9a-f]{64}$'
            AND "ai_review_analysis_enrollments"."assisted_approval_correlation_id" IS NOT NULL)
        )
        AND (
          ("ai_review_analysis_enrollments"."state" = 'awaiting_assisted_approval'
            AND "ai_review_analysis_enrollments"."assisted_approval_required"
            AND "ai_review_analysis_enrollments"."assisted_approved_at" IS NULL)
          OR ("ai_review_analysis_enrollments"."state" IN ('queued', 'running', 'caught_up')
            AND (NOT "ai_review_analysis_enrollments"."assisted_approval_required" OR "ai_review_analysis_enrollments"."assisted_approved_at" IS NOT NULL))
          OR "ai_review_analysis_enrollments"."state" IN ('superseded', 'stalled')
        )),
	CONSTRAINT "ai_review_analysis_enrollments_terminal_valid" CHECK ((
        "ai_review_analysis_enrollments"."state" IN ('awaiting_assisted_approval', 'queued', 'running')
        AND "ai_review_analysis_enrollments"."caught_up_eligible_revision_count" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_analysis_sequence" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_at" IS NULL
        AND "ai_review_analysis_enrollments"."terminal_reason" IS NULL
        AND "ai_review_analysis_enrollments"."terminal_at" IS NULL
      ) OR (
        "ai_review_analysis_enrollments"."state" = 'caught_up'
        AND "ai_review_analysis_enrollments"."caught_up_eligible_revision_count" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollments"."caught_up_analysis_sequence" BETWEEN "ai_review_analysis_enrollments"."analysis_start_sequence" AND '9007199254740991'::bigint
        AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" ~ '^[0-9a-f]{64}$'
        AND (
          ("ai_review_analysis_enrollments"."caught_up_eligible_revision_count" = 0 AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
          OR ("ai_review_analysis_enrollments"."caught_up_eligible_revision_count" > 0 AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" <> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
        )
        AND "ai_review_analysis_enrollments"."caught_up_at" IS NOT NULL
        AND "ai_review_analysis_enrollments"."terminal_reason" = 'eligible_revision_set_caught_up'
        AND "ai_review_analysis_enrollments"."terminal_at" = "ai_review_analysis_enrollments"."caught_up_at"
      ) OR (
        "ai_review_analysis_enrollments"."state" IN ('superseded', 'stalled')
        AND "ai_review_analysis_enrollments"."caught_up_eligible_revision_count" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_analysis_sequence" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_revision_set_digest" IS NULL
        AND "ai_review_analysis_enrollments"."caught_up_at" IS NULL
        AND "ai_review_analysis_enrollments"."terminal_reason" ~ '^[a-z][a-z0-9_]{2,63}$'
        AND "ai_review_analysis_enrollments"."terminal_at" IS NOT NULL
      )),
	CONSTRAINT "ai_review_analysis_enrollments_time_valid" CHECK ("ai_review_analysis_enrollments"."snapshot_captured_at" >= "ai_review_analysis_enrollments"."created_at"
        AND "ai_review_analysis_enrollments"."updated_at" >= "ai_review_analysis_enrollments"."created_at"
        AND ("ai_review_analysis_enrollments"."caught_up_at" IS NULL OR "ai_review_analysis_enrollments"."caught_up_at" >= "ai_review_analysis_enrollments"."snapshot_captured_at")
        AND ("ai_review_analysis_enrollments"."assisted_approved_at" IS NULL OR "ai_review_analysis_enrollments"."assisted_approved_at" >= "ai_review_analysis_enrollments"."snapshot_captured_at")
        AND ("ai_review_analysis_enrollments"."terminal_at" IS NULL OR "ai_review_analysis_enrollments"."terminal_at" >= "ai_review_analysis_enrollments"."snapshot_captured_at"))
);
--> statement-breakpoint
CREATE TABLE "operational_action_history_heads" (
	"organization_id" varchar(255) PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_recorded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_action_history_heads_sequence_nonnegative" CHECK ("operational_action_history_heads"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operational_action_history_legal_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"reason_code" varchar(128) NOT NULL,
	"protects_from" timestamp with time zone NOT NULL,
	"protects_through" timestamp with time zone,
	"placed_at" timestamp with time zone NOT NULL,
	"placed_by_actor_id" varchar(255) NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_actor_id" varchar(255),
	"release_reason_code" varchar(128),
	CONSTRAINT "operational_action_history_hold_interval_valid" CHECK ("operational_action_history_legal_holds"."protects_through" IS NULL OR "operational_action_history_legal_holds"."protects_through" >= "operational_action_history_legal_holds"."protects_from"),
	CONSTRAINT "operational_action_history_hold_release_valid" CHECK (("operational_action_history_legal_holds"."released_at" IS NULL AND "operational_action_history_legal_holds"."released_by_actor_id" IS NULL AND "operational_action_history_legal_holds"."release_reason_code" IS NULL) OR ("operational_action_history_legal_holds"."released_at" IS NOT NULL AND "operational_action_history_legal_holds"."released_by_actor_id" IS NOT NULL AND "operational_action_history_legal_holds"."release_reason_code" IS NOT NULL AND "operational_action_history_legal_holds"."released_at" >= "operational_action_history_legal_holds"."placed_at")),
	CONSTRAINT "operational_action_history_hold_identifiers_valid" CHECK ("operational_action_history_legal_holds"."reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND "operational_action_history_legal_holds"."placed_by_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$' AND ("operational_action_history_legal_holds"."released_by_actor_id" IS NULL OR "operational_action_history_legal_holds"."released_by_actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND ("operational_action_history_legal_holds"."release_reason_code" IS NULL OR "operational_action_history_legal_holds"."release_reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$'))
);
--> statement-breakpoint
CREATE TABLE "operational_action_history_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"sequence" bigint NOT NULL,
	"property_id" varchar(255),
	"actor_type" varchar(16) NOT NULL,
	"actor_id" varchar(255),
	"actor_redacted_at" timestamp with time zone,
	"action" varchar(80) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" varchar(255),
	"resource_redacted_at" timestamp with time zone,
	"reason_code" varchar(128),
	"provenance_kind" varchar(32) NOT NULL,
	"provenance_id" varchar(255) NOT NULL,
	"source_event_type" varchar(128),
	"source_event_version" integer,
	"source_context" varchar(128),
	"source_aggregate_id" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "operational_action_history_sequence_positive" CHECK ("operational_action_history_records"."sequence" >= 1),
	CONSTRAINT "operational_action_history_outcome_valid" CHECK ("operational_action_history_records"."outcome" IN ('succeeded', 'denied', 'failed')),
	CONSTRAINT "operational_action_history_actor_valid" CHECK (("operational_action_history_records"."actor_type" IN ('user', 'operator', 'service') AND ("operational_action_history_records"."actor_id" IS NOT NULL OR "operational_action_history_records"."actor_redacted_at" IS NOT NULL)) OR ("operational_action_history_records"."actor_type" IN ('system', 'public') AND "operational_action_history_records"."actor_id" IS NULL AND "operational_action_history_records"."actor_redacted_at" IS NULL)),
	CONSTRAINT "operational_action_history_resource_valid" CHECK ("operational_action_history_records"."resource_id" IS NOT NULL OR "operational_action_history_records"."resource_redacted_at" IS NOT NULL OR "operational_action_history_records"."action" IN ('authentication.decision', 'authorization.decision')),
	CONSTRAINT "operational_action_history_identifier_shape" CHECK (("operational_action_history_records"."actor_id" IS NULL OR "operational_action_history_records"."actor_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND ("operational_action_history_records"."resource_id" IS NULL OR "operational_action_history_records"."resource_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') AND "operational_action_history_records"."provenance_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$' AND ("operational_action_history_records"."reason_code" IS NULL OR "operational_action_history_records"."reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$')),
	CONSTRAINT "operational_action_history_provenance_valid" CHECK (("operational_action_history_records"."provenance_kind" = 'domain_fact' AND "operational_action_history_records"."source_event_type" ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND "operational_action_history_records"."source_event_version" >= 1 AND "operational_action_history_records"."source_context" ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND "operational_action_history_records"."source_aggregate_id" ~ '^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,254}$') OR ("operational_action_history_records"."provenance_kind" IN ('policy_decision', 'interactive_command', 'worker_command', 'operator_command', 'history_access', 'history_lifecycle') AND "operational_action_history_records"."source_event_type" IS NULL AND "operational_action_history_records"."source_event_version" IS NULL AND "operational_action_history_records"."source_context" IS NULL AND "operational_action_history_records"."source_aggregate_id" IS NULL)),
	CONSTRAINT "operational_action_history_kind_valid" CHECK (("operational_action_history_records"."action" = 'authentication.decision' AND "operational_action_history_records"."resource_type" = 'account') OR ("operational_action_history_records"."action" = 'authorization.decision' AND "operational_action_history_records"."resource_type" = 'policy') OR ("operational_action_history_records"."action" = 'member.role_changed' AND "operational_action_history_records"."resource_type" = 'member') OR ("operational_action_history_records"."action" = 'property_access.changed' AND "operational_action_history_records"."resource_type" = 'property_grant') OR ("operational_action_history_records"."action" = 'sensitive_data.accessed' AND "operational_action_history_records"."resource_type" = 'data_export') OR ("operational_action_history_records"."action" = 'sensitive_data.exported' AND "operational_action_history_records"."resource_type" = 'data_export') OR ("operational_action_history_records"."action" = 'capability.changed' AND "operational_action_history_records"."resource_type" = 'capability') OR ("operational_action_history_records"."action" = 'policy.changed' AND "operational_action_history_records"."resource_type" = 'policy') OR ("operational_action_history_records"."action" = 'google_connection.connected' AND "operational_action_history_records"."resource_type" = 'google_connection') OR ("operational_action_history_records"."action" = 'google_connection.disconnected' AND "operational_action_history_records"."resource_type" = 'google_connection') OR ("operational_action_history_records"."action" = 'google_reply.published' AND "operational_action_history_records"."resource_type" = 'reply') OR ("operational_action_history_records"."action" = 'guest_feedback.moderated' AND "operational_action_history_records"."resource_type" = 'feedback') OR ("operational_action_history_records"."action" = 'portal_upload.validated' AND "operational_action_history_records"."resource_type" = 'upload') OR ("operational_action_history_records"."action" = 'privacy_request.received' AND "operational_action_history_records"."resource_type" = 'privacy_request') OR ("operational_action_history_records"."action" = 'privacy_request.fulfilled' AND "operational_action_history_records"."resource_type" = 'privacy_request') OR ("operational_action_history_records"."action" = 'property.archived' AND "operational_action_history_records"."resource_type" = 'property') OR ("operational_action_history_records"."action" = 'property.restored' AND "operational_action_history_records"."resource_type" = 'property') OR ("operational_action_history_records"."action" = 'property.deleted' AND "operational_action_history_records"."resource_type" = 'property') OR ("operational_action_history_records"."action" = 'portal.archived' AND "operational_action_history_records"."resource_type" = 'portal') OR ("operational_action_history_records"."action" = 'portal.published' AND "operational_action_history_records"."resource_type" = 'portal') OR ("operational_action_history_records"."action" = 'operator.command_executed' AND "operational_action_history_records"."resource_type" = 'operator_command') OR ("operational_action_history_records"."action" = 'operational_history.accessed' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.exported' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.legal_hold_placed' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.legal_hold_released' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.redaction_applied' AND "operational_action_history_records"."resource_type" = 'operational_history') OR ("operational_action_history_records"."action" = 'operational_history.retention_assessed' AND "operational_action_history_records"."resource_type" = 'operational_history')),
	CONSTRAINT "operational_action_history_time_valid" CHECK ("operational_action_history_records"."recorded_at" >= "operational_action_history_records"."occurred_at" AND ("operational_action_history_records"."actor_redacted_at" IS NULL OR "operational_action_history_records"."actor_redacted_at" >= "operational_action_history_records"."recorded_at") AND ("operational_action_history_records"."resource_redacted_at" IS NULL OR "operational_action_history_records"."resource_redacted_at" >= "operational_action_history_records"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "recent_activity_actor_label_redactions" (
	"organization_id" varchar(255) NOT NULL,
	"actor_subject_id" varchar(255) NOT NULL,
	"redacted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "recent_activity_actor_label_redactions_pk" PRIMARY KEY("organization_id","actor_subject_id"),
	CONSTRAINT "recent_activity_actor_label_redactions_interval_check" CHECK ("recent_activity_actor_label_redactions"."expires_at" > "recent_activity_actor_label_redactions"."redacted_at")
);
--> statement-breakpoint
CREATE TABLE "recent_activity_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"actor_name" varchar(255) NOT NULL,
	"actor_avatar_url" text,
	"actor_role" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"property_id" varchar(255),
	"organization_id" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_id" varchar(255),
	"source" varchar(20) DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recent_activity_replay_facts" (
	"replay_key" varchar(600) PRIMARY KEY NOT NULL,
	"projection_id" uuid,
	"source_kind" varchar(40) NOT NULL,
	"disposition" varchar(16) NOT NULL,
	"source_event_id" varchar(255),
	"source_event_type" text,
	"source_event_version" integer,
	"source_context" text,
	"source_aggregate_id" text,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255),
	"actor_subject_id" varchar(255),
	"actor_label_redacted_at" timestamp with time zone,
	"action" varchar(50),
	"resource_type" varchar(50),
	"resource_id" varchar(255),
	"transition_payload" jsonb,
	"source" varchar(20),
	"source_occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_activity_replay_source_kind_check" CHECK ("recent_activity_replay_facts"."source_kind" IN ('durable_fact', 'legacy_projection_snapshot')),
	CONSTRAINT "recent_activity_replay_disposition_check" CHECK ("recent_activity_replay_facts"."disposition" IN ('projectable', 'obsolete')),
	CONSTRAINT "recent_activity_replay_durable_source_check" CHECK (("recent_activity_replay_facts"."source_kind" = 'durable_fact' AND "recent_activity_replay_facts"."source_event_id" IS NOT NULL AND "recent_activity_replay_facts"."source_event_type" IS NOT NULL AND "recent_activity_replay_facts"."source_event_version" >= 1 AND "recent_activity_replay_facts"."source_context" IS NOT NULL AND "recent_activity_replay_facts"."source_aggregate_id" IS NOT NULL) OR ("recent_activity_replay_facts"."source_kind" = 'legacy_projection_snapshot' AND "recent_activity_replay_facts"."disposition" = 'projectable' AND "recent_activity_replay_facts"."source_event_type" IS NULL AND "recent_activity_replay_facts"."source_event_version" IS NULL AND "recent_activity_replay_facts"."source_context" IS NULL AND "recent_activity_replay_facts"."source_aggregate_id" IS NULL)),
	CONSTRAINT "recent_activity_replay_projection_check" CHECK (("recent_activity_replay_facts"."disposition" = 'projectable' AND "recent_activity_replay_facts"."projection_id" IS NOT NULL AND "recent_activity_replay_facts"."action" IS NOT NULL AND "recent_activity_replay_facts"."resource_type" IS NOT NULL AND "recent_activity_replay_facts"."resource_id" IS NOT NULL AND "recent_activity_replay_facts"."transition_payload" IS NOT NULL AND "recent_activity_replay_facts"."source" IN ('web', 'import')) OR ("recent_activity_replay_facts"."disposition" = 'obsolete' AND "recent_activity_replay_facts"."projection_id" IS NULL AND "recent_activity_replay_facts"."actor_subject_id" IS NULL AND "recent_activity_replay_facts"."action" IS NULL AND "recent_activity_replay_facts"."resource_type" IS NULL AND "recent_activity_replay_facts"."resource_id" IS NULL AND "recent_activity_replay_facts"."transition_payload" IS NULL AND "recent_activity_replay_facts"."source" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"details" jsonb,
	"success" boolean DEFAULT true NOT NULL,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beta_feedback_triage" (
	"reference" uuid PRIMARY KEY NOT NULL,
	"organization_pseudonym" char(64) NOT NULL,
	"actor_pseudonym" char(64) NOT NULL,
	"feedback_type" varchar(16) NOT NULL,
	"impact_code" varchar(32) NOT NULL,
	"route_key" varchar(80) NOT NULL,
	"viewport" varchar(16) NOT NULL,
	"reporter_role" varchar(32) NOT NULL,
	"delivery_state" varchar(16) NOT NULL,
	"provider_reference" varchar(64),
	"delivery_failure_code" varchar(48),
	"attachment_kind" varchar(32) NOT NULL,
	"attachment_captured_at" timestamp with time zone,
	"attachment_expires_at" timestamp with time zone,
	"triage_state" varchar(24) DEFAULT 'new' NOT NULL,
	"severity" varchar(16) DEFAULT 'unclassified' NOT NULL,
	"privacy_class" varchar(16) DEFAULT 'pending' NOT NULL,
	"security_class" varchar(16) DEFAULT 'pending' NOT NULL,
	"reproduction" varchar(24) DEFAULT 'pending' NOT NULL,
	"dedupe_disposition" varchar(16) DEFAULT 'pending' NOT NULL,
	"duplicate_of_reference" uuid,
	"owner_queue" varchar(24) DEFAULT 'beta_support' NOT NULL,
	"owner_pseudonym" char(64),
	"customer_response" varchar(24) DEFAULT 'pending' NOT NULL,
	"engineering_issue_ref" varchar(200),
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_feedback_triage_pseudonyms_valid" CHECK ("beta_feedback_triage"."organization_pseudonym" ~ '^[a-f0-9]{64}$' AND "beta_feedback_triage"."actor_pseudonym" ~ '^[a-f0-9]{64}$' AND ("beta_feedback_triage"."owner_pseudonym" IS NULL OR "beta_feedback_triage"."owner_pseudonym" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "beta_feedback_triage_feedback_type_valid" CHECK ("beta_feedback_triage"."feedback_type" IN ('bug', 'suggestion')),
	CONSTRAINT "beta_feedback_triage_impact_valid" CHECK ("beta_feedback_triage"."impact_code" IN ('cannot_complete', 'workaround_available', 'small_issue', 'important', 'helpful', 'nice_to_have')),
	CONSTRAINT "beta_feedback_triage_viewport_valid" CHECK ("beta_feedback_triage"."viewport" IN ('compact', 'regular', 'wide')),
	CONSTRAINT "beta_feedback_triage_reporter_role_valid" CHECK ("beta_feedback_triage"."reporter_role" IN ('AccountAdmin', 'PropertyManager', 'Staff')),
	CONSTRAINT "beta_feedback_triage_delivery_valid" CHECK ("beta_feedback_triage"."delivery_state" IN ('prepared', 'delivered', 'failed')),
	CONSTRAINT "beta_feedback_triage_delivery_shape" CHECK (("beta_feedback_triage"."delivery_state" = 'prepared' AND "beta_feedback_triage"."provider_reference" IS NULL AND "beta_feedback_triage"."delivery_failure_code" IS NULL)
        OR ("beta_feedback_triage"."delivery_state" = 'delivered' AND "beta_feedback_triage"."provider_reference" ~ '^[a-f0-9]{32,64}$' AND "beta_feedback_triage"."delivery_failure_code" IS NULL)
        OR ("beta_feedback_triage"."delivery_state" = 'failed' AND "beta_feedback_triage"."provider_reference" IS NULL AND "beta_feedback_triage"."delivery_failure_code" ~ '^[a-z][a-z0-9_]{0,47}$')),
	CONSTRAINT "beta_feedback_triage_attachment_kind_valid" CHECK ("beta_feedback_triage"."attachment_kind" IN ('none', 'masked_layout_v1')),
	CONSTRAINT "beta_feedback_triage_attachment_shape" CHECK (("beta_feedback_triage"."attachment_kind" = 'none' AND "beta_feedback_triage"."attachment_captured_at" IS NULL AND "beta_feedback_triage"."attachment_expires_at" IS NULL)
        OR ("beta_feedback_triage"."attachment_kind" = 'masked_layout_v1'
          AND "beta_feedback_triage"."feedback_type" = 'bug'
          AND "beta_feedback_triage"."attachment_captured_at" IS NOT NULL
          AND "beta_feedback_triage"."attachment_expires_at" > "beta_feedback_triage"."attachment_captured_at"
          AND "beta_feedback_triage"."attachment_expires_at" <= "beta_feedback_triage"."attachment_captured_at" + interval '30 days')),
	CONSTRAINT "beta_feedback_triage_state_valid" CHECK ("beta_feedback_triage"."triage_state" IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved')),
	CONSTRAINT "beta_feedback_triage_severity_valid" CHECK ("beta_feedback_triage"."severity" IN ('unclassified', 'P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "beta_feedback_triage_privacy_valid" CHECK ("beta_feedback_triage"."privacy_class" IN ('pending', 'clear', 'restricted', 'escalated')),
	CONSTRAINT "beta_feedback_triage_security_valid" CHECK ("beta_feedback_triage"."security_class" IN ('pending', 'none', 'suspected', 'confirmed')),
	CONSTRAINT "beta_feedback_triage_reproduction_valid" CHECK ("beta_feedback_triage"."reproduction" IN ('pending', 'reproduced', 'not_reproduced', 'not_applicable')),
	CONSTRAINT "beta_feedback_triage_dedupe_valid" CHECK ("beta_feedback_triage"."dedupe_disposition" IN ('pending', 'unique', 'duplicate') AND (("beta_feedback_triage"."dedupe_disposition" = 'duplicate' AND "beta_feedback_triage"."duplicate_of_reference" IS NOT NULL AND "beta_feedback_triage"."duplicate_of_reference" <> "beta_feedback_triage"."reference") OR ("beta_feedback_triage"."dedupe_disposition" <> 'duplicate' AND "beta_feedback_triage"."duplicate_of_reference" IS NULL))),
	CONSTRAINT "beta_feedback_triage_owner_valid" CHECK ("beta_feedback_triage"."owner_queue" IN ('beta_support', 'privacy', 'security', 'engineering')),
	CONSTRAINT "beta_feedback_triage_customer_response_valid" CHECK ("beta_feedback_triage"."customer_response" IN ('pending', 'not_required', 'sent')),
	CONSTRAINT "beta_feedback_triage_issue_ref_valid" CHECK ("beta_feedback_triage"."engineering_issue_ref" IS NULL OR "beta_feedback_triage"."engineering_issue_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "beta_feedback_triage_classification_shape" CHECK ("beta_feedback_triage"."triage_state" = 'new' OR ("beta_feedback_triage"."severity" <> 'unclassified' AND "beta_feedback_triage"."privacy_class" <> 'pending' AND "beta_feedback_triage"."security_class" <> 'pending' AND "beta_feedback_triage"."owner_pseudonym" IS NOT NULL)),
	CONSTRAINT "beta_feedback_triage_security_owner_shape" CHECK ("beta_feedback_triage"."security_class" NOT IN ('suspected', 'confirmed') OR "beta_feedback_triage"."owner_queue" = 'security'),
	CONSTRAINT "beta_feedback_triage_privacy_owner_shape" CHECK ("beta_feedback_triage"."privacy_class" <> 'escalated' OR "beta_feedback_triage"."owner_queue" IN ('privacy', 'security')),
	CONSTRAINT "beta_feedback_triage_decision_shape" CHECK ("beta_feedback_triage"."triage_state" NOT IN ('accepted', 'declined', 'resolved') OR ("beta_feedback_triage"."reproduction" <> 'pending' AND "beta_feedback_triage"."dedupe_disposition" <> 'pending')),
	CONSTRAINT "beta_feedback_triage_issue_shape" CHECK ("beta_feedback_triage"."engineering_issue_ref" IS NULL OR "beta_feedback_triage"."triage_state" IN ('accepted', 'resolved')),
	CONSTRAINT "beta_feedback_triage_resolution_shape" CHECK ("beta_feedback_triage"."triage_state" <> 'resolved' OR "beta_feedback_triage"."customer_response" <> 'pending'),
	CONSTRAINT "beta_feedback_triage_revision_nonnegative" CHECK ("beta_feedback_triage"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "beta_feedback_triage_transitions" (
	"transition_id" uuid PRIMARY KEY NOT NULL,
	"feedback_reference" uuid NOT NULL,
	"from_state" varchar(24) NOT NULL,
	"to_state" varchar(24) NOT NULL,
	"result_revision" integer NOT NULL,
	"severity" varchar(16) NOT NULL,
	"privacy_class" varchar(16) NOT NULL,
	"security_class" varchar(16) NOT NULL,
	"reproduction" varchar(24) NOT NULL,
	"dedupe_disposition" varchar(16) NOT NULL,
	"duplicate_of_reference" uuid,
	"owner_queue" varchar(24) NOT NULL,
	"owner_pseudonym" char(64),
	"customer_response" varchar(24) NOT NULL,
	"engineering_issue_ref" varchar(200),
	"operator_pseudonym" char(64) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"support_evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_feedback_triage_transition_states_valid" CHECK ("beta_feedback_triage_transitions"."from_state" IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved') AND "beta_feedback_triage_transitions"."to_state" IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved')),
	CONSTRAINT "beta_feedback_triage_transition_revision_positive" CHECK ("beta_feedback_triage_transitions"."result_revision" > 0),
	CONSTRAINT "beta_feedback_triage_transition_operator_valid" CHECK ("beta_feedback_triage_transitions"."operator_pseudonym" ~ '^[a-f0-9]{64}$' AND ("beta_feedback_triage_transitions"."owner_pseudonym" IS NULL OR "beta_feedback_triage_transitions"."owner_pseudonym" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "beta_feedback_triage_transition_reason_valid" CHECK ("beta_feedback_triage_transitions"."reason_code" ~ '^[a-z][a-z0-9_]{0,63}$' AND "beta_feedback_triage_transitions"."support_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "beta_feedback_triage_transition_classification_shape" CHECK ("beta_feedback_triage_transitions"."severity" IN ('unclassified', 'P0', 'P1', 'P2', 'P3') AND "beta_feedback_triage_transitions"."privacy_class" IN ('pending', 'clear', 'restricted', 'escalated') AND "beta_feedback_triage_transitions"."security_class" IN ('pending', 'none', 'suspected', 'confirmed') AND "beta_feedback_triage_transitions"."reproduction" IN ('pending', 'reproduced', 'not_reproduced', 'not_applicable') AND "beta_feedback_triage_transitions"."owner_queue" IN ('beta_support', 'privacy', 'security', 'engineering') AND "beta_feedback_triage_transitions"."customer_response" IN ('pending', 'not_required', 'sent') AND ("beta_feedback_triage_transitions"."to_state" = 'new' OR ("beta_feedback_triage_transitions"."severity" <> 'unclassified' AND "beta_feedback_triage_transitions"."privacy_class" <> 'pending' AND "beta_feedback_triage_transitions"."security_class" <> 'pending' AND "beta_feedback_triage_transitions"."owner_pseudonym" IS NOT NULL))),
	CONSTRAINT "beta_feedback_triage_transition_dedupe_shape" CHECK ("beta_feedback_triage_transitions"."dedupe_disposition" IN ('pending', 'unique', 'duplicate') AND (("beta_feedback_triage_transitions"."dedupe_disposition" = 'duplicate' AND "beta_feedback_triage_transitions"."duplicate_of_reference" IS NOT NULL AND "beta_feedback_triage_transitions"."duplicate_of_reference" <> "beta_feedback_triage_transitions"."feedback_reference") OR ("beta_feedback_triage_transitions"."dedupe_disposition" <> 'duplicate' AND "beta_feedback_triage_transitions"."duplicate_of_reference" IS NULL))),
	CONSTRAINT "beta_feedback_triage_transition_owner_shape" CHECK (("beta_feedback_triage_transitions"."security_class" NOT IN ('suspected', 'confirmed') OR "beta_feedback_triage_transitions"."owner_queue" = 'security') AND ("beta_feedback_triage_transitions"."privacy_class" <> 'escalated' OR "beta_feedback_triage_transitions"."owner_queue" IN ('privacy', 'security'))),
	CONSTRAINT "beta_feedback_triage_transition_decision_shape" CHECK ("beta_feedback_triage_transitions"."to_state" NOT IN ('accepted', 'declined', 'resolved') OR ("beta_feedback_triage_transitions"."reproduction" <> 'pending' AND "beta_feedback_triage_transitions"."dedupe_disposition" <> 'pending')),
	CONSTRAINT "beta_feedback_triage_transition_issue_shape" CHECK ("beta_feedback_triage_transitions"."engineering_issue_ref" IS NULL OR ("beta_feedback_triage_transitions"."engineering_issue_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND "beta_feedback_triage_transitions"."to_state" IN ('accepted', 'resolved'))),
	CONSTRAINT "beta_feedback_triage_transition_resolution_shape" CHECK ("beta_feedback_triage_transitions"."to_state" <> 'resolved' OR "beta_feedback_triage_transitions"."customer_response" <> 'pending')
);
--> statement-breakpoint
CREATE TABLE "organization_role_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"data_scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_role_policy_data_scope_check" CHECK ("organization_role_policy"."data_scope" IN ('organization', 'assigned-properties', 'none')),
	CONSTRAINT "organization_role_policy_role_format_check" CHECK ("organization_role_policy"."role" ~ '^[a-z][a-z0-9-]{1,62}[a-z0-9]$'),
	CONSTRAINT "organization_role_policy_role_no_comma_check" CHECK (position(',' in "organization_role_policy"."role") = 0),
	CONSTRAINT "organization_role_policy_role_not_reserved_check" CHECK ("organization_role_policy"."role" NOT IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "permission_version" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	CONSTRAINT "goal_monthly_results_closed_check" CHECK (("goal_monthly_results"."status" = 'closed' AND "goal_monthly_results"."closed_at" IS NOT NULL AND "goal_monthly_results"."evaluation_watermark" IS NOT NULL AND "goal_monthly_results"."evaluation_state" <> 'updating') OR ("goal_monthly_results"."status" <> 'closed' AND "goal_monthly_results"."closed_at" IS NULL)),
	CONSTRAINT "goal_monthly_results_source_check" CHECK ((
        "goal_monthly_results"."source_complete_through" IS NULL OR "goal_monthly_results"."source_complete_through" <= "goal_monthly_results"."period_end"
      ) AND (
        "goal_monthly_results"."status" <> 'closed'
        OR "goal_monthly_results"."evaluation_state" NOT IN ('eligible', 'insufficient_data')
        OR "goal_monthly_results"."source_complete_through" = "goal_monthly_results"."period_end"
      ))
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
	CONSTRAINT "goal_program_versions_metric_version_check" CHECK ((
        ("goal_program_versions"."metric_key" = 'qualified_scans' AND "goal_program_versions"."metric_definition_version_id" = '11111111-1111-4111-8111-111111111301'::uuid)
        OR ("goal_program_versions"."metric_key" = 'portal_rating_count' AND "goal_program_versions"."metric_definition_version_id" = '11111111-1111-4111-8111-111111111302'::uuid)
        OR ("goal_program_versions"."metric_key" = 'portal_rating_average' AND "goal_program_versions"."metric_definition_version_id" = '11111111-1111-4111-8111-111111111303'::uuid)
      )),
	CONSTRAINT "goal_program_versions_sample_check" CHECK ((("goal_program_versions"."metric_key" IN ('qualified_scans', 'portal_rating_count') AND "goal_program_versions"."metric_minimum_sample" = 0) OR ("goal_program_versions"."metric_key" = 'portal_rating_average' AND "goal_program_versions"."metric_minimum_sample" = 10))),
	CONSTRAINT "goal_program_versions_target_check" CHECK ((("goal_program_versions"."metric_key" IN ('qualified_scans', 'portal_rating_count') AND "goal_program_versions"."target_value" > 0 AND "goal_program_versions"."target_value" = trunc("goal_program_versions"."target_value")) OR ("goal_program_versions"."metric_key" = 'portal_rating_average' AND "goal_program_versions"."target_value" BETWEEN 1 AND 5 AND "goal_program_versions"."target_value" * 10 = trunc("goal_program_versions"."target_value" * 10)))),
	CONSTRAINT "goal_program_versions_effective_check" CHECK ("goal_program_versions"."effective_to" IS NULL OR "goal_program_versions"."effective_to" >= "goal_program_versions"."effective_from"),
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
	CONSTRAINT "goal_subject_assignments_effective_check" CHECK ("goal_subject_assignments"."effective_to" IS NULL OR "goal_subject_assignments"."effective_to" >= "goal_subject_assignments"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"google_subject" varchar(255),
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"connected_by" varchar(255) NOT NULL,
	"credential_authorized_by" varchar(255),
	"credential_authorized_at" timestamp with time zone,
	"visibility" "connection_visibility" DEFAULT 'organization' NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"credential_use_state" "google_credential_use_state" DEFAULT 'active' NOT NULL,
	"cleanup_material_deadline_at" timestamp with time zone,
	"lifecycle_version" integer DEFAULT 1 NOT NULL,
	"access_version" integer DEFAULT 1 NOT NULL,
	"credential_generation" integer DEFAULT 1 NOT NULL,
	"encryption_key_id" varchar(50) DEFAULT 'v1' NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_connections_identity_check" CHECK ("google_connections"."google_subject" IS NOT NULL OR "google_connections"."status" = 'disconnected'),
	CONSTRAINT "google_connections_versions_check" CHECK ("google_connections"."lifecycle_version" >= 1 AND "google_connections"."access_version" >= 1 AND "google_connections"."credential_generation" >= 1),
	CONSTRAINT "google_connections_organization_owned_check" CHECK ("google_connections"."visibility" = 'organization')
);
--> statement-breakpoint
CREATE TABLE "google_import_discovery_records" (
	"reference_key" varchar(43) PRIMARY KEY NOT NULL,
	"key_version" varchar(32) NOT NULL,
	"audience" varchar(32) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"connection_id" uuid NOT NULL,
	"connection_lifecycle_version" integer NOT NULL,
	"connection_access_version" integer NOT NULL,
	"credential_generation" integer NOT NULL,
	"authorization_vector" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"affected_property_id" uuid,
	"remaining_redemptions" integer,
	"claim_request_id" uuid,
	"claimed_at" timestamp with time zone,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_import_discovery_records_key_valid" CHECK ("google_import_discovery_records"."reference_key" ~ '^[A-Za-z0-9_-]{43}$' AND "google_import_discovery_records"."key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'),
	CONSTRAINT "google_import_discovery_records_audience_valid" CHECK ("google_import_discovery_records"."audience" IN ('account_selection', 'accounts_cursor', 'locations_cursor', 'import_candidate')),
	CONSTRAINT "google_import_discovery_records_versions_valid" CHECK ("google_import_discovery_records"."connection_lifecycle_version" >= 1 AND "google_import_discovery_records"."connection_access_version" >= 1 AND "google_import_discovery_records"."credential_generation" >= 1),
	CONSTRAINT "google_import_discovery_records_window_valid" CHECK ("google_import_discovery_records"."expires_at" > "google_import_discovery_records"."issued_at" AND "google_import_discovery_records"."expires_at" <= "google_import_discovery_records"."issued_at" + interval '24 hours'),
	CONSTRAINT "google_import_discovery_records_cursor_budget_valid" CHECK ((
        ("google_import_discovery_records"."audience" IN ('accounts_cursor', 'locations_cursor') AND "google_import_discovery_records"."remaining_redemptions" BETWEEN 0 AND 50)
        OR ("google_import_discovery_records"."audience" NOT IN ('accounts_cursor', 'locations_cursor') AND "google_import_discovery_records"."remaining_redemptions" IS NULL)
      )),
	CONSTRAINT "google_import_discovery_records_claim_valid" CHECK (("google_import_discovery_records"."claim_request_id" IS NULL AND "google_import_discovery_records"."claimed_at" IS NULL) OR ("google_import_discovery_records"."audience" = 'import_candidate' AND "google_import_discovery_records"."claim_request_id" IS NOT NULL AND "google_import_discovery_records"."claimed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "gbp_import_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"import_job_id" uuid NOT NULL,
	"connection_id" uuid,
	"existing_property_id" uuid,
	"destination_property_id" uuid,
	"provider_account_suffix" varchar(255),
	"provider_location_suffix" varchar(255),
	"google_review_uri" varchar(2048),
	"expected_connection_lifecycle_version" integer,
	"expected_connection_access_version" integer,
	"expected_credential_generation" integer,
	"expected_execution_policy_version" varchar(32),
	"expected_actor_role" varchar(50),
	"expected_permission_digest" varchar(64),
	"expected_principal_kind" varchar(32),
	"expected_permission_version" integer,
	"expected_source_epoch" integer,
	"expected_profile_version" integer,
	"action" "google_import_v2_action" NOT NULL,
	"update_existing_profile" boolean NOT NULL,
	"property_name" varchar(100) NOT NULL,
	"property_address" text,
	"country_code" varchar(2),
	"timezone" varchar(64) NOT NULL,
	"status" "google_import_v2_item_status" DEFAULT 'pending' NOT NULL,
	"outcome_code" "google_import_v2_outcome",
	"effect_deadline_at" timestamp with time zone NOT NULL,
	"retry_revision" integer DEFAULT 0 NOT NULL,
	"highest_attempt_for_revision" integer DEFAULT 0 NOT NULL,
	"claim_fence" uuid,
	"claim_lease_expires_at" timestamp with time zone,
	"first_terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_request_items_profile_valid" CHECK ((
        char_length(btrim("gbp_import_request_items"."property_name")) BETWEEN 1 AND 100
        AND char_length("gbp_import_request_items"."timezone") BETWEEN 1 AND 64
        AND ("gbp_import_request_items"."country_code" IS NULL OR "gbp_import_request_items"."country_code" ~ '^[A-Z]{2}$')
        AND (
          (
          ("gbp_import_request_items"."action" = 'create' AND "gbp_import_request_items"."existing_property_id" IS NULL AND "gbp_import_request_items"."destination_property_id" IS NOT NULL AND "gbp_import_request_items"."country_code" IS NOT NULL AND "gbp_import_request_items"."update_existing_profile" = true AND "gbp_import_request_items"."expected_source_epoch" IS NULL AND "gbp_import_request_items"."expected_profile_version" IS NULL)
          OR ("gbp_import_request_items"."action" = 'relink' AND "gbp_import_request_items"."existing_property_id" IS NOT NULL AND "gbp_import_request_items"."destination_property_id" = "gbp_import_request_items"."existing_property_id" AND "gbp_import_request_items"."expected_source_epoch" >= 0 AND "gbp_import_request_items"."expected_profile_version" >= 1)
        )
        OR (
          "gbp_import_request_items"."status" NOT IN ('pending', 'processing')
          AND "gbp_import_request_items"."outcome_code" <> 'temporarily_unavailable'
          AND "gbp_import_request_items"."existing_property_id" IS NULL
          AND "gbp_import_request_items"."destination_property_id" IS NULL
          AND "gbp_import_request_items"."expected_source_epoch" IS NULL
          AND "gbp_import_request_items"."expected_profile_version" IS NULL
        )
          )
      )),
	CONSTRAINT "gbp_import_request_items_generations_valid" CHECK ((
        (
          (
          "gbp_import_request_items"."expected_connection_lifecycle_version" >= 1
          AND "gbp_import_request_items"."expected_connection_access_version" >= 1
          AND "gbp_import_request_items"."expected_credential_generation" >= 1
          )
          OR (
          "gbp_import_request_items"."status" NOT IN ('pending', 'processing')
          AND "gbp_import_request_items"."outcome_code" <> 'temporarily_unavailable'
          AND "gbp_import_request_items"."expected_connection_lifecycle_version" IS NULL
          AND "gbp_import_request_items"."expected_connection_access_version" IS NULL
          AND "gbp_import_request_items"."expected_credential_generation" IS NULL
          )
        )
        AND "gbp_import_request_items"."retry_revision" >= 0
      )),
	CONSTRAINT "gbp_import_request_items_authorization_snapshot_valid" CHECK ((
        (
          "gbp_import_request_items"."expected_execution_policy_version" IS NULL
          AND "gbp_import_request_items"."expected_actor_role" IS NULL
          AND "gbp_import_request_items"."expected_permission_digest" IS NULL
          AND "gbp_import_request_items"."expected_principal_kind" IS NULL
          AND "gbp_import_request_items"."expected_permission_version" IS NULL
        )
        OR (
          char_length("gbp_import_request_items"."expected_execution_policy_version") BETWEEN 1 AND 32
          AND char_length("gbp_import_request_items"."expected_actor_role") BETWEEN 1 AND 50
          AND "gbp_import_request_items"."expected_permission_digest" ~ '^[a-f0-9]{64}$'
          AND char_length("gbp_import_request_items"."expected_principal_kind") BETWEEN 1 AND 32
          AND "gbp_import_request_items"."expected_permission_version" >= 0
        )
      )),
	CONSTRAINT "gbp_import_request_items_attempt_fence_valid" CHECK ((
        "gbp_import_request_items"."highest_attempt_for_revision" BETWEEN 0 AND 5
        AND ("gbp_import_request_items"."claim_fence" IS NULL) = ("gbp_import_request_items"."claim_lease_expires_at" IS NULL)
        AND (
          "gbp_import_request_items"."status" <> 'processing'
          OR ("gbp_import_request_items"."claim_fence" IS NOT NULL AND "gbp_import_request_items"."highest_attempt_for_revision" BETWEEN 1 AND 5)
        )
      )),
	CONSTRAINT "gbp_import_request_items_status_outcome_valid" CHECK ((
        ("gbp_import_request_items"."status" IN ('pending', 'processing') AND "gbp_import_request_items"."outcome_code" IS NULL)
        OR ("gbp_import_request_items"."status" = 'imported' AND "gbp_import_request_items"."outcome_code" = 'imported')
        OR ("gbp_import_request_items"."status" = 'relinked' AND "gbp_import_request_items"."outcome_code" = 'relinked')
        OR ("gbp_import_request_items"."status" = 'already_exists' AND "gbp_import_request_items"."outcome_code" = 'already_exists')
        OR ("gbp_import_request_items"."status" = 'failed' AND "gbp_import_request_items"."outcome_code" IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error'))
        OR ("gbp_import_request_items"."status" = 'cancelled' AND "gbp_import_request_items"."outcome_code"::text IN ('authorization_changed', 'user_cancelled', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      )),
	CONSTRAINT "gbp_import_request_items_terminal_valid" CHECK ("gbp_import_request_items"."outcome_code" IS NULL OR "gbp_import_request_items"."first_terminal_at" IS NOT NULL),
	CONSTRAINT "gbp_import_request_items_deadline_valid" CHECK ("gbp_import_request_items"."effect_deadline_at" = "gbp_import_request_items"."created_at" + interval '24 hours'),
	CONSTRAINT "gbp_import_request_items_provider_reference_retention_valid" CHECK ((
        (
          "gbp_import_request_items"."status" IN ('pending', 'processing')
          AND "gbp_import_request_items"."connection_id" IS NOT NULL
          AND "gbp_import_request_items"."provider_account_suffix" IS NOT NULL
          AND "gbp_import_request_items"."provider_location_suffix" IS NOT NULL
        )
        OR (
          "gbp_import_request_items"."status" NOT IN ('pending', 'processing')
          AND (("gbp_import_request_items"."provider_account_suffix" IS NULL) = ("gbp_import_request_items"."provider_location_suffix" IS NULL))
        )
      )),
	CONSTRAINT "gbp_import_request_items_provider_suffix_valid" CHECK ((
        ("gbp_import_request_items"."provider_account_suffix" IS NULL OR "gbp_import_request_items"."provider_account_suffix" !~ '[/?#[:space:][:cntrl:]]')
        AND ("gbp_import_request_items"."provider_location_suffix" IS NULL OR "gbp_import_request_items"."provider_location_suffix" !~ '[/?#[:space:][:cntrl:]]')
      )),
	CONSTRAINT "gbp_import_request_items_google_review_uri_valid" CHECK ("gbp_import_request_items"."google_review_uri" IS NULL OR "gbp_import_request_items"."google_review_uri" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "gbp_import_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"request_id" uuid NOT NULL,
	"initiated_by" varchar(255) NOT NULL,
	"saga_id" uuid,
	"batch_ordinal" integer,
	"status" "google_import_v2_parent_status" DEFAULT 'queued' NOT NULL,
	"total_count" integer NOT NULL,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"pending_count" integer NOT NULL,
	"processing_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"relinked_count" integer DEFAULT 0 NOT NULL,
	"already_exists_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"deletion_fence" integer DEFAULT 0 NOT NULL,
	"wire_replay_key_version" varchar(32),
	"wire_replay_digest" varchar(43),
	"semantic_replay_key_version" varchar(32),
	"semantic_replay_digest" varchar(43),
	"first_terminal_at" timestamp with time zone,
	"purge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_requests_replay_pairs_valid" CHECK ((
        ("gbp_import_requests"."wire_replay_key_version" IS NULL) = ("gbp_import_requests"."wire_replay_digest" IS NULL)
        AND ("gbp_import_requests"."semantic_replay_key_version" IS NULL) = ("gbp_import_requests"."semantic_replay_digest" IS NULL)
        AND ("gbp_import_requests"."wire_replay_digest" IS NULL) = ("gbp_import_requests"."semantic_replay_digest" IS NULL)
      )),
	CONSTRAINT "gbp_import_requests_replay_encoding_valid" CHECK ((
        "gbp_import_requests"."wire_replay_digest" IS NULL OR (
          "gbp_import_requests"."wire_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
          AND "gbp_import_requests"."semantic_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
          AND "gbp_import_requests"."wire_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
          AND "gbp_import_requests"."semantic_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
        )
      )),
	CONSTRAINT "gbp_import_requests_terminal_times_valid" CHECK ((
        ("gbp_import_requests"."first_terminal_at" IS NULL) = ("gbp_import_requests"."purge_at" IS NULL)
        AND ("gbp_import_requests"."first_terminal_at" IS NULL OR "gbp_import_requests"."purge_at" = "gbp_import_requests"."first_terminal_at" + interval '30 days')
        AND ("gbp_import_requests"."status" IN ('queued', 'processing') OR "gbp_import_requests"."first_terminal_at" IS NOT NULL)
      )),
	CONSTRAINT "gbp_import_requests_counts_valid" CHECK ((
        "gbp_import_requests"."total_count" BETWEEN 1 AND 100
        AND "gbp_import_requests"."deletion_fence" >= 0
        AND "gbp_import_requests"."pending_count" >= 0
        AND "gbp_import_requests"."processing_count" >= 0
        AND "gbp_import_requests"."imported_count" >= 0
        AND "gbp_import_requests"."relinked_count" >= 0
        AND "gbp_import_requests"."already_exists_count" >= 0
        AND "gbp_import_requests"."failed_count" >= 0
        AND "gbp_import_requests"."cancelled_count" >= 0
        AND "gbp_import_requests"."processed_count" = "gbp_import_requests"."imported_count" + "gbp_import_requests"."relinked_count" + "gbp_import_requests"."already_exists_count" + "gbp_import_requests"."failed_count" + "gbp_import_requests"."cancelled_count"
        AND "gbp_import_requests"."total_count" = "gbp_import_requests"."pending_count" + "gbp_import_requests"."processing_count" + "gbp_import_requests"."processed_count"
      )),
	CONSTRAINT "gbp_import_requests_saga_batch_valid" CHECK ((
        ("gbp_import_requests"."saga_id" IS NULL AND "gbp_import_requests"."batch_ordinal" IS NULL)
        OR ("gbp_import_requests"."saga_id" IS NOT NULL AND "gbp_import_requests"."batch_ordinal" >= 0)
      ))
);
--> statement-breakpoint
CREATE TABLE "gbp_import_sagas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"request_id" uuid NOT NULL,
	"initiated_by" varchar(255) NOT NULL,
	"total_count" integer NOT NULL,
	"batch_count" integer NOT NULL,
	"wire_replay_key_version" varchar(32) NOT NULL,
	"wire_replay_digest" varchar(43) NOT NULL,
	"semantic_replay_key_version" varchar(32) NOT NULL,
	"semantic_replay_digest" varchar(43) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gbp_import_sagas_batch_shape_valid" CHECK ((
        "gbp_import_sagas"."total_count" >= 1
        AND "gbp_import_sagas"."batch_count" >= 1
        AND "gbp_import_sagas"."total_count" > ("gbp_import_sagas"."batch_count" - 1) * 100
        AND "gbp_import_sagas"."total_count" <= "gbp_import_sagas"."batch_count" * 100
      )),
	CONSTRAINT "gbp_import_sagas_replay_encoding_valid" CHECK ((
        "gbp_import_sagas"."wire_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "gbp_import_sagas"."semantic_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "gbp_import_sagas"."wire_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
        AND "gbp_import_sagas"."semantic_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
      ))
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
	CONSTRAINT "authorization_execution_permits_start_window_check" CHECK ("authorization_execution_permits"."start_deadline_at" > "authorization_execution_permits"."admitted_at"),
	CONSTRAINT "authorization_execution_permits_operation_window_check" CHECK ("authorization_execution_permits"."operation_deadline_at" IS NULL OR ("authorization_execution_permits"."started_at" IS NOT NULL AND "authorization_execution_permits"."operation_deadline_at" > "authorization_execution_permits"."started_at")),
	CONSTRAINT "authorization_execution_permits_state_check" CHECK (("authorization_execution_permits"."state" = 'admitted' AND "authorization_execution_permits"."started_at" IS NULL AND "authorization_execution_permits"."operation_deadline_at" IS NULL AND "authorization_execution_permits"."completed_at" IS NULL) OR ("authorization_execution_permits"."state" = 'started' AND "authorization_execution_permits"."started_at" IS NOT NULL AND "authorization_execution_permits"."operation_deadline_at" IS NOT NULL AND "authorization_execution_permits"."completed_at" IS NULL) OR ("authorization_execution_permits"."state" = 'completed' AND "authorization_execution_permits"."started_at" IS NOT NULL AND "authorization_execution_permits"."operation_deadline_at" IS NOT NULL AND "authorization_execution_permits"."completed_at" IS NOT NULL) OR ("authorization_execution_permits"."state" = 'fenced' AND "authorization_execution_permits"."fenced_at" IS NOT NULL))
);
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
	CONSTRAINT "capability_execution_control_denied_check" CHECK (("capability_execution_control"."denied" AND "capability_execution_control"."denied_at" IS NOT NULL) OR (NOT "capability_execution_control"."denied" AND "capability_execution_control"."denied_at" IS NULL AND "capability_execution_control"."drained_at" IS NULL AND "capability_execution_control"."cleanup_drained_at" IS NULL))
);
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
	CONSTRAINT "credential_revoke_permits_send_window_check" CHECK ("credential_revoke_permits"."send_authorization_expires_at" IS NULL OR "credential_revoke_permits"."send_authorization_expires_at" <= "credential_revoke_permits"."cleanup_deadline_at"),
	CONSTRAINT "credential_revoke_permits_hmac_pair_check" CHECK (("credential_revoke_permits"."token_hmac_key_version" IS NULL) = ("credential_revoke_permits"."token_hmac" IS NULL)),
	CONSTRAINT "credential_revoke_permits_state_check" CHECK (("credential_revoke_permits"."state" = 'dormant' AND "credential_revoke_permits"."token_hmac" IS NULL AND "credential_revoke_permits"."send_authorization_expires_at" IS NULL AND "credential_revoke_permits"."dispatching_at" IS NULL AND "credential_revoke_permits"."terminal_at" IS NULL) OR ("credential_revoke_permits"."state" = 'active' AND "credential_revoke_permits"."token_hmac" IS NOT NULL AND "credential_revoke_permits"."send_authorization_expires_at" IS NOT NULL AND "credential_revoke_permits"."activated_at" IS NOT NULL AND "credential_revoke_permits"."dispatching_at" IS NULL AND "credential_revoke_permits"."terminal_at" IS NULL) OR ("credential_revoke_permits"."state" = 'dispatching' AND "credential_revoke_permits"."token_hmac" IS NULL AND "credential_revoke_permits"."send_authorization_expires_at" IS NULL AND "credential_revoke_permits"."dispatching_at" IS NOT NULL AND "credential_revoke_permits"."terminal_at" IS NULL) OR ("credential_revoke_permits"."state" IN ('consumed_no_revoke', 'confirmed_not_sent', 'confirmed_revoked', 'cleanup_ambiguous', 'provider_reset_confirmed') AND "credential_revoke_permits"."token_hmac" IS NULL AND "credential_revoke_permits"."send_authorization_expires_at" IS NULL AND "credential_revoke_permits"."terminal_at" IS NOT NULL))
);
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
	CONSTRAINT "google_credential_source_operations_sequence_check" CHECK ("google_credential_source_operations"."sequence" >= 1),
	CONSTRAINT "google_credential_source_operations_deadline_check" CHECK ("google_credential_source_operations"."operation_deadline_at" > "google_credential_source_operations"."created_at"),
	CONSTRAINT "google_credential_source_operations_state_check" CHECK (("google_credential_source_operations"."state" = 'registered' AND "google_credential_source_operations"."provider_started_at" IS NULL AND "google_credential_source_operations"."terminal_at" IS NULL) OR ("google_credential_source_operations"."state" IN ('provider_started', 'provider_outcome_ambiguous') AND "google_credential_source_operations"."provider_started_at" IS NOT NULL AND "google_credential_source_operations"."terminal_at" IS NULL) OR ("google_credential_source_operations"."state" IN ('terminal', 'provider_reset_terminal') AND "google_credential_source_operations"."terminal_at" IS NOT NULL))
);
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
	CONSTRAINT "google_subject_authority_guards_sequence_check" CHECK ("google_subject_authority_guards"."next_sequence" >= 1 AND ("google_subject_authority_guards"."source_cutoff_sequence" IS NULL OR "google_subject_authority_guards"."source_cutoff_sequence" < "google_subject_authority_guards"."next_sequence"))
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"portal_id" uuid NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"session_id" varchar(255),
	"rating_id" uuid,
	"comment" text NOT NULL,
	"source" varchar(10) NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_contact_request_reveal_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_request_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"access_purpose" varchar(50) NOT NULL,
	"authority_basis" varchar(32) NOT NULL,
	"revealed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_contact_reveal_audits_purpose_valid" CHECK ("guest_contact_request_reveal_audits"."access_purpose" = 'respond_to_contact_request'),
	CONSTRAINT "guest_contact_reveal_audits_authority_valid" CHECK ("guest_contact_request_reveal_audits"."authority_basis" IN ('account_admin', 'portal_creator', 'responsible_manager'))
);
--> statement-breakpoint
CREATE TABLE "guest_contact_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"publication_snapshot_id" uuid NOT NULL,
	"publication_version" integer NOT NULL,
	"publication_digest" varchar(64) NOT NULL,
	"contact_request_enabled" boolean NOT NULL,
	"notice_id" varchar(100) NOT NULL,
	"notice_version" varchar(100) NOT NULL,
	"notice_digest" varchar(64) NOT NULL,
	"notice_locale" varchar(35) NOT NULL,
	"retention_policy_version" varchar(100) NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"consent_granted" boolean DEFAULT false NOT NULL,
	"encrypted_contact" text,
	"encryption_key_id" varchar(50),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_contact_requests_purpose_valid" CHECK ("guest_contact_requests"."purpose" = 'manager_follow_up'),
	CONSTRAINT "guest_contact_requests_key_id_valid" CHECK ("guest_contact_requests"."encryption_key_id" IS NULL OR "guest_contact_requests"."encryption_key_id" ~ '^[a-z0-9][a-z0-9._-]{0,49}$'),
	CONSTRAINT "guest_contact_requests_publication_evidence_valid" CHECK ("guest_contact_requests"."publication_version" >= 1
        AND "guest_contact_requests"."publication_digest" ~ '^[0-9a-f]{64}$'
        AND "guest_contact_requests"."contact_request_enabled" = true
        AND char_length("guest_contact_requests"."notice_id") BETWEEN 1 AND 100
        AND char_length("guest_contact_requests"."notice_version") BETWEEN 1 AND 100
        AND "guest_contact_requests"."notice_digest" ~ '^[0-9a-f]{64}$'
        AND "guest_contact_requests"."notice_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
        AND "guest_contact_requests"."retention_policy_version" = 'guest-contact-retention-30d-v1'),
	CONSTRAINT "guest_contact_requests_retention_exact" CHECK ("guest_contact_requests"."expires_at" = "guest_contact_requests"."submitted_at" + INTERVAL '720:00:00'),
	CONSTRAINT "guest_contact_requests_lifecycle_valid" CHECK ((
        "guest_contact_requests"."status" = 'active'
        AND "guest_contact_requests"."consent_granted" = true
        AND "guest_contact_requests"."encrypted_contact" IS NOT NULL
        AND "guest_contact_requests"."encryption_key_id" IS NOT NULL
        AND "guest_contact_requests"."withdrawn_at" IS NULL
        AND "guest_contact_requests"."purged_at" IS NULL
      ) OR (
        "guest_contact_requests"."status" = 'withdrawn'
        AND "guest_contact_requests"."consent_granted" = false
        AND "guest_contact_requests"."encrypted_contact" IS NULL
        AND "guest_contact_requests"."withdrawn_at" IS NOT NULL
        AND "guest_contact_requests"."purged_at" IS NULL
      ) OR (
        "guest_contact_requests"."status" = 'expired'
        AND "guest_contact_requests"."consent_granted" = false
        AND "guest_contact_requests"."encrypted_contact" IS NULL
        AND "guest_contact_requests"."withdrawn_at" IS NULL
        AND "guest_contact_requests"."purged_at" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "guest_network_pressure_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"pseudonym" varchar(64) NOT NULL,
	"action" varchar(24) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_network_pressure_pseudonym_valid" CHECK ("guest_network_pressure_records"."pseudonym" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "guest_network_pressure_action_valid" CHECK ("guest_network_pressure_records"."action" IN ('rating', 'private_feedback', 'destination_action', 'qualified_scan')),
	CONSTRAINT "guest_network_pressure_retention_valid" CHECK ("guest_network_pressure_records"."expires_at" = "guest_network_pressure_records"."observed_at" + interval '7 days')
);
--> statement-breakpoint
CREATE TABLE "guest_qualified_scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"portal_group_id" uuid,
	"access_artifact_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"retracted_at" timestamp with time zone,
	"attributed_staff_participant_id" uuid,
	"attributed_staff_participation_id" uuid,
	"attribution_responsibility_id" uuid,
	"staff_attribution_effective_from" timestamp with time zone,
	"staff_attribution_effective_to" timestamp with time zone,
	CONSTRAINT "guest_qualified_scans_retraction_valid" CHECK ("guest_qualified_scans"."retracted_at" IS NULL OR "guest_qualified_scans"."retracted_at" >= "guest_qualified_scans"."occurred_at"),
	CONSTRAINT "guest_qualified_scans_staff_attribution_complete" CHECK (("guest_qualified_scans"."attributed_staff_participant_id" IS NULL AND "guest_qualified_scans"."attributed_staff_participation_id" IS NULL AND "guest_qualified_scans"."attribution_responsibility_id" IS NULL AND "guest_qualified_scans"."staff_attribution_effective_from" IS NULL AND "guest_qualified_scans"."staff_attribution_effective_to" IS NULL) OR ("guest_qualified_scans"."attributed_staff_participant_id" IS NOT NULL AND "guest_qualified_scans"."attributed_staff_participation_id" IS NOT NULL AND "guest_qualified_scans"."attribution_responsibility_id" IS NOT NULL AND "guest_qualified_scans"."staff_attribution_effective_from" IS NOT NULL AND ("guest_qualified_scans"."staff_attribution_effective_to" IS NULL OR "guest_qualified_scans"."staff_attribution_effective_to" > "guest_qualified_scans"."staff_attribution_effective_from") AND "guest_qualified_scans"."occurred_at" >= "guest_qualified_scans"."staff_attribution_effective_from" AND ("guest_qualified_scans"."staff_attribution_effective_to" IS NULL OR "guest_qualified_scans"."occurred_at" < "guest_qualified_scans"."staff_attribution_effective_to")))
);
--> statement-breakpoint
CREATE TABLE "guest_response_experience_snapshots" (
	"response_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"publication_state" varchar(20) NOT NULL,
	"publication_snapshot_id" uuid,
	"publication_version" integer,
	"publication_digest" varchar(64),
	"configuration_digest" varchar(64) NOT NULL,
	"guest_locale" varchar(35) NOT NULL,
	"language_pack_version" varchar(100) NOT NULL,
	"private_feedback_threshold" integer NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_response_experience_snapshots_publication_state_valid" CHECK ("guest_response_experience_snapshots"."publication_state" = 'published'),
	CONSTRAINT "guest_response_experience_snapshots_configuration_digest_valid" CHECK ("guest_response_experience_snapshots"."configuration_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "guest_response_experience_snapshots_publication_reference_valid" CHECK (("guest_response_experience_snapshots"."publication_snapshot_id" IS NULL AND "guest_response_experience_snapshots"."publication_version" IS NULL AND "guest_response_experience_snapshots"."publication_digest" IS NULL) OR ("guest_response_experience_snapshots"."publication_snapshot_id" IS NOT NULL AND "guest_response_experience_snapshots"."publication_version" >= 1 AND "guest_response_experience_snapshots"."publication_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "guest_response_experience_snapshots_guest_locale_valid" CHECK ("guest_response_experience_snapshots"."guest_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
	CONSTRAINT "guest_response_experience_snapshots_threshold_valid" CHECK ("guest_response_experience_snapshots"."private_feedback_threshold" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "guest_response_integrity_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_outcome" varchar(32),
	"outcome" varchar(32) NOT NULL,
	"reason_code" varchar(100) NOT NULL,
	"source" varchar(20) NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_response_integrity_decisions_revision_valid" CHECK ("guest_response_integrity_decisions"."revision" >= 1),
	CONSTRAINT "guest_response_integrity_decisions_initial_revision_valid" CHECK (("guest_response_integrity_decisions"."revision" = 1 AND "guest_response_integrity_decisions"."previous_outcome" IS NULL) OR ("guest_response_integrity_decisions"."revision" > 1 AND "guest_response_integrity_decisions"."previous_outcome" IS NOT NULL)),
	CONSTRAINT "guest_response_integrity_decisions_previous_outcome_valid" CHECK ("guest_response_integrity_decisions"."previous_outcome" IS NULL OR "guest_response_integrity_decisions"."previous_outcome" IN ('accepted', 'filtered_automatically', 'under_review')),
	CONSTRAINT "guest_response_integrity_decisions_outcome_valid" CHECK ("guest_response_integrity_decisions"."outcome" IN ('accepted', 'filtered_automatically', 'under_review')),
	CONSTRAINT "guest_response_integrity_decisions_reason_valid" CHECK ("guest_response_integrity_decisions"."reason_code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
	CONSTRAINT "guest_response_integrity_decisions_source_valid" CHECK ("guest_response_integrity_decisions"."source" IN ('system', 'automatic', 'reviewer', 'migration'))
);
--> statement-breakpoint
CREATE TABLE "guest_response_private_feedback" (
	"response_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"body" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_response_private_feedback_body_length" CHECK (char_length("guest_response_private_feedback"."body") BETWEEN 1 AND 2000),
	CONSTRAINT "guest_response_private_feedback_live_window" CHECK ("guest_response_private_feedback"."expires_at" > "guest_response_private_feedback"."submitted_at")
);
--> statement-breakpoint
CREATE TABLE "guest_response_session_bindings" (
	"response_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_response_session_bindings_live_window" CHECK ("guest_response_session_bindings"."expires_at" > "guest_response_session_bindings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "guest_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"integrity_outcome" varchar(32) DEFAULT 'accepted' NOT NULL,
	"integrity_reason_code" varchar(100) DEFAULT 'legacy_included' NOT NULL,
	"integrity_revision" integer DEFAULT 1 NOT NULL,
	"integrity_assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rating" integer,
	"category_id" uuid,
	"response_consent" boolean DEFAULT false NOT NULL,
	"text_consent" boolean DEFAULT false NOT NULL,
	"media_consent" boolean DEFAULT false NOT NULL,
	"private_feedback_threshold" integer,
	"rating_source_event_id" varchar(255),
	"feedback_source_event_id" varchar(255),
	"correction_count" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"corrected_at" timestamp with time zone,
	"feedback_submitted_at" timestamp with time zone,
	"feedback_submission_revision" integer,
	"feedback_withdrawn_at" timestamp with time zone,
	"moderated_at" timestamp with time zone,
	"retention_deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"attributed_staff_participant_id" uuid,
	"attributed_staff_participation_id" uuid,
	"attribution_responsibility_id" uuid,
	"staff_attribution_effective_from" timestamp with time zone,
	"staff_attribution_effective_to" timestamp with time zone,
	CONSTRAINT "guest_responses_status_valid" CHECK ("guest_responses"."status" IN ('pending', 'submitted', 'corrected', 'moderated', 'deleted', 'expired')),
	CONSTRAINT "guest_responses_integrity_outcome_valid" CHECK ("guest_responses"."integrity_outcome" IN ('accepted', 'filtered_automatically', 'under_review')),
	CONSTRAINT "guest_responses_integrity_reason_valid" CHECK ("guest_responses"."integrity_reason_code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
	CONSTRAINT "guest_responses_integrity_revision_valid" CHECK ("guest_responses"."integrity_revision" >= 1),
	CONSTRAINT "guest_responses_rating_valid" CHECK ("guest_responses"."rating" IS NULL OR ("guest_responses"."rating" >= 1 AND "guest_responses"."rating" <= 5)),
	CONSTRAINT "guest_responses_correction_count_valid" CHECK ("guest_responses"."correction_count" >= 0 AND "guest_responses"."correction_count" <= 1),
	CONSTRAINT "guest_responses_private_feedback_threshold_valid" CHECK ("guest_responses"."private_feedback_threshold" IS NULL OR "guest_responses"."private_feedback_threshold" BETWEEN 1 AND 5),
	CONSTRAINT "guest_responses_feedback_withdrawal_valid" CHECK ("guest_responses"."feedback_withdrawn_at" IS NULL OR ("guest_responses"."feedback_submitted_at" IS NOT NULL AND "guest_responses"."text_consent" = false AND "guest_responses"."feedback_source_event_id" IS NULL)),
	CONSTRAINT "guest_responses_feedback_submission_revision_valid" CHECK (("guest_responses"."feedback_submitted_at" IS NULL AND "guest_responses"."feedback_submission_revision" IS NULL) OR ("guest_responses"."feedback_submitted_at" IS NOT NULL AND "guest_responses"."feedback_submission_revision" BETWEEN 1 AND "guest_responses"."correction_count" + 1)),
	CONSTRAINT "guest_responses_staff_attribution_complete" CHECK (("guest_responses"."attributed_staff_participant_id" IS NULL AND "guest_responses"."attributed_staff_participation_id" IS NULL AND "guest_responses"."attribution_responsibility_id" IS NULL AND "guest_responses"."staff_attribution_effective_from" IS NULL AND "guest_responses"."staff_attribution_effective_to" IS NULL) OR ("guest_responses"."attributed_staff_participant_id" IS NOT NULL AND "guest_responses"."attributed_staff_participation_id" IS NOT NULL AND "guest_responses"."attribution_responsibility_id" IS NOT NULL AND "guest_responses"."staff_attribution_effective_from" IS NOT NULL AND "guest_responses"."submitted_at" IS NOT NULL AND "guest_responses"."submitted_at" >= "guest_responses"."staff_attribution_effective_from" AND ("guest_responses"."staff_attribution_effective_to" IS NULL OR "guest_responses"."staff_attribution_effective_to" > "guest_responses"."staff_attribution_effective_from") AND ("guest_responses"."staff_attribution_effective_to" IS NULL OR "guest_responses"."submitted_at" < "guest_responses"."staff_attribution_effective_to")))
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"portal_id" uuid NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"session_id" varchar(255),
	"value" integer NOT NULL,
	"source" varchar(10) NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"portal_id" uuid NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"source" varchar(10) NOT NULL,
	"session_id" varchar(255),
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_assignment_history" (
	"inbox_item_id" uuid NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"handling_cycle_number" bigint,
	"previous_assignee" varchar(255),
	"next_assignee" varchar(255),
	"reason" "inbox_assignment_reason" NOT NULL,
	"actor_user_id" varchar(255),
	"bulk_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_assignment_history_pk" PRIMARY KEY("inbox_item_id","resulting_command_revision"),
	CONSTRAINT "inbox_assignment_history_revision_safe" CHECK ("inbox_assignment_history"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND ("inbox_assignment_history"."handling_cycle_number" IS NULL OR "inbox_assignment_history"."handling_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "inbox_assignment_history_changes_assignee" CHECK ("inbox_assignment_history"."previous_assignee" IS DISTINCT FROM "inbox_assignment_history"."next_assignee")
);
--> statement-breakpoint
CREATE TABLE "inbox_escalation_history" (
	"inbox_item_id" uuid NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"handling_cycle_number" bigint,
	"kind" varchar(16) NOT NULL,
	"actor_user_id" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_escalation_history_pk" PRIMARY KEY("inbox_item_id","resulting_command_revision"),
	CONSTRAINT "inbox_escalation_history_revision_safe" CHECK ("inbox_escalation_history"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND ("inbox_escalation_history"."handling_cycle_number" IS NULL OR "inbox_escalation_history"."handling_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "inbox_escalation_history_kind_valid" CHECK ("inbox_escalation_history"."kind" IN ('escalated', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "inbox_feedback_handling_outcomes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"outcome_revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" DEFAULT 'feedback' NOT NULL,
	"feedback_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"outcome" varchar(48) NOT NULL,
	"internal_note" text,
	"recorded_by" varchar(255) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"completion_at" timestamp with time zone NOT NULL,
	"completion_state_revision" bigint NOT NULL,
	"deadline_result" varchar(24) NOT NULL,
	"resulting_command_revision" bigint NOT NULL,
	"supersedes_outcome_id" uuid,
	"supersedes_outcome_revision" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_feedback_handling_outcomes_values_valid" CHECK ("inbox_feedback_handling_outcomes"."source_type" = 'feedback'
        AND "inbox_feedback_handling_outcomes"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."outcome_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."completion_state_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."resulting_command_revision" BETWEEN 2 AND '9007199254740991'::bigint
        AND "inbox_feedback_handling_outcomes"."outcome" IN (
          'follow_up_completed', 'follow_up_attempted', 'handled_with_team',
          'reviewed_no_additional_step', 'content_concern_reviewed'
        )
        AND "inbox_feedback_handling_outcomes"."deadline_result" IN ('on_time', 'late', 'not_measured')
        AND ("inbox_feedback_handling_outcomes"."internal_note" IS NULL OR length(btrim("inbox_feedback_handling_outcomes"."internal_note")) BETWEEN 1 AND 2000)
        AND "inbox_feedback_handling_outcomes"."recorded_at" >= "inbox_feedback_handling_outcomes"."completion_at"
        AND (
          ("inbox_feedback_handling_outcomes"."outcome_revision" = 1 AND "inbox_feedback_handling_outcomes"."supersedes_outcome_id" IS NULL AND "inbox_feedback_handling_outcomes"."supersedes_outcome_revision" IS NULL)
          OR ("inbox_feedback_handling_outcomes"."outcome_revision" > 1 AND "inbox_feedback_handling_outcomes"."supersedes_outcome_id" IS NOT NULL
            AND "inbox_feedback_handling_outcomes"."supersedes_outcome_revision" = "inbox_feedback_handling_outcomes"."outcome_revision" - 1)
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_handling_cycle_heads" (
	"inbox_item_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"current_source_revision" bigint NOT NULL,
	"review_id" uuid,
	"current_cycle_number" bigint NOT NULL,
	"current_material_review_revision" bigint,
	"state_revision" bigint DEFAULT 1 NOT NULL,
	"status" "inbox_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycle_heads_revisions_safe" CHECK ("inbox_handling_cycle_heads"."current_cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_heads"."current_source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_heads"."state_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "inbox_handling_cycle_heads_source_anchor_valid" CHECK ((
        "inbox_handling_cycle_heads"."source_type" = 'review'
        AND "inbox_handling_cycle_heads"."review_id" = "inbox_handling_cycle_heads"."source_id"
        AND "inbox_handling_cycle_heads"."current_material_review_revision" = "inbox_handling_cycle_heads"."current_source_revision"
      ) OR (
        "inbox_handling_cycle_heads"."source_type" = 'feedback'
        AND "inbox_handling_cycle_heads"."review_id" IS NULL
        AND "inbox_handling_cycle_heads"."current_material_review_revision" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "inbox_handling_cycle_response_targets" (
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"target_kind" varchar(48) NOT NULL,
	"performance_eligibility" varchar(32) NOT NULL,
	"duration_minutes" integer,
	"policy_source" varchar(32),
	"policy_version" bigint,
	"start_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"completion_at" timestamp with time zone,
	"result" varchar(24),
	"stop_reason" varchar(48),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycle_response_targets_pk" PRIMARY KEY("inbox_item_id","cycle_number"),
	CONSTRAINT "inbox_handling_cycle_response_targets_values_valid" CHECK ("inbox_handling_cycle_response_targets"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_response_targets"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_response_targets"."target_kind" IN ('google_review_response', 'private_feedback_handling')
        AND "inbox_handling_cycle_response_targets"."performance_eligibility" IN ('measured', 'legacy_unknown', 'historical_onboarding')
        AND (
          ("inbox_handling_cycle_response_targets"."target_kind" = 'google_review_response' AND "inbox_handling_cycle_response_targets"."source_type" = 'review')
          OR ("inbox_handling_cycle_response_targets"."target_kind" = 'private_feedback_handling' AND "inbox_handling_cycle_response_targets"."source_type" = 'feedback')
        )
        AND (
          (
            "inbox_handling_cycle_response_targets"."performance_eligibility" = 'measured'
            AND "inbox_handling_cycle_response_targets"."duration_minutes" BETWEEN 1 AND 43200
            AND "inbox_handling_cycle_response_targets"."policy_source" IN ('builtin_default', 'organization_policy', 'property_override')
            AND ("inbox_handling_cycle_response_targets"."target_kind" = 'private_feedback_handling' OR "inbox_handling_cycle_response_targets"."policy_source" <> 'property_override')
            AND "inbox_handling_cycle_response_targets"."policy_version" BETWEEN 1 AND '9007199254740991'::bigint
            AND "inbox_handling_cycle_response_targets"."start_at" IS NOT NULL
            AND "inbox_handling_cycle_response_targets"."due_at" = "inbox_handling_cycle_response_targets"."start_at" + make_interval(mins => "inbox_handling_cycle_response_targets"."duration_minutes")
          ) OR (
            "inbox_handling_cycle_response_targets"."performance_eligibility" <> 'measured'
            AND "inbox_handling_cycle_response_targets"."duration_minutes" IS NULL
            AND "inbox_handling_cycle_response_targets"."policy_source" IS NULL
            AND "inbox_handling_cycle_response_targets"."policy_version" IS NULL
            AND "inbox_handling_cycle_response_targets"."start_at" IS NULL
            AND "inbox_handling_cycle_response_targets"."due_at" IS NULL
          )
        )
        AND (
          ("inbox_handling_cycle_response_targets"."completion_at" IS NULL AND "inbox_handling_cycle_response_targets"."result" IS NULL AND "inbox_handling_cycle_response_targets"."stop_reason" IS NULL)
          OR (
            "inbox_handling_cycle_response_targets"."performance_eligibility" = 'measured'
            AND (
              (
                "inbox_handling_cycle_response_targets"."result" IN ('on_time', 'late')
                AND "inbox_handling_cycle_response_targets"."completion_at" >= "inbox_handling_cycle_response_targets"."start_at"
                AND "inbox_handling_cycle_response_targets"."stop_reason" IN ('private_feedback_handled', 'confirmed_on_google')
              )
              OR (
                "inbox_handling_cycle_response_targets"."result" = 'cancelled'
                AND "inbox_handling_cycle_response_targets"."stop_reason" IN ('guest_withdrawn', 'superseded_by_source_revision', 'source_ineligible')
              )
            )
            AND (
              "inbox_handling_cycle_response_targets"."result" = 'cancelled'
              OR (
                (("inbox_handling_cycle_response_targets"."result" = 'on_time') = ("inbox_handling_cycle_response_targets"."completion_at" <= "inbox_handling_cycle_response_targets"."due_at"))
                AND (("inbox_handling_cycle_response_targets"."result" = 'late') = ("inbox_handling_cycle_response_targets"."completion_at" > "inbox_handling_cycle_response_targets"."due_at"))
              )
            )
          )
        )),
	CONSTRAINT "inbox_handling_cycle_response_targets_source_stop_valid" CHECK ("inbox_handling_cycle_response_targets"."stop_reason" IS NULL
        OR ("inbox_handling_cycle_response_targets"."target_kind" = 'private_feedback_handling' AND "inbox_handling_cycle_response_targets"."stop_reason" IN ('private_feedback_handled', 'guest_withdrawn', 'superseded_by_source_revision'))
        OR ("inbox_handling_cycle_response_targets"."target_kind" = 'google_review_response' AND "inbox_handling_cycle_response_targets"."stop_reason" IN ('confirmed_on_google', 'superseded_by_source_revision', 'source_ineligible')))
);
--> statement-breakpoint
CREATE TABLE "inbox_handling_cycle_transitions" (
	"inbox_item_id" uuid NOT NULL,
	"state_revision" bigint NOT NULL,
	"cycle_number" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"kind" varchar(16) NOT NULL,
	"transition_reason" varchar(48) NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_user_id" varchar(255),
	"trigger_event_id" uuid,
	"transitioned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycle_transitions_pk" PRIMARY KEY("inbox_item_id","state_revision"),
	CONSTRAINT "inbox_handling_cycle_transitions_values_valid" CHECK ("inbox_handling_cycle_transitions"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_transitions"."state_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_transitions"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_handling_cycle_transitions"."kind" IN ('opened', 'closed', 'reopened')
        AND "inbox_handling_cycle_transitions"."transition_reason" IN (
          'legacy_backfill',
          'review_observed',
          'feedback_submitted',
          'material_revision_changed',
          'manual_reopen',
          'provider_reply_deleted',
          'provider_reply_diverged',
          'guest_follow_up_still_needed',
          'internal_follow_up_still_needed',
          'new_information',
          'correcting_handling_status',
          'other',
          'confirmed_on_google',
          'external_reply_observed',
          'guest_withdrawn',
          'private_feedback_handled',
          'source_ineligible',
          'superseded_by_source_revision'
        )
        AND "inbox_handling_cycle_transitions"."actor_type" IN ('user', 'guest', 'provider', 'system')
        AND (("inbox_handling_cycle_transitions"."actor_type" = 'user') = ("inbox_handling_cycle_transitions"."actor_user_id" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "inbox_handling_cycles" (
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"review_id" uuid,
	"material_review_revision" bigint,
	"opened_reason" varchar(48) NOT NULL,
	"manual_reopen_reason" varchar(48),
	"manual_reopen_explanation" varchar(280),
	"supersedes_cycle_number" bigint,
	"opened_by" varchar(255),
	"opened_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_handling_cycles_pk" PRIMARY KEY("inbox_item_id","cycle_number"),
	CONSTRAINT "inbox_handling_cycles_sequence_safe" CHECK ("inbox_handling_cycles"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND (
          ("inbox_handling_cycles"."cycle_number" = 1 AND "inbox_handling_cycles"."supersedes_cycle_number" IS NULL)
          OR
          ("inbox_handling_cycles"."cycle_number" > 1 AND "inbox_handling_cycles"."supersedes_cycle_number" = "inbox_handling_cycles"."cycle_number" - 1)
        )),
	CONSTRAINT "inbox_handling_cycles_reason_valid" CHECK ("inbox_handling_cycles"."opened_reason" IN (
        'legacy_backfill',
        'review_observed',
        'feedback_submitted',
        'material_revision_changed',
        'manual_reopen',
        'provider_reply_deleted',
        'provider_reply_diverged'
      )),
	CONSTRAINT "inbox_handling_cycles_source_anchor_valid" CHECK ("inbox_handling_cycles"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND (
          (
            "inbox_handling_cycles"."source_type" = 'review'
            AND "inbox_handling_cycles"."review_id" = "inbox_handling_cycles"."source_id"
            AND "inbox_handling_cycles"."material_review_revision" = "inbox_handling_cycles"."source_revision"
            AND "inbox_handling_cycles"."opened_reason" <> 'feedback_submitted'
          ) OR (
            "inbox_handling_cycles"."source_type" = 'feedback'
            AND "inbox_handling_cycles"."review_id" IS NULL
            AND "inbox_handling_cycles"."material_review_revision" IS NULL
            AND "inbox_handling_cycles"."opened_reason" IN ('legacy_backfill', 'feedback_submitted', 'manual_reopen')
          )
        )),
	CONSTRAINT "inbox_handling_cycles_manual_reopen_valid" CHECK ((
        "inbox_handling_cycles"."opened_reason" <> 'manual_reopen'
        AND "inbox_handling_cycles"."manual_reopen_reason" IS NULL
        AND "inbox_handling_cycles"."manual_reopen_explanation" IS NULL
      ) OR (
        "inbox_handling_cycles"."opened_reason" = 'manual_reopen'
        AND "inbox_handling_cycles"."manual_reopen_reason" IS NOT NULL
        AND "inbox_handling_cycles"."manual_reopen_reason" IN (
          'guest_follow_up_still_needed',
          'internal_follow_up_still_needed',
          'new_information',
          'correcting_handling_status',
          'other'
        )
        AND (
          (
            "inbox_handling_cycles"."manual_reopen_reason" = 'other'
            AND "inbox_handling_cycles"."manual_reopen_explanation" IS NOT NULL
            AND length(btrim("inbox_handling_cycles"."manual_reopen_explanation")) BETWEEN 1 AND 280
          ) OR (
            "inbox_handling_cycles"."manual_reopen_reason" <> 'other'
            AND "inbox_handling_cycles"."manual_reopen_explanation" IS NULL
          )
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"source_type" "inbox_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "inbox_status" DEFAULT 'open' NOT NULL,
	"is_escalated" boolean DEFAULT false NOT NULL,
	"escalated_at" timestamp with time zone,
	"escalated_by" varchar(255),
	"escalation_resolved_at" timestamp with time zone,
	"escalation_resolved_by" varchar(255),
	"rating" integer,
	"source_date" timestamp with time zone NOT NULL,
	"platform" varchar(255),
	"snippet" text,
	"reviewer_name" varchar(255),
	"assigned_to" varchar(255),
	"closed_at" timestamp with time zone,
	"first_reply_submitted_at" timestamp with time zone,
	"first_reply_published_at" timestamp with time zone,
	"command_revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_command_revision_safe" CHECK ("inbox_items"."command_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "inbox_items_review_source_content_free" CHECK ("inbox_items"."source_type" <> 'review' OR ("inbox_items"."rating" IS NULL AND "inbox_items"."snippet" IS NULL AND "inbox_items"."reviewer_name" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "inbox_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"author_user_id" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_private_feedback_target_property_overrides" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"duration_minutes" integer,
	"policy_version" bigint NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_private_feedback_target_property_overrides_pk" PRIMARY KEY("organization_id","property_id"),
	CONSTRAINT "inbox_private_feedback_target_property_overrides_values_valid" CHECK ((("inbox_private_feedback_target_property_overrides"."enabled" AND "inbox_private_feedback_target_property_overrides"."duration_minutes" BETWEEN 1 AND 43200)
          OR (NOT "inbox_private_feedback_target_property_overrides"."enabled" AND "inbox_private_feedback_target_property_overrides"."duration_minutes" IS NULL))
        AND "inbox_private_feedback_target_property_overrides"."policy_version" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "inbox_response_target_organization_policies" (
	"organization_id" varchar(255) NOT NULL,
	"target_kind" varchar(48) NOT NULL,
	"duration_minutes" integer NOT NULL,
	"policy_version" bigint NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_response_target_organization_policies_pk" PRIMARY KEY("organization_id","target_kind"),
	CONSTRAINT "inbox_response_target_organization_policies_values_valid" CHECK ("inbox_response_target_organization_policies"."target_kind" IN ('google_review_response', 'private_feedback_handling')
        AND "inbox_response_target_organization_policies"."duration_minutes" BETWEEN 1 AND 43200
        AND "inbox_response_target_organization_policies"."policy_version" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "inbox_response_target_reminders" (
	"inbox_item_id" uuid NOT NULL,
	"cycle_number" bigint NOT NULL,
	"reminder_kind" varchar(24) NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"target_kind" varchar(48) NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_response_target_reminders_pk" PRIMARY KEY("inbox_item_id","cycle_number","reminder_kind"),
	CONSTRAINT "inbox_response_target_reminders_values_valid" CHECK ("inbox_response_target_reminders"."cycle_number" BETWEEN 1 AND '9007199254740991'::bigint
        AND "inbox_response_target_reminders"."reminder_kind" IN ('halfway', 'target_passed')
        AND "inbox_response_target_reminders"."target_kind" IN ('google_review_response', 'private_feedback_handling')
        AND NOT ("inbox_response_target_reminders"."delivered_at" IS NOT NULL AND "inbox_response_target_reminders"."cancelled_at" IS NOT NULL)
        AND ("inbox_response_target_reminders"."delivered_at" IS NULL OR "inbox_response_target_reminders"."delivered_at" >= "inbox_response_target_reminders"."scheduled_for"))
);
--> statement-breakpoint
CREATE TABLE "inbox_user_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"last_inbox_view" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_organization_lifecycle_receipts" (
	"organization_id" text NOT NULL,
	"closure_lineage_id" uuid NOT NULL,
	"lifecycle_revision" integer NOT NULL,
	"phase" text NOT NULL,
	"request_fingerprint" char(64) NOT NULL,
	"outcome" text NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"recoverable_until" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_organization_lifecycle_receipts_pk" PRIMARY KEY("closure_lineage_id","lifecycle_revision","phase"),
	CONSTRAINT "identity_organization_lifecycle_receipts_revision_positive" CHECK ("identity_organization_lifecycle_receipts"."lifecycle_revision" > 0),
	CONSTRAINT "identity_organization_lifecycle_receipts_phase_valid" CHECK ("identity_organization_lifecycle_receipts"."phase" IN ('closing', 'purge_readiness', 'purge')),
	CONSTRAINT "identity_organization_lifecycle_receipts_outcome_valid" CHECK ("identity_organization_lifecycle_receipts"."outcome" IN ('complete', 'no_data')),
	CONSTRAINT "identity_organization_lifecycle_receipts_fingerprint_valid" CHECK ("identity_organization_lifecycle_receipts"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "identity_organization_lifecycle_receipts_evidence_valid" CHECK ("identity_organization_lifecycle_receipts"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);
--> statement-breakpoint
CREATE TABLE "organization_export_retrieval_issuances" (
	"export_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"export_revision" integer NOT NULL,
	"operation_id" uuid NOT NULL,
	"token_digest" char(64) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_export_retrieval_issuances_pk" PRIMARY KEY("export_id","export_revision"),
	CONSTRAINT "organization_export_retrieval_issuances_revision_positive" CHECK ("organization_export_retrieval_issuances"."export_revision" > 0),
	CONSTRAINT "organization_export_retrieval_issuances_digest_valid" CHECK ("organization_export_retrieval_issuances"."token_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "organization_export_retrieval_issuances_expiry_valid" CHECK ("organization_export_retrieval_issuances"."expires_at" > "organization_export_retrieval_issuances"."issued_at" AND "organization_export_retrieval_issuances"."expires_at" <= "organization_export_retrieval_issuances"."issued_at" + interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE "organization_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"format_version" varchar(64) DEFAULT 'organization-export/v1' NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"object_expires_at" timestamp with time zone NOT NULL,
	"generation_lease_expires_at" timestamp with time zone,
	"coverage_sha256" varchar(64),
	"manifest_sha256" varchar(64),
	"archive_sha256" varchar(64),
	"object_key" varchar(200),
	"encryption_evidence_ref" varchar(200),
	"pre_egress_recorded_at" timestamp with time zone,
	"egress_recovery_attempts" integer DEFAULT 0 NOT NULL,
	"retrieval_operation_id" uuid,
	"retrieval_token_digest" varchar(64),
	"retrieval_issued_at" timestamp with time zone,
	"retrieval_expires_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone,
	"deletion_evidence_ref" varchar(200),
	"deleted_at" timestamp with time zone,
	"last_error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_export_state_valid" CHECK ("organization_exports"."state" IN ('requested', 'generating', 'egress_pending', 'ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted', 'failed')),
	CONSTRAINT "organization_export_revision_positive" CHECK ("organization_exports"."revision" >= 1),
	CONSTRAINT "organization_export_recovery_attempts_nonnegative" CHECK ("organization_exports"."egress_recovery_attempts" >= 0),
	CONSTRAINT "organization_export_version_fixed" CHECK ("organization_exports"."format_version" = 'organization-export/v1'),
	CONSTRAINT "organization_export_object_expiry_bounded" CHECK ("organization_exports"."object_expires_at" > "organization_exports"."created_at" AND "organization_exports"."object_expires_at" <= "organization_exports"."created_at" + interval '7 days'),
	CONSTRAINT "organization_export_digest_shape" CHECK (("organization_exports"."coverage_sha256" IS NULL OR "organization_exports"."coverage_sha256" ~ '^[a-f0-9]{64}$')
          AND ("organization_exports"."manifest_sha256" IS NULL OR "organization_exports"."manifest_sha256" ~ '^[a-f0-9]{64}$')
          AND ("organization_exports"."archive_sha256" IS NULL OR "organization_exports"."archive_sha256" ~ '^[a-f0-9]{64}$')
          AND ("organization_exports"."retrieval_token_digest" IS NULL OR "organization_exports"."retrieval_token_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "organization_export_evidence_ref_shape" CHECK (("organization_exports"."encryption_evidence_ref" IS NULL OR "organization_exports"."encryption_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
          AND ("organization_exports"."deletion_evidence_ref" IS NULL OR "organization_exports"."deletion_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')),
	CONSTRAINT "organization_export_error_code_shape" CHECK ("organization_exports"."last_error_code" IS NULL OR "organization_exports"."last_error_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "organization_export_state_shape" CHECK ((
        "organization_exports"."state" = 'requested'
        AND "organization_exports"."generation_lease_expires_at" IS NULL
        AND "organization_exports"."coverage_sha256" IS NULL
        AND "organization_exports"."manifest_sha256" IS NULL
        AND "organization_exports"."archive_sha256" IS NULL
        AND "organization_exports"."object_key" IS NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."pre_egress_recorded_at" IS NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" = 'generating'
        AND "organization_exports"."generation_lease_expires_at" IS NOT NULL
        AND "organization_exports"."coverage_sha256" IS NULL
        AND "organization_exports"."manifest_sha256" IS NULL
        AND "organization_exports"."archive_sha256" IS NULL
        AND "organization_exports"."object_key" IS NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."pre_egress_recorded_at" IS NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" = 'egress_pending'
        AND "organization_exports"."generation_lease_expires_at" IS NOT NULL
        AND "organization_exports"."coverage_sha256" IS NOT NULL
        AND "organization_exports"."manifest_sha256" IS NOT NULL
        AND "organization_exports"."archive_sha256" IS NOT NULL
        AND "organization_exports"."object_key" IS NOT NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."pre_egress_recorded_at" IS NOT NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" IN ('ready', 'retrieval_issued', 'retrieved', 'delete_pending', 'deleted')
        AND "organization_exports"."generation_lease_expires_at" IS NULL
        AND "organization_exports"."coverage_sha256" IS NOT NULL
        AND "organization_exports"."manifest_sha256" IS NOT NULL
        AND "organization_exports"."archive_sha256" IS NOT NULL
        AND "organization_exports"."object_key" IS NOT NULL
        AND "organization_exports"."encryption_evidence_ref" IS NOT NULL
        AND "organization_exports"."last_error_code" IS NULL
      ) OR (
        "organization_exports"."state" = 'failed'
        AND "organization_exports"."generation_lease_expires_at" IS NULL
        AND "organization_exports"."encryption_evidence_ref" IS NULL
        AND "organization_exports"."last_error_code" IS NOT NULL
        AND (
          (
            "organization_exports"."coverage_sha256" IS NULL
            AND "organization_exports"."manifest_sha256" IS NULL
            AND "organization_exports"."archive_sha256" IS NULL
            AND "organization_exports"."object_key" IS NULL
            AND "organization_exports"."pre_egress_recorded_at" IS NULL
          ) OR (
            "organization_exports"."coverage_sha256" IS NOT NULL
            AND "organization_exports"."manifest_sha256" IS NOT NULL
            AND "organization_exports"."archive_sha256" IS NOT NULL
            AND "organization_exports"."object_key" IS NOT NULL
            AND "organization_exports"."pre_egress_recorded_at" IS NOT NULL
          )
        )
      )),
	CONSTRAINT "organization_export_retrieval_shape" CHECK ((
        "organization_exports"."state" = 'retrieval_issued'
        AND "organization_exports"."retrieval_operation_id" IS NOT NULL
        AND "organization_exports"."retrieval_token_digest" IS NOT NULL
        AND "organization_exports"."retrieval_issued_at" IS NOT NULL
        AND "organization_exports"."retrieval_expires_at" > "organization_exports"."retrieval_issued_at"
        AND "organization_exports"."retrieval_expires_at" <= "organization_exports"."retrieval_issued_at" + interval '24 hours'
        AND "organization_exports"."retrieval_expires_at" <= "organization_exports"."object_expires_at"
        AND "organization_exports"."retrieved_at" IS NULL
      ) OR (
        "organization_exports"."state" = 'retrieved'
        AND "organization_exports"."retrieval_operation_id" IS NOT NULL
        AND "organization_exports"."retrieval_token_digest" IS NULL
        AND "organization_exports"."retrieval_issued_at" IS NOT NULL
        AND "organization_exports"."retrieval_expires_at" IS NULL
        AND "organization_exports"."retrieved_at" IS NOT NULL
      ) OR (
        "organization_exports"."state" NOT IN ('retrieval_issued', 'retrieved')
        AND "organization_exports"."retrieval_operation_id" IS NULL
        AND "organization_exports"."retrieval_token_digest" IS NULL
        AND "organization_exports"."retrieval_issued_at" IS NULL
        AND "organization_exports"."retrieval_expires_at" IS NULL
        AND "organization_exports"."retrieved_at" IS NULL
      )),
	CONSTRAINT "organization_export_deletion_shape" CHECK ((
        "organization_exports"."state" = 'deleted'
        AND "organization_exports"."deleted_at" IS NOT NULL
        AND "organization_exports"."deletion_evidence_ref" IS NOT NULL
      ) OR (
        "organization_exports"."state" <> 'deleted'
        AND "organization_exports"."deleted_at" IS NULL
        AND "organization_exports"."deletion_evidence_ref" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "organization_lifecycle_authority" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"closure_lineage_id" uuid,
	"closure_requested_at" timestamp with time zone,
	"recoverable_until" timestamp with time zone,
	"irreversible_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reactivation_required" boolean DEFAULT false NOT NULL,
	"requested_by" varchar(255),
	"request_reason_code" varchar(64),
	"request_support_evidence_ref" varchar(200),
	"last_transition_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_actor_id" varchar(255) NOT NULL,
	"last_reason_code" varchar(64) NOT NULL,
	"last_support_evidence_ref" varchar(200) NOT NULL,
	CONSTRAINT "organization_lifecycle_state_valid" CHECK ("organization_lifecycle_authority"."state" IN ('active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed')),
	CONSTRAINT "organization_lifecycle_revision_nonnegative" CHECK ("organization_lifecycle_authority"."revision" >= 0),
	CONSTRAINT "organization_lifecycle_request_reason_valid" CHECK ("organization_lifecycle_authority"."request_reason_code" IS NULL OR "organization_lifecycle_authority"."request_reason_code" IN ('account_admin_request', 'contract_ended', 'duplicate_workspace', 'privacy_request', 'test_workspace')),
	CONSTRAINT "organization_lifecycle_evidence_ref_valid" CHECK ("organization_lifecycle_authority"."last_support_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
          AND ("organization_lifecycle_authority"."request_support_evidence_ref" IS NULL OR "organization_lifecycle_authority"."request_support_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')),
	CONSTRAINT "organization_lifecycle_reason_code_valid" CHECK ("organization_lifecycle_authority"."last_reason_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "organization_lifecycle_state_shape" CHECK ((
        "organization_lifecycle_authority"."state" = 'active'
        AND "organization_lifecycle_authority"."irreversible_at" IS NULL
        AND "organization_lifecycle_authority"."closed_at" IS NULL
        AND (
          ("organization_lifecycle_authority"."closure_lineage_id" IS NULL AND "organization_lifecycle_authority"."closure_requested_at" IS NULL AND "organization_lifecycle_authority"."recoverable_until" IS NULL AND "organization_lifecycle_authority"."requested_by" IS NULL AND "organization_lifecycle_authority"."request_reason_code" IS NULL AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NULL AND "organization_lifecycle_authority"."reactivation_required" = false)
          OR
          ("organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at" AND "organization_lifecycle_authority"."requested_by" IS NOT NULL AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL AND "organization_lifecycle_authority"."reactivation_required" = true)
        )
      ) OR (
        "organization_lifecycle_authority"."state" IN ('closure_requested', 'closing', 'purge_pending')
        AND "organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL
        AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL
        AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at"
        AND "organization_lifecycle_authority"."requested_by" IS NOT NULL
        AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL
        AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL
        AND "organization_lifecycle_authority"."irreversible_at" IS NULL
        AND "organization_lifecycle_authority"."closed_at" IS NULL
        AND "organization_lifecycle_authority"."reactivation_required" = true
      ) OR (
        "organization_lifecycle_authority"."state" = 'purging'
        AND "organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL
        AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL
        AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at"
        AND "organization_lifecycle_authority"."requested_by" IS NOT NULL
        AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL
        AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL
        AND "organization_lifecycle_authority"."irreversible_at" IS NOT NULL
        AND "organization_lifecycle_authority"."closed_at" IS NULL
        AND "organization_lifecycle_authority"."reactivation_required" = true
      ) OR (
        "organization_lifecycle_authority"."state" = 'closed'
        AND "organization_lifecycle_authority"."closure_lineage_id" IS NOT NULL
        AND "organization_lifecycle_authority"."closure_requested_at" IS NOT NULL
        AND "organization_lifecycle_authority"."recoverable_until" > "organization_lifecycle_authority"."closure_requested_at"
        AND "organization_lifecycle_authority"."requested_by" IS NOT NULL
        AND "organization_lifecycle_authority"."request_reason_code" IS NOT NULL
        AND "organization_lifecycle_authority"."request_support_evidence_ref" IS NOT NULL
        AND "organization_lifecycle_authority"."irreversible_at" IS NOT NULL
        AND "organization_lifecycle_authority"."closed_at" IS NOT NULL
        AND "organization_lifecycle_authority"."reactivation_required" = true
      ))
);
--> statement-breakpoint
CREATE TABLE "organization_lifecycle_command_receipts" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"operation" text NOT NULL,
	"result_state" text NOT NULL,
	"result_revision" integer NOT NULL,
	"closure_lineage_id" uuid,
	"closure_requested_at" timestamp with time zone,
	"recoverable_until" timestamp with time zone,
	"irreversible_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reactivation_required" boolean NOT NULL,
	"last_transition_at" timestamp with time zone NOT NULL,
	"last_actor_id" varchar(255) NOT NULL,
	"last_reason_code" varchar(64) NOT NULL,
	"last_support_evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_lifecycle_receipt_operation_valid" CHECK ("organization_lifecycle_command_receipts"."operation" IN ('request', 'cancel')),
	CONSTRAINT "organization_lifecycle_receipt_state_valid" CHECK ("organization_lifecycle_command_receipts"."result_state" IN ('active', 'closure_requested', 'closing', 'purge_pending', 'purging', 'closed')),
	CONSTRAINT "organization_lifecycle_receipt_revision_positive" CHECK ("organization_lifecycle_command_receipts"."result_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "context_organization_lifecycle_receipts" (
	"context" text NOT NULL,
	"organization_id" text NOT NULL,
	"closure_lineage_id" uuid NOT NULL,
	"lifecycle_revision" integer NOT NULL,
	"phase" text NOT NULL,
	"request_fingerprint" char(64) NOT NULL,
	"outcome" text NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"recoverable_until" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_organization_lifecycle_receipts_pk" PRIMARY KEY("context","closure_lineage_id","lifecycle_revision","phase"),
	CONSTRAINT "context_organization_lifecycle_receipts_revision_positive" CHECK ("context_organization_lifecycle_receipts"."lifecycle_revision" > 0),
	CONSTRAINT "context_organization_lifecycle_receipts_context_valid" CHECK ("context_organization_lifecycle_receipts"."context" IN ('activity', 'ai', 'dashboard', 'goal', 'guest', 'identity', 'inbox', 'integration', 'metric', 'notification', 'portal', 'property', 'review', 'staff')),
	CONSTRAINT "context_organization_lifecycle_receipts_phase_valid" CHECK ("context_organization_lifecycle_receipts"."phase" IN ('closing', 'purge_readiness', 'purge')),
	CONSTRAINT "context_organization_lifecycle_receipts_outcome_valid" CHECK ("context_organization_lifecycle_receipts"."outcome" IN ('complete', 'no_data')),
	CONSTRAINT "context_organization_lifecycle_receipts_fingerprint_valid" CHECK ("context_organization_lifecycle_receipts"."request_fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "context_organization_lifecycle_receipts_evidence_valid" CHECK ("context_organization_lifecycle_receipts"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);
--> statement-breakpoint
CREATE TABLE "backup_erasure_hold_releases" (
	"ledger_entry_id" uuid PRIMARY KEY NOT NULL,
	"hold_reference" varchar(200) NOT NULL,
	"authority_ref" varchar(200) NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_erasure_hold_releases_refs_valid" CHECK ("backup_erasure_hold_releases"."hold_reference" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND "backup_erasure_hold_releases"."authority_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);
--> statement-breakpoint
CREATE TABLE "backup_erasure_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_class" varchar(32) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"subject_ref" char(64),
	"context" varchar(32) NOT NULL,
	"closure_lineage_id" uuid NOT NULL,
	"lifecycle_revision" integer NOT NULL,
	"effective_erasure_at" timestamp with time zone NOT NULL,
	"erased_row_count" integer NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"hold_reference" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_erasure_ledger_subject_class_valid" CHECK ("backup_erasure_ledger"."subject_class" IN ('organization', 'property', 'privacy_subject')),
	CONSTRAINT "backup_erasure_ledger_context_valid" CHECK ("backup_erasure_ledger"."context" IN ('activity', 'ai', 'dashboard', 'goal', 'guest', 'identity', 'inbox', 'integration', 'metric', 'notification', 'portal', 'property', 'review', 'staff')),
	CONSTRAINT "backup_erasure_ledger_revision_positive" CHECK ("backup_erasure_ledger"."lifecycle_revision" > 0),
	CONSTRAINT "backup_erasure_ledger_count_nonnegative" CHECK ("backup_erasure_ledger"."erased_row_count" >= 0),
	CONSTRAINT "backup_erasure_ledger_evidence_valid" CHECK ("backup_erasure_ledger"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "backup_erasure_ledger_hold_valid" CHECK ("backup_erasure_ledger"."hold_reference" IS NULL OR "backup_erasure_ledger"."hold_reference" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'),
	CONSTRAINT "backup_erasure_ledger_subject_ref_valid" CHECK ("backup_erasure_ledger"."subject_ref" IS NULL OR "backup_erasure_ledger"."subject_ref" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "backup_erasure_ledger_scope_valid" CHECK (("backup_erasure_ledger"."subject_class" = 'organization' AND "backup_erasure_ledger"."property_id" IS NULL AND "backup_erasure_ledger"."subject_ref" IS NULL)
        OR ("backup_erasure_ledger"."subject_class" = 'property' AND "backup_erasure_ledger"."property_id" IS NOT NULL AND "backup_erasure_ledger"."subject_ref" IS NULL)
        OR ("backup_erasure_ledger"."subject_class" = 'privacy_subject' AND "backup_erasure_ledger"."subject_ref" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "property_erase_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"state" varchar(24) NOT NULL,
	"requested_by_user_id" varchar(255) NOT NULL,
	"identity_verification_ref" varchar(200) NOT NULL,
	"support_operator_id" varchar(255) NOT NULL,
	"support_authorization_ref" varchar(200) NOT NULL,
	"retention_preview_ref" varchar(200),
	"export_evidence_ref" varchar(200),
	"inventory_revision" integer DEFAULT 0 NOT NULL,
	"inventory_digest" char(64),
	"confirmation_digest" char(64),
	"grace_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"purge_started_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason_code" varchar(64),
	"evidence_ref" varchar(200) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_erase_authorities_state_valid" CHECK ("property_erase_authorities"."state" IN ('requested', 'previewed', 'confirmed', 'purge_pending', 'purging', 'purged', 'cancelled')),
	CONSTRAINT "property_erase_authorities_refs_valid" CHECK ("property_erase_authorities"."identity_verification_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND "property_erase_authorities"."support_authorization_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND "property_erase_authorities"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND ("property_erase_authorities"."retention_preview_ref" IS NULL OR "property_erase_authorities"."retention_preview_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("property_erase_authorities"."export_evidence_ref" IS NULL OR "property_erase_authorities"."export_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("property_erase_authorities"."cancel_reason_code" IS NULL OR "property_erase_authorities"."cancel_reason_code" ~ '^[a-z][a-z0-9_]{0,63}$')),
	CONSTRAINT "property_erase_authorities_digests_valid" CHECK (("property_erase_authorities"."inventory_digest" IS NULL OR "property_erase_authorities"."inventory_digest" ~ '^[a-f0-9]{64}$')
        AND ("property_erase_authorities"."confirmation_digest" IS NULL OR "property_erase_authorities"."confirmation_digest" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "property_erase_authorities_revision_valid" CHECK ("property_erase_authorities"."inventory_revision" >= 0),
	CONSTRAINT "property_erase_authorities_confirmation_complete" CHECK ("property_erase_authorities"."state" IN ('requested', 'previewed', 'cancelled')
        OR ("property_erase_authorities"."confirmation_digest" IS NOT NULL AND "property_erase_authorities"."inventory_digest" IS NOT NULL
          AND "property_erase_authorities"."retention_preview_ref" IS NOT NULL AND "property_erase_authorities"."confirmed_at" IS NOT NULL)),
	CONSTRAINT "property_erase_authorities_terminal_valid" CHECK (("property_erase_authorities"."state" = 'purged') = ("property_erase_authorities"."purged_at" IS NOT NULL)
        AND ("property_erase_authorities"."state" = 'cancelled') = ("property_erase_authorities"."cancelled_at" IS NOT NULL)
        AND ("property_erase_authorities"."state" NOT IN ('purging', 'purged') OR "property_erase_authorities"."purge_started_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "property_erase_context_receipts" (
	"authority_id" uuid NOT NULL,
	"context" varchar(32) NOT NULL,
	"phase" varchar(24) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"erased_row_count" integer NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_erase_context_receipts_pk" PRIMARY KEY("authority_id","context","phase"),
	CONSTRAINT "property_erase_context_receipts_phase_valid" CHECK ("property_erase_context_receipts"."phase" IN ('inventory', 'purge')),
	CONSTRAINT "property_erase_context_receipts_outcome_valid" CHECK ("property_erase_context_receipts"."outcome" IN ('complete', 'no_data')),
	CONSTRAINT "property_erase_context_receipts_count_valid" CHECK ("property_erase_context_receipts"."erased_row_count" >= 0),
	CONSTRAINT "property_erase_context_receipts_evidence_valid" CHECK ("property_erase_context_receipts"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);
--> statement-breakpoint
CREATE TABLE "privacy_request_transitions" (
	"request_id" uuid NOT NULL,
	"to_state" varchar(24) NOT NULL,
	"from_state" varchar(24) NOT NULL,
	"actor_type" varchar(24) NOT NULL,
	"actor_ref" varchar(255) NOT NULL,
	"evidence_ref" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_request_transitions_pk" PRIMARY KEY("request_id","to_state"),
	CONSTRAINT "privacy_request_transitions_states_valid" CHECK ("privacy_request_transitions"."to_state" IN ('received', 'verified', 'in_progress', 'fulfilled', 'refused') AND "privacy_request_transitions"."from_state" IN ('received', 'verified', 'in_progress', 'fulfilled', 'refused')),
	CONSTRAINT "privacy_request_transitions_actor_valid" CHECK ("privacy_request_transitions"."actor_type" IN ('subject', 'operator', 'system')),
	CONSTRAINT "privacy_request_transitions_evidence_valid" CHECK ("privacy_request_transitions"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"subject_type" varchar(24) NOT NULL,
	"subject_ref" char(64) NOT NULL,
	"request_kind" varchar(24) NOT NULL,
	"state" varchar(24) NOT NULL,
	"verification_ref" varchar(200),
	"refusal_reason_code" varchar(64),
	"target_field" varchar(64),
	"content_classification" varchar(24) NOT NULL,
	"package_ref" varchar(200),
	"package_expires_at" timestamp with time zone,
	"evidence_ref" varchar(200) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_state_valid" CHECK ("privacy_requests"."state" IN ('received', 'verified', 'in_progress', 'fulfilled', 'refused')),
	CONSTRAINT "privacy_requests_kind_valid" CHECK ("privacy_requests"."request_kind" IN ('access', 'correction', 'withdrawal', 'erasure')),
	CONSTRAINT "privacy_requests_subject_type_valid" CHECK ("privacy_requests"."subject_type" IN ('guest', 'participant')),
	CONSTRAINT "privacy_requests_classification_valid" CHECK ("privacy_requests"."content_classification" IN ('content_free', 'personal', 'sensitive')),
	CONSTRAINT "privacy_requests_subject_ref_valid" CHECK ("privacy_requests"."subject_ref" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "privacy_requests_refs_valid" CHECK ("privacy_requests"."evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'
        AND ("privacy_requests"."verification_ref" IS NULL OR "privacy_requests"."verification_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("privacy_requests"."package_ref" IS NULL OR "privacy_requests"."package_ref" ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$')
        AND ("privacy_requests"."refusal_reason_code" IS NULL OR "privacy_requests"."refusal_reason_code" ~ '^[a-z][a-z0-9_]{0,63}$')
        AND ("privacy_requests"."target_field" IS NULL OR "privacy_requests"."target_field" ~ '^[a-z][a-z0-9_]{0,63}$')),
	CONSTRAINT "privacy_requests_verification_required" CHECK ("privacy_requests"."state" = 'received'
        OR ("privacy_requests"."verified_at" IS NOT NULL AND "privacy_requests"."verification_ref" IS NOT NULL)),
	CONSTRAINT "privacy_requests_refusal_reason_required" CHECK (("privacy_requests"."state" = 'refused') = ("privacy_requests"."refusal_reason_code" IS NOT NULL)),
	CONSTRAINT "privacy_requests_completion_valid" CHECK (("privacy_requests"."state" IN ('fulfilled', 'refused')) = ("privacy_requests"."completed_at" IS NOT NULL)),
	CONSTRAINT "privacy_requests_package_valid" CHECK ("privacy_requests"."package_ref" IS NULL
        OR ("privacy_requests"."request_kind" = 'access' AND "privacy_requests"."package_expires_at" IS NOT NULL
          AND "privacy_requests"."package_expires_at" > "privacy_requests"."received_at")),
	CONSTRAINT "privacy_requests_target_field_valid" CHECK ("privacy_requests"."target_field" IS NULL OR "privacy_requests"."request_kind" IN ('correction', 'withdrawal'))
);
--> statement-breakpoint
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
	"attributed_staff_participant_id" uuid,
	"attributed_staff_participation_id" uuid,
	"attribution_responsibility_id" uuid,
	"staff_attribution_effective_from" timestamp with time zone,
	"staff_attribution_effective_to" timestamp with time zone,
	CONSTRAINT "metric_corrections_kind_check" CHECK ("metric_corrections"."kind" IN ('retract', 'replace', 'adjust')),
	CONSTRAINT "metric_corrections_operand_check" CHECK (("metric_corrections"."kind" = 'retract' AND "metric_corrections"."exact_delta" IS NULL AND "metric_corrections"."replacement_value" IS NULL)
        OR ("metric_corrections"."kind" = 'replace' AND "metric_corrections"."exact_delta" IS NULL AND "metric_corrections"."replacement_value" IS NOT NULL)
        OR ("metric_corrections"."kind" = 'adjust' AND "metric_corrections"."exact_delta" IS NOT NULL AND "metric_corrections"."replacement_value" IS NULL)),
	CONSTRAINT "metric_corrections_staff_attribution_complete" CHECK (("metric_corrections"."attributed_staff_participant_id" IS NULL AND "metric_corrections"."attributed_staff_participation_id" IS NULL AND "metric_corrections"."attribution_responsibility_id" IS NULL AND "metric_corrections"."staff_attribution_effective_from" IS NULL AND "metric_corrections"."staff_attribution_effective_to" IS NULL) OR ("metric_corrections"."attributed_staff_participant_id" IS NOT NULL AND "metric_corrections"."attributed_staff_participation_id" IS NOT NULL AND "metric_corrections"."attribution_responsibility_id" IS NOT NULL AND "metric_corrections"."staff_attribution_effective_from" IS NOT NULL AND ("metric_corrections"."staff_attribution_effective_to" IS NULL OR "metric_corrections"."staff_attribution_effective_to" > "metric_corrections"."staff_attribution_effective_from")))
);
--> statement-breakpoint
CREATE TABLE "metric_current_google_reputation_snapshots" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"source_epoch" integer NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"review_count" integer NOT NULL,
	"average_rating" double precision,
	"evaluated_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_current_google_reputation_source_epoch_valid" CHECK ("metric_current_google_reputation_snapshots"."source_epoch" BETWEEN 0 AND 2147483647),
	CONSTRAINT "metric_current_google_reputation_value_valid" CHECK (("metric_current_google_reputation_snapshots"."review_count" = 0 AND "metric_current_google_reputation_snapshots"."average_rating" IS NULL)
        OR ("metric_current_google_reputation_snapshots"."review_count" BETWEEN 1 AND 10000
          AND "metric_current_google_reputation_snapshots"."average_rating" BETWEEN 0 AND 5))
);
--> statement-breakpoint
CREATE TABLE "metric_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid,
	"group_id" uuid,
	"metric_key" varchar(100) NOT NULL,
	"value" real NOT NULL,
	"definition_version_id" uuid,
	"source_event_id" varchar(255),
	"source_policy" varchar(80),
	"exact_value" numeric(30, 10),
	"numerator" numeric(30, 10),
	"denominator" numeric(30, 10),
	"sample_count" integer,
	"attribution_quality" varchar(40),
	"recorded_at" timestamp with time zone NOT NULL,
	"event_at" timestamp with time zone,
	"property_local_date" varchar(10),
	"data_quality" varchar(20),
	"retention_class" varchar(50),
	"portal_destination_kind" varchar(24),
	"attributed_staff_participant_id" uuid,
	"attributed_staff_participation_id" uuid,
	"attribution_responsibility_id" uuid,
	"staff_attribution_effective_from" timestamp with time zone,
	"staff_attribution_effective_to" timestamp with time zone,
	CONSTRAINT "metric_readings_attribution_quality_check" CHECK ("metric_readings"."attribution_quality" IS NULL OR "metric_readings"."attribution_quality" IN ('exact', 'current_state_backfill', 'unresolved')),
	CONSTRAINT "metric_readings_ratio_check" CHECK (("metric_readings"."numerator" IS NULL AND "metric_readings"."denominator" IS NULL) OR ("metric_readings"."numerator" IS NOT NULL AND "metric_readings"."denominator" IS NOT NULL AND "metric_readings"."denominator" > 0)),
	CONSTRAINT "metric_readings_governed_provenance_check" CHECK ("metric_readings"."definition_version_id" IS NULL OR ("metric_readings"."source_event_id" IS NOT NULL AND "metric_readings"."source_policy" IS NOT NULL AND "metric_readings"."exact_value" IS NOT NULL AND "metric_readings"."sample_count" IS NOT NULL AND "metric_readings"."attribution_quality" IS NOT NULL AND "metric_readings"."event_at" IS NOT NULL AND "metric_readings"."property_local_date" IS NOT NULL AND "metric_readings"."data_quality" IS NOT NULL AND "metric_readings"."retention_class" IS NOT NULL)),
	CONSTRAINT "metric_readings_staff_attribution_complete" CHECK (("metric_readings"."attributed_staff_participant_id" IS NULL AND "metric_readings"."attributed_staff_participation_id" IS NULL AND "metric_readings"."attribution_responsibility_id" IS NULL AND "metric_readings"."staff_attribution_effective_from" IS NULL AND "metric_readings"."staff_attribution_effective_to" IS NULL) OR ("metric_readings"."portal_id" IS NOT NULL AND "metric_readings"."attributed_staff_participant_id" IS NOT NULL AND "metric_readings"."attributed_staff_participation_id" IS NOT NULL AND "metric_readings"."attribution_responsibility_id" IS NOT NULL AND "metric_readings"."staff_attribution_effective_from" IS NOT NULL AND ("metric_readings"."staff_attribution_effective_to" IS NULL OR "metric_readings"."staff_attribution_effective_to" > "metric_readings"."staff_attribution_effective_from"))),
	CONSTRAINT "metric_readings_portal_destination_kind_check" CHECK ("metric_readings"."portal_destination_kind" IS NULL OR ("metric_readings"."metric_key" = 'portal.review_link_click' AND "metric_readings"."portal_destination_kind" IN ('google_review', 'secondary_link')))
);
--> statement-breakpoint
CREATE TABLE "portal_metric_lifetime_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"qualified_scan_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_sum" bigint DEFAULT 0 NOT NULL,
	"private_rating_1_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_2_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_3_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_4_count" bigint DEFAULT 0 NOT NULL,
	"private_rating_5_count" bigint DEFAULT 0 NOT NULL,
	"private_feedback_count" bigint DEFAULT 0 NOT NULL,
	"google_review_selection_count" bigint DEFAULT 0 NOT NULL,
	"secondary_link_selection_count" bigint DEFAULT 0 NOT NULL,
	"sealed_qualified_scan_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_sum" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_1_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_2_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_3_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_4_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_rating_5_count" bigint DEFAULT 0 NOT NULL,
	"sealed_private_feedback_count" bigint DEFAULT 0 NOT NULL,
	"sealed_google_review_selection_count" bigint DEFAULT 0 NOT NULL,
	"sealed_secondary_link_selection_count" bigint DEFAULT 0 NOT NULL,
	"sealed_through_local_date" varchar(10),
	"projection_revision" bigint DEFAULT 0 NOT NULL,
	"last_rebuilt_at" timestamp with time zone,
	"last_sealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_metric_lifetime_nonnegative_check" CHECK ("portal_metric_lifetime_aggregates"."qualified_scan_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_sum" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_1_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_2_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_3_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_4_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_rating_5_count" >= 0 AND "portal_metric_lifetime_aggregates"."private_feedback_count" >= 0 AND "portal_metric_lifetime_aggregates"."google_review_selection_count" >= 0 AND "portal_metric_lifetime_aggregates"."secondary_link_selection_count" >= 0),
	CONSTRAINT "portal_metric_lifetime_rating_check" CHECK ("portal_metric_lifetime_aggregates"."private_rating_1_count" + "portal_metric_lifetime_aggregates"."private_rating_2_count" + "portal_metric_lifetime_aggregates"."private_rating_3_count" + "portal_metric_lifetime_aggregates"."private_rating_4_count" + "portal_metric_lifetime_aggregates"."private_rating_5_count" = "portal_metric_lifetime_aggregates"."private_rating_count" AND "portal_metric_lifetime_aggregates"."private_rating_sum" BETWEEN "portal_metric_lifetime_aggregates"."private_rating_count" AND "portal_metric_lifetime_aggregates"."private_rating_count" * 5),
	CONSTRAINT "portal_metric_lifetime_sealed_nonnegative_check" CHECK ("portal_metric_lifetime_aggregates"."sealed_qualified_scan_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_sum" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_1_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_2_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_3_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_4_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_rating_5_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_private_feedback_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_google_review_selection_count" >= 0 AND "portal_metric_lifetime_aggregates"."sealed_secondary_link_selection_count" >= 0),
	CONSTRAINT "portal_metric_lifetime_sealed_rating_check" CHECK ("portal_metric_lifetime_aggregates"."sealed_private_rating_1_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_2_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_3_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_4_count" + "portal_metric_lifetime_aggregates"."sealed_private_rating_5_count" = "portal_metric_lifetime_aggregates"."sealed_private_rating_count" AND "portal_metric_lifetime_aggregates"."sealed_private_rating_sum" BETWEEN "portal_metric_lifetime_aggregates"."sealed_private_rating_count" AND "portal_metric_lifetime_aggregates"."sealed_private_rating_count" * 5),
	CONSTRAINT "portal_metric_lifetime_sealed_boundary_check" CHECK ("portal_metric_lifetime_aggregates"."sealed_through_local_date" IS NULL OR "portal_metric_lifetime_aggregates"."sealed_through_local_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "notification_digest_batch_members" (
	"batch_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"notification_email_id" uuid NOT NULL,
	"sort_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_batch_members_pk" PRIMARY KEY("batch_id","notification_email_id"),
	CONSTRAINT "notification_digest_batch_members_sort_index_nonnegative" CHECK ("notification_digest_batch_members"."sort_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_digest_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"local_date" date NOT NULL,
	"sequence" integer NOT NULL,
	"member_digest" varchar(64) NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"provider_idempotency_key" varchar(96) NOT NULL,
	"unsubscribe_key_version" varchar(32) DEFAULT 'legacy' NOT NULL,
	"state" varchar(16) DEFAULT 'prepared' NOT NULL,
	"provider_message_id" varchar(255),
	"outcome_class" varchar(24),
	"terminal_reason" varchar(64),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_batches_state_valid" CHECK ("notification_digest_batches"."state" IN ('prepared', 'retryable', 'accepted', 'terminal')),
	CONSTRAINT "notification_digest_batches_sequence_positive" CHECK ("notification_digest_batches"."sequence" > 0),
	CONSTRAINT "notification_digest_batches_member_digest_valid" CHECK ("notification_digest_batches"."member_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "notification_digest_batches_content_digest_valid" CHECK ("notification_digest_batches"."content_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "notification_email_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"category" varchar(40) NOT NULL,
	"cadence" varchar(16) DEFAULT 'daily' NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"provider_message_id" varchar(255),
	"provider_state" varchar(24),
	"last_error_class" varchar(24),
	"suppression_reason" varchar(255),
	"not_before" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_email_queue_mandatory_scope_check" CHECK ((
        "notification_email_queue"."category" = 'mandatory'
        AND "notification_email_queue"."property_id" IS NULL
        AND "notification_email_queue"."cadence" = 'immediate'
      ) OR (
        "notification_email_queue"."category" <> 'mandatory'
        AND "notification_email_queue"."property_id" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"category" varchar(40) NOT NULL,
	"channel" varchar(16) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence" varchar(16) DEFAULT 'daily' NOT NULL,
	"urgent_bypass_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_channel_valid" CHECK ("notification_preferences"."channel" IN ('in_app', 'email')),
	CONSTRAINT "notification_preferences_cadence_valid" CHECK ("notification_preferences"."cadence" IN ('immediate', 'daily')),
	CONSTRAINT "notification_preferences_quiet_pair" CHECK (("notification_preferences"."quiet_hours_start" IS NULL) = ("notification_preferences"."quiet_hours_end" IS NULL)),
	CONSTRAINT "notification_preferences_required_enabled" CHECK ("notification_preferences"."enabled" OR (
        "notification_preferences"."category" <> 'mandatory'
        AND NOT ("notification_preferences"."category" = 'urgent_operational' AND "notification_preferences"."channel" = 'in_app')
      )),
	CONSTRAINT "notification_preferences_configurable_category_check" CHECK ("notification_preferences"."category" <> 'mandatory')
);
--> statement-breakpoint
CREATE TABLE "notification_user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"locale" varchar(35) DEFAULT 'en' NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"type" varchar(64) NOT NULL,
	"category" varchar(40) NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"status" varchar(16) DEFAULT 'unread' NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"payload" jsonb,
	"coalesced_count" integer DEFAULT 1 NOT NULL,
	"coalesced_latest_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_source_content_free_check" CHECK (NOT (COALESCE("notifications"."payload", '{}'::jsonb) ? 'rating') AND CASE WHEN COALESCE("notifications"."payload", '{}'::jsonb) ? 'guestRating' THEN COALESCE("notifications"."payload"->>'platform' = 'portal' AND jsonb_typeof("notifications"."payload"->'guestRating') = 'number' AND "notifications"."payload"->>'guestRating' = ANY (ARRAY['1', '2', '3', '4', '5']::text[]), false) ELSE true END),
	CONSTRAINT "notifications_mandatory_scope_check" CHECK ((
        "notifications"."category" = 'mandatory'
        AND "notifications"."property_id" IS NULL
        AND "notifications"."resource_type" = 'organization'
      ) OR (
        "notifications"."category" <> 'mandatory'
        AND "notifications"."property_id" IS NOT NULL
        AND "notifications"."resource_type" <> 'organization'
      ))
);
--> statement-breakpoint
CREATE TABLE "event_consumer_receipts" (
	"event_id" uuid NOT NULL,
	"consumer_name" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_consumer_receipts_event_id_consumer_name_pk" PRIMARY KEY("event_id","consumer_name"),
	CONSTRAINT "event_consumer_receipts_status_check" CHECK ("event_consumer_receipts"."status" IN ('applied', 'duplicate', 'obsolete'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_receipts" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_receipts_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" varchar(255),
	"source_context" text NOT NULL,
	"source_aggregate_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"lease_owner" text,
	"leased_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"recovery_fence_run_id" uuid,
	"recovery_fenced_at" timestamp with time zone,
	CONSTRAINT "outbox_events_recovery_fence_pair_check" CHECK (("outbox_events"."recovery_fence_run_id" IS NULL) = ("outbox_events"."recovery_fenced_at" IS NULL)),
	CONSTRAINT "outbox_events_identity_member_invited_v2_check" CHECK ("outbox_events"."event_type" <> 'identity.member.invited'
        OR (
          "outbox_events"."event_version" = 2
          AND jsonb_typeof("outbox_events"."payload") = 'object'
          AND NOT ("outbox_events"."payload" ? 'email')
        ))
);
--> statement-breakpoint
CREATE TABLE "portal_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"portal_group_id" uuid NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "portal_responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"staff_participation_id" uuid NOT NULL,
	"kind" "responsibility_kind" DEFAULT 'primary' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" text,
	CONSTRAINT "pr_interval_valid" CHECK ("portal_responsibilities"."effective_to" IS NULL OR "portal_responsibilities"."effective_to" > "portal_responsibilities"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "property_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"kind" "grant_kind" NOT NULL,
	"status" "grant_status" DEFAULT 'active' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"granted_by" varchar(255) NOT NULL,
	"revoked_by" varchar(255),
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "staff_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"status" "staff_participant_status" DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_participants_lifecycle_consistent" CHECK (("staff_participants"."status" = 'active' AND "staff_participants"."archived_at" IS NULL AND "staff_participants"."archive_reason" IS NULL) OR ("staff_participants"."status" = 'archived' AND "staff_participants"."archived_at" IS NOT NULL AND "staff_participants"."archive_reason" IS NOT NULL)),
	CONSTRAINT "staff_participants_revision_positive" CHECK ("staff_participants"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "staff_participations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"staff_participant_id" uuid,
	"user_id" varchar(255),
	"display_name" varchar(255) NOT NULL,
	"status" "participation_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"archive_reason" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sp_lifecycle_consistent" CHECK (("staff_participations"."status" = 'active' AND "staff_participations"."ended_at" IS NULL) OR ("staff_participations"."status" <> 'active' AND "staff_participations"."ended_at" IS NOT NULL)),
	CONSTRAINT "sp_archive_reason_consistent" CHECK (("staff_participations"."status" = 'archived' AND "staff_participations"."archive_reason" IS NOT NULL) OR ("staff_participations"."status" <> 'archived' AND "staff_participations"."archive_reason" IS NULL)),
	CONSTRAINT "sp_revision_positive" CHECK ("staff_participations"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "staff_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"staff_participant_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" text,
	CONSTRAINT "staff_user_links_interval_valid" CHECK ("staff_user_links"."effective_to" IS NULL OR "staff_user_links"."effective_to" > "staff_user_links"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "policy_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"purpose" text NOT NULL,
	"state" text DEFAULT 'granted' NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "policy_consent_subject_check" CHECK ("policy_consent"."subject_type" IN ('organization', 'property', 'user')),
	CONSTRAINT "policy_consent_state_check" CHECK ("policy_consent"."state" IN ('granted', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "property_access_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	CONSTRAINT "property_access_grant_source_check" CHECK ("property_access_grant"."source" IN ('operator', 'migration', 'invitation'))
);
--> statement-breakpoint
CREATE TABLE "merchant_ai_consent_evidence" (
	"authorization_lineage_id" uuid NOT NULL,
	"state_version" integer NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"transition_kind" text NOT NULL,
	"state" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"capability_runtime_profile_versions" jsonb NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"reply_drafting_epoch" integer NOT NULL,
	"property_trends_epoch" integer NOT NULL,
	"authorized_source_epoch" integer NOT NULL,
	"analysis_start_sequence" bigint NOT NULL,
	"notice_version" varchar(100) NOT NULL,
	"notice_digest" varchar(64) NOT NULL,
	"source_policy_id" varchar(150) NOT NULL,
	"routing_policy_version" integer NOT NULL,
	"processing_region" varchar(20) NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"redaction_profile_family" varchar(100) NOT NULL,
	"actor_user_id" varchar(255) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "merchant_ai_consent_evidence_pk" PRIMARY KEY("authorization_lineage_id","state_version"),
	CONSTRAINT "merchant_ai_consent_evidence_transition_valid" CHECK ("merchant_ai_consent_evidence"."transition_kind" IN ('enable', 'change', 'revoke', 'restore_reset', 'analysis_backfill')),
	CONSTRAINT "merchant_ai_consent_evidence_state_valid" CHECK ("merchant_ai_consent_evidence"."state" IN ('disabled', 'enabled', 'revoked')),
	CONSTRAINT "merchant_ai_consent_evidence_versions_valid" CHECK ("merchant_ai_consent_evidence"."state_version" >= 1 AND "merchant_ai_consent_evidence"."review_analysis_epoch" >= 1 AND "merchant_ai_consent_evidence"."reply_drafting_epoch" >= 1 AND "merchant_ai_consent_evidence"."property_trends_epoch" >= 1 AND "merchant_ai_consent_evidence"."authorized_source_epoch" >= 0 AND "merchant_ai_consent_evidence"."analysis_start_sequence" >= 0 AND "merchant_ai_consent_evidence"."routing_policy_version" >= 1),
	CONSTRAINT "merchant_ai_consent_evidence_analysis_sequence_safe" CHECK ("merchant_ai_consent_evidence"."analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "merchant_ai_consent_evidence_region_valid" CHECK ("merchant_ai_consent_evidence"."processing_region" = 'global'),
	CONSTRAINT "merchant_ai_consent_evidence_profile_valid" CHECK ("merchant_ai_consent_evidence"."provider_deployment_profile_version" = 'private-beta-global-v1'),
	CONSTRAINT "merchant_ai_consent_evidence_notice_digest_valid" CHECK ("merchant_ai_consent_evidence"."notice_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK ((
          ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-09-06.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8')
        )
        AND "merchant_ai_consent_evidence"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_consent_evidence"."routing_policy_version" = 1
        AND "merchant_ai_consent_evidence"."redaction_profile_family" = 'gbp-review-global-v1'),
	CONSTRAINT "merchant_ai_consent_evidence_capabilities_valid" CHECK ((
    (
      "state" = 'enabled'
      AND (
        "capabilities" = ARRAY['review_analysis']::text[]
        OR "capabilities" = ARRAY['reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'property_trends']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]
      )
    )
    OR ("state" IN ('disabled', 'revoked') AND "capabilities" = ARRAY[]::text[])
  )),
	CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid" CHECK ((
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
  )),
	CONSTRAINT "merchant_ai_consent_evidence_request_hash_valid" CHECK ("merchant_ai_consent_evidence"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "merchant_ai_consent_evidence_reason_valid" CHECK ("merchant_ai_consent_evidence"."reason_code" ~ '^[a-z][a-z0-9_]{2,63}$')
);
--> statement-breakpoint
CREATE TABLE "merchant_ai_enablement" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"authorization_lineage_id" uuid NOT NULL,
	"state" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"capability_runtime_profile_versions" jsonb NOT NULL,
	"review_analysis_epoch" integer NOT NULL,
	"reply_drafting_epoch" integer NOT NULL,
	"property_trends_epoch" integer NOT NULL,
	"authorized_source_epoch" integer NOT NULL,
	"analysis_start_sequence" bigint NOT NULL,
	"state_version" integer NOT NULL,
	"notice_version" varchar(100) NOT NULL,
	"notice_digest" varchar(64) NOT NULL,
	"source_policy_id" varchar(150) NOT NULL,
	"routing_policy_version" integer NOT NULL,
	"processing_region" varchar(20) NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"redaction_profile_family" varchar(100) NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "merchant_ai_enablement_state_valid" CHECK ("merchant_ai_enablement"."state" IN ('disabled', 'enabled', 'revoked')),
	CONSTRAINT "merchant_ai_enablement_versions_valid" CHECK ("merchant_ai_enablement"."state_version" >= 1 AND "merchant_ai_enablement"."review_analysis_epoch" >= 1 AND "merchant_ai_enablement"."reply_drafting_epoch" >= 1 AND "merchant_ai_enablement"."property_trends_epoch" >= 1 AND "merchant_ai_enablement"."authorized_source_epoch" >= 0 AND "merchant_ai_enablement"."analysis_start_sequence" >= 0 AND "merchant_ai_enablement"."routing_policy_version" >= 1),
	CONSTRAINT "merchant_ai_enablement_analysis_sequence_safe" CHECK ("merchant_ai_enablement"."analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "merchant_ai_enablement_region_valid" CHECK ("merchant_ai_enablement"."processing_region" = 'global'),
	CONSTRAINT "merchant_ai_enablement_profile_valid" CHECK ("merchant_ai_enablement"."provider_deployment_profile_version" = 'private-beta-global-v1'),
	CONSTRAINT "merchant_ai_enablement_notice_digest_valid" CHECK ("merchant_ai_enablement"."notice_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK ((
          ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_enablement"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-09-06.v1'
            AND "merchant_ai_enablement"."notice_digest" = '7bb8d9bddbec630d90f546ba4d0f308076840e25786389a19e1c651dd21434a8')
        )
        AND "merchant_ai_enablement"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_enablement"."routing_policy_version" = 1
        AND "merchant_ai_enablement"."redaction_profile_family" = 'gbp-review-global-v1'),
	CONSTRAINT "merchant_ai_enablement_capabilities_valid" CHECK ((
    (
      "state" = 'enabled'
      AND (
        "capabilities" = ARRAY['review_analysis']::text[]
        OR "capabilities" = ARRAY['reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'property_trends']::text[]
        OR "capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[]
      )
    )
    OR ("state" IN ('disabled', 'revoked') AND "capabilities" = ARRAY[]::text[])
  )),
	CONSTRAINT "merchant_ai_enablement_runtime_map_valid" CHECK ((
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
  ))
);
--> statement-breakpoint
CREATE TABLE "portal_access_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"portal_token_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'published' NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "portal_access_artifacts_channel_valid" CHECK ("portal_access_artifacts"."channel" IN ('qr', 'nfc')),
	CONSTRAINT "portal_access_artifacts_status_valid" CHECK ("portal_access_artifacts"."status" IN ('published', 'retiring', 'retired', 'revoked')),
	CONSTRAINT "portal_access_artifacts_retirement_valid" CHECK (("portal_access_artifacts"."status" = 'published' AND "portal_access_artifacts"."retired_at" IS NULL) OR ("portal_access_artifacts"."status" <> 'published' AND "portal_access_artifacts"."retired_at" IS NOT NULL AND "portal_access_artifacts"."retired_at" >= "portal_access_artifacts"."published_at"))
);
--> statement-breakpoint
CREATE TABLE "portal_approved_destinations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"normalized_uri" varchar(500) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"approval_state" varchar(20) NOT NULL,
	"validation_version" varchar(80) NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"approved_by" varchar(255),
	"approved_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" varchar(500),
	"last_validated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_approved_destinations_source_valid" CHECK ("portal_approved_destinations"."source_type" IN ('recognized', 'custom', 'provider')),
	CONSTRAINT "portal_approved_destinations_state_valid" CHECK ("portal_approved_destinations"."approval_state" IN ('pending', 'approved', 'disabled', 'quarantined')),
	CONSTRAINT "portal_approved_destinations_approval_valid" CHECK (("portal_approved_destinations"."approval_state" = 'approved' AND "portal_approved_destinations"."approved_by" IS NOT NULL AND "portal_approved_destinations"."approved_at" IS NOT NULL AND "portal_approved_destinations"."disabled_at" IS NULL) OR ("portal_approved_destinations"."approval_state" <> 'approved'))
);
--> statement-breakpoint
CREATE TABLE "portal_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_group_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"sort_key" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "portal_health_intervals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"reason" varchar(80) NOT NULL,
	"source_version" varchar(160) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_health_intervals_status_valid" CHECK ("portal_health_intervals"."status" IN ('healthy', 'degraded', 'unavailable')),
	CONSTRAINT "portal_health_intervals_interval_valid" CHECK ("portal_health_intervals"."effective_to" IS NULL OR "portal_health_intervals"."effective_to" > "portal_health_intervals"."effective_from"),
	CONSTRAINT "portal_health_intervals_observation_valid" CHECK ("portal_health_intervals"."observed_at" >= "portal_health_intervals"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "portal_link_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"title" varchar(100) NOT NULL,
	"sort_key" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"destination_id" uuid,
	"url" varchar(500),
	"legacy_destination_state" varchar(20) DEFAULT 'unclassified' NOT NULL,
	"icon_key" varchar(50),
	"sort_key" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_links_destination_authority_valid" CHECK (("portal_links"."destination_id" IS NOT NULL AND "portal_links"."url" IS NULL AND "portal_links"."legacy_destination_state" = 'migrated') OR ("portal_links"."destination_id" IS NULL AND "portal_links"."url" IS NOT NULL AND "portal_links"."legacy_destination_state" IN ('unclassified', 'quarantined')))
);
--> statement-breakpoint
CREATE TABLE "portal_localized_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"locale" varchar(35) NOT NULL,
	"title" varchar(120),
	"short_description" varchar(500),
	"hero_image_url" varchar(500),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_localized_overrides_locale_active" CHECK ("portal_localized_overrides"."locale" IN ('en', 'bg')),
	CONSTRAINT "portal_localized_overrides_version_positive" CHECK ("portal_localized_overrides"."version" >= 1),
	CONSTRAINT "portal_localized_overrides_has_value" CHECK ("portal_localized_overrides"."title" IS NOT NULL OR "portal_localized_overrides"."short_description" IS NOT NULL OR "portal_localized_overrides"."hero_image_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "portal_pending_content_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"change_kind" varchar(40) NOT NULL,
	"change_key" varchar(160) DEFAULT 'all' NOT NULL,
	"source_version" varchar(160) NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"resolved_snapshot_id" uuid,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "portal_pending_content_changes_kind_valid" CHECK ("portal_pending_content_changes"."change_kind" IN ('portal_configuration', 'portal_links', 'property_brand_profile', 'property_brand_content', 'portal_localized_override', 'approved_destination')),
	CONSTRAINT "portal_pending_content_changes_resolution_pair" CHECK (("portal_pending_content_changes"."resolved_snapshot_id" IS NULL) = ("portal_pending_content_changes"."resolved_at" IS NULL)),
	CONSTRAINT "portal_pending_content_changes_resolution_time" CHECK ("portal_pending_content_changes"."resolved_at" IS NULL OR "portal_pending_content_changes"."resolved_at" >= "portal_pending_content_changes"."changed_at")
);
--> statement-breakpoint
CREATE TABLE "portal_publication_activations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"activation_sequence" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"activated_by" varchar(255) NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivation_reason" varchar(20),
	CONSTRAINT "portal_publication_activations_sequence_positive" CHECK ("portal_publication_activations"."activation_sequence" >= 1),
	CONSTRAINT "portal_publication_activations_kind_valid" CHECK ("portal_publication_activations"."kind" IN ('publish', 'rollback')),
	CONSTRAINT "portal_publication_activations_interval_valid" CHECK ("portal_publication_activations"."deactivated_at" IS NULL OR "portal_publication_activations"."deactivated_at" >= "portal_publication_activations"."activated_at"),
	CONSTRAINT "portal_publication_activations_deactivation_valid" CHECK (("portal_publication_activations"."deactivated_at" IS NULL AND "portal_publication_activations"."deactivation_reason" IS NULL) OR ("portal_publication_activations"."deactivated_at" IS NOT NULL AND "portal_publication_activations"."deactivation_reason" IN ('disabled', 'archived', 'replaced')))
);
--> statement-breakpoint
CREATE TABLE "portal_publication_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"configuration_digest" varchar(64) NOT NULL,
	"configuration" jsonb NOT NULL,
	"guest_locale" varchar(35) NOT NULL,
	"language_pack_version" varchar(100) NOT NULL,
	"locale_set" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"language_pack_versions" jsonb DEFAULT '{"en": "guest-ui-en-v1"}'::jsonb NOT NULL,
	"localized_content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brand_profile_version" integer,
	"private_feedback_threshold" integer NOT NULL,
	"contact_request_enabled" boolean DEFAULT false NOT NULL,
	"contact_notice_id" varchar(100),
	"contact_notice_version" varchar(100),
	"contact_notice_digest" varchar(64),
	"contact_notice_locale" varchar(35),
	"contact_request_purpose" varchar(50) DEFAULT 'manager_follow_up' NOT NULL,
	"contact_retention_policy_version" varchar(100) DEFAULT 'guest-contact-retention-30d-v1' NOT NULL,
	"destination_uri" varchar(500) NOT NULL,
	"destination_retrieved_at" timestamp with time zone NOT NULL,
	"destination_source_epoch" integer NOT NULL,
	"destination_profile_version" integer NOT NULL,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portal_publication_snapshots_version_positive" CHECK ("portal_publication_snapshots"."version" >= 1),
	CONSTRAINT "portal_publication_snapshots_digest_valid" CHECK ("portal_publication_snapshots"."configuration_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "portal_publication_snapshots_configuration_object" CHECK (jsonb_typeof("portal_publication_snapshots"."configuration") = 'object'),
	CONSTRAINT "portal_publication_snapshots_locale_valid" CHECK ("portal_publication_snapshots"."guest_locale" IN ('en', 'bg')),
	CONSTRAINT "portal_publication_snapshots_language_pack_valid" CHECK ("portal_publication_snapshots"."language_pack_version" IN ('guest-ui-en-v1', 'guest-ui-bg-v1')),
	CONSTRAINT "portal_publication_snapshots_locale_set_valid" CHECK (jsonb_typeof("portal_publication_snapshots"."locale_set") = 'array' AND "portal_publication_snapshots"."locale_set" <@ '["en", "bg"]'::jsonb AND "portal_publication_snapshots"."locale_set" @> jsonb_build_array("portal_publication_snapshots"."guest_locale")),
	CONSTRAINT "portal_publication_snapshots_language_packs_object" CHECK (jsonb_typeof("portal_publication_snapshots"."language_pack_versions") = 'object'),
	CONSTRAINT "portal_publication_snapshots_localized_content_object" CHECK (jsonb_typeof("portal_publication_snapshots"."localized_content") = 'object'),
	CONSTRAINT "portal_publication_snapshots_brand_version_positive" CHECK ("portal_publication_snapshots"."brand_profile_version" IS NULL OR "portal_publication_snapshots"."brand_profile_version" >= 1),
	CONSTRAINT "portal_publication_snapshots_threshold_valid" CHECK ("portal_publication_snapshots"."private_feedback_threshold" BETWEEN 1 AND 5),
	CONSTRAINT "portal_publication_snapshots_contact_evidence_valid" CHECK ("portal_publication_snapshots"."contact_request_enabled" = false OR (
        "portal_publication_snapshots"."contact_notice_id" IS NOT NULL
        AND char_length("portal_publication_snapshots"."contact_notice_id") BETWEEN 1 AND 100
        AND "portal_publication_snapshots"."contact_notice_version" IS NOT NULL
        AND char_length("portal_publication_snapshots"."contact_notice_version") BETWEEN 1 AND 100
        AND "portal_publication_snapshots"."contact_notice_digest" ~ '^[0-9a-f]{64}$'
        AND "portal_publication_snapshots"."contact_notice_locale" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
      )),
	CONSTRAINT "portal_publication_snapshots_contact_purpose_valid" CHECK ("portal_publication_snapshots"."contact_request_purpose" = 'manager_follow_up'),
	CONSTRAINT "portal_publication_snapshots_contact_retention_valid" CHECK ("portal_publication_snapshots"."contact_retention_policy_version" = 'guest-contact-retention-30d-v1'),
	CONSTRAINT "portal_publication_snapshots_destination_binding_valid" CHECK ("portal_publication_snapshots"."destination_uri" ~~ 'https://%' AND "portal_publication_snapshots"."destination_source_epoch" >= 0 AND "portal_publication_snapshots"."destination_profile_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "portal_responsible_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" varchar(500),
	CONSTRAINT "prm_interval_valid" CHECK ("portal_responsible_managers"."effective_to" IS NULL OR "portal_responsible_managers"."effective_to" > "portal_responsible_managers"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"token_identifier" varchar(24) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_key_version" integer DEFAULT 1 NOT NULL,
	"encrypted_raw_token" text,
	"address_encryption_key_version" integer,
	"version" integer NOT NULL,
	"print_batch" varchar(100),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"grace_period_ends" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(255),
	"revoked_reason" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_tokens_status_valid" CHECK ("portal_tokens"."status" IN ('active', 'rotating', 'revoked')),
	CONSTRAINT "portal_tokens_encrypted_address_pair_valid" CHECK (("portal_tokens"."encrypted_raw_token" IS NULL) = ("portal_tokens"."address_encryption_key_version" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "portal_upload_issuances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"portal_id" uuid NOT NULL,
	"purpose" varchar(32) DEFAULT 'hero_image' NOT NULL,
	"object_key" varchar(500) NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"declared_size_bytes" integer NOT NULL,
	"max_size_bytes" integer NOT NULL,
	"state" varchar(20) DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"hero_derivative_key" varchar(500),
	"thumbnail_derivative_key" varchar(500),
	"hero_image_url" varchar(500),
	"source_deleted_at" timestamp with time zone,
	"orphan_derivatives_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_upload_issuances_purpose_valid" CHECK ("portal_upload_issuances"."purpose" = 'hero_image'),
	CONSTRAINT "portal_upload_issuances_content_type_valid" CHECK ("portal_upload_issuances"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "portal_upload_issuances_size_envelope_valid" CHECK ("portal_upload_issuances"."declared_size_bytes" BETWEEN 1 AND "portal_upload_issuances"."max_size_bytes" AND "portal_upload_issuances"."max_size_bytes" = 10485760),
	CONSTRAINT "portal_upload_issuances_expiry_valid" CHECK ("portal_upload_issuances"."expires_at" > "portal_upload_issuances"."issued_at"),
	CONSTRAINT "portal_upload_issuances_source_key_valid" CHECK ("portal_upload_issuances"."object_key" = 'private/portal-uploads/' || "portal_upload_issuances"."id"::text || '/source.' || CASE "portal_upload_issuances"."content_type" WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE NULL END),
	CONSTRAINT "portal_upload_issuances_state_valid" CHECK ("portal_upload_issuances"."state" IN ('issued', 'consumed', 'finalized', 'superseded', 'rejected', 'expired')),
	CONSTRAINT "portal_upload_issuances_lifecycle_valid" CHECK ((
        ("portal_upload_issuances"."state" = 'issued' AND "portal_upload_issuances"."consumed_at" IS NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'consumed' AND "portal_upload_issuances"."consumed_at" IS NOT NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'finalized' AND "portal_upload_issuances"."consumed_at" IS NOT NULL AND "portal_upload_issuances"."finalized_at" IS NOT NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL AND "portal_upload_issuances"."hero_derivative_key" IS NOT NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NOT NULL AND "portal_upload_issuances"."hero_image_url" IS NOT NULL)
        OR ("portal_upload_issuances"."state" = 'superseded' AND "portal_upload_issuances"."consumed_at" IS NOT NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NOT NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'rejected' AND "portal_upload_issuances"."consumed_at" IS NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NOT NULL AND "portal_upload_issuances"."expired_at" IS NULL)
        OR ("portal_upload_issuances"."state" = 'expired' AND "portal_upload_issuances"."consumed_at" IS NULL AND "portal_upload_issuances"."finalized_at" IS NULL AND "portal_upload_issuances"."superseded_at" IS NULL AND "portal_upload_issuances"."rejected_at" IS NULL AND "portal_upload_issuances"."expired_at" IS NOT NULL)
      )),
	CONSTRAINT "portal_upload_issuances_derivative_keys_valid" CHECK ((
        ("portal_upload_issuances"."hero_derivative_key" IS NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NULL)
        OR (
          "portal_upload_issuances"."hero_derivative_key" = 'public/portal-heroes/' || "portal_upload_issuances"."id"::text || '/hero.webp'
          AND "portal_upload_issuances"."thumbnail_derivative_key" = 'public/portal-heroes/' || "portal_upload_issuances"."id"::text || '/thumbnail.webp'
          AND "portal_upload_issuances"."hero_derivative_key" <> "portal_upload_issuances"."object_key"
          AND "portal_upload_issuances"."thumbnail_derivative_key" <> "portal_upload_issuances"."object_key"
        )
      )),
	CONSTRAINT "portal_upload_issuances_publication_valid" CHECK ((
        ("portal_upload_issuances"."state" = 'finalized' AND "portal_upload_issuances"."hero_derivative_key" IS NOT NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NOT NULL AND "portal_upload_issuances"."hero_image_url" IS NOT NULL)
        OR ("portal_upload_issuances"."state" <> 'finalized' AND "portal_upload_issuances"."hero_derivative_key" IS NULL AND "portal_upload_issuances"."thumbnail_derivative_key" IS NULL AND "portal_upload_issuances"."hero_image_url" IS NULL)
      )),
	CONSTRAINT "portal_upload_issuances_source_cleanup_valid" CHECK ("portal_upload_issuances"."source_deleted_at" IS NULL OR "portal_upload_issuances"."state" IN ('finalized', 'superseded', 'rejected', 'expired')),
	CONSTRAINT "portal_upload_issuances_orphan_derivative_cleanup_valid" CHECK ("portal_upload_issuances"."orphan_derivatives_deleted_at" IS NULL OR "portal_upload_issuances"."state" IN ('superseded', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "portals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"entity_type" varchar(20) DEFAULT 'property' NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"description" varchar(500),
	"hero_image_url" varchar(500),
	"theme" jsonb DEFAULT '{}'::jsonb,
	"private_feedback_threshold" integer DEFAULT 3 NOT NULL,
	"publication_state" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_by" varchar(255),
	"responsible_manager_revision" integer DEFAULT 1 NOT NULL,
	"responsibility_needed_since" timestamp with time zone,
	"primary_guest_locale" varchar(35) DEFAULT 'en' NOT NULL,
	"additional_guest_locales" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "portals_publication_state_valid" CHECK ("portals"."publication_state" IN ('draft', 'published', 'disabled', 'archived')),
	CONSTRAINT "portals_private_feedback_threshold_valid" CHECK ("portals"."private_feedback_threshold" BETWEEN 1 AND 5),
	CONSTRAINT "portals_responsible_manager_revision_positive" CHECK ("portals"."responsible_manager_revision" >= 1),
	CONSTRAINT "portals_primary_guest_locale_active" CHECK ("portals"."primary_guest_locale" IN ('en', 'bg')),
	CONSTRAINT "portals_additional_guest_locales_array" CHECK (jsonb_typeof("portals"."additional_guest_locales") = 'array' AND "portals"."additional_guest_locales" <@ '["en", "bg"]'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "property_portal_brand_contents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"locale" varchar(35) NOT NULL,
	"title" varchar(120) NOT NULL,
	"short_description" varchar(500) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_portal_brand_contents_locale_active" CHECK ("property_portal_brand_contents"."locale" IN ('en', 'bg')),
	CONSTRAINT "property_portal_brand_contents_version_positive" CHECK ("property_portal_brand_contents"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "property_portal_brand_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"logo_url" varchar(500),
	"default_hero_image_url" varchar(500),
	"primary_color" varchar(7) NOT NULL,
	"background_color" varchar(7) NOT NULL,
	"text_color" varchar(7) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_portal_brand_profiles_palette_valid" CHECK ("property_portal_brand_profiles"."primary_color" ~ '^#[0-9A-Fa-f]{6}$' AND "property_portal_brand_profiles"."background_color" ~ '^#[0-9A-Fa-f]{6}$' AND "property_portal_brand_profiles"."text_color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "property_portal_brand_profiles_version_positive" CHECK ("property_portal_brand_profiles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"default_reply_language" varchar(35),
	"google_connection_id" uuid,
	"address" text,
	"gbp_account_id" varchar(255),
	"gbp_location_id" varchar(255),
	"profile_version" integer DEFAULT 1 NOT NULL,
	"google_binding_state" varchar(40) DEFAULT 'unbound' NOT NULL,
	"google_review_uri" varchar(2048),
	"google_review_destination_state" varchar(32) DEFAULT 'unavailable' NOT NULL,
	"google_review_destination_retrieved_at" timestamp with time zone,
	"google_review_destination_source_epoch" integer,
	"google_review_destination_profile_version" integer,
	"profile_source" varchar(32) DEFAULT 'legacy' NOT NULL,
	"profile_confirmed_at" timestamp with time zone,
	"profile_confirmed_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"lifecycle_state" varchar(20) DEFAULT 'active' NOT NULL,
	"lifecycle_reason" text,
	"lifecycle_state_changed_at" timestamp with time zone DEFAULT now(),
	"purge_scheduled_for" timestamp with time zone,
	"lifecycle_initiated_by" varchar(255),
	"country_code" varchar(2),
	"country_source" text DEFAULT 'organization_default',
	"timezone_source" text DEFAULT 'legacy',
	"timezone_resolved_at" timestamp with time zone,
	"source_epoch" integer DEFAULT 0 NOT NULL,
	"responsible_manager_revision" integer DEFAULT 1 NOT NULL,
	"responsibility_needed_since" timestamp with time zone,
	CONSTRAINT "properties_google_binding_state_valid" CHECK ("properties"."google_binding_state" IN ('unbound', 'account_confirmation_required', 'active', 'disconnected')),
	CONSTRAINT "properties_google_binding_tuple_valid" CHECK ((
        ("properties"."google_binding_state" = 'unbound' AND "properties"."gbp_account_id" IS NULL AND "properties"."gbp_location_id" IS NULL)
        OR ("properties"."google_binding_state" = 'account_confirmation_required' AND "properties"."gbp_account_id" IS NULL AND "properties"."gbp_location_id" IS NOT NULL)
        OR ("properties"."google_binding_state" IN ('active', 'disconnected') AND "properties"."google_connection_id" IS NOT NULL AND "properties"."gbp_account_id" IS NOT NULL AND "properties"."gbp_location_id" IS NOT NULL)
      )),
	CONSTRAINT "properties_google_binding_suffix_valid" CHECK ((
        ("properties"."gbp_account_id" IS NULL OR (char_length("properties"."gbp_account_id") >= 1 AND char_length("properties"."gbp_account_id") <= 255 AND "properties"."gbp_account_id" !~ '[/?#[:space:][:cntrl:]]'))
        AND ("properties"."gbp_location_id" IS NULL OR (char_length("properties"."gbp_location_id") >= 1 AND char_length("properties"."gbp_location_id") <= 255 AND "properties"."gbp_location_id" !~ '[/?#[:space:][:cntrl:]]'))
      )),
	CONSTRAINT "properties_google_profile_version_valid" CHECK ("properties"."profile_version" >= 1),
	CONSTRAINT "properties_google_review_destination_valid" CHECK ((
        (
          "properties"."google_review_destination_state" IN ('verified', 'awaiting_refresh')
          AND "properties"."google_review_uri" IS NOT NULL
          AND "properties"."google_review_uri" ~ '^https://'
          AND "properties"."google_review_destination_retrieved_at" IS NOT NULL
          AND "properties"."google_review_destination_source_epoch" >= 0
          AND "properties"."google_review_destination_profile_version" >= 1
        )
        OR (
          "properties"."google_review_destination_state" = 'unavailable'
          AND "properties"."google_review_uri" IS NULL
          AND "properties"."google_review_destination_retrieved_at" IS NULL
          AND "properties"."google_review_destination_source_epoch" IS NULL
          AND "properties"."google_review_destination_profile_version" IS NULL
        )
      )),
	CONSTRAINT "properties_default_reply_language_valid" CHECK ("properties"."default_reply_language" IS NULL OR "properties"."default_reply_language" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'),
	CONSTRAINT "properties_google_profile_confirmation_valid" CHECK ((
        ("properties"."profile_source" = 'legacy' AND "properties"."profile_confirmed_at" IS NULL AND "properties"."profile_confirmed_by" IS NULL)
        OR ("properties"."profile_source" = 'tenant_confirmed' AND "properties"."profile_confirmed_at" IS NOT NULL AND "properties"."profile_confirmed_by" IS NOT NULL)
      )),
	CONSTRAINT "properties_lifecycle_state_valid" CHECK ("properties"."lifecycle_state" IN ('active', 'suspended', 'archived', 'disconnecting', 'purge_pending', 'purging', 'purged')),
	CONSTRAINT "properties_responsible_manager_revision_positive" CHECK ("properties"."responsible_manager_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "property_responsible_managers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"end_reason" varchar(500),
	CONSTRAINT "property_rm_interval_valid" CHECK ("property_responsible_managers"."effective_to" IS NULL OR "property_responsible_managers"."effective_to" > "property_responsible_managers"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "recovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation" integer NOT NULL,
	"source_release_sha" varchar(40) NOT NULL,
	"source_manifest_sha256" varchar(64) NOT NULL,
	"restore_point_at" timestamp with time zone NOT NULL,
	"operator_id" varchar(255) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"counts" jsonb NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_runs_generation_valid" CHECK ("recovery_runs"."generation" >= 1),
	CONSTRAINT "recovery_runs_source_release_valid" CHECK ("recovery_runs"."source_release_sha" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "recovery_runs_source_manifest_valid" CHECK ("recovery_runs"."source_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "recovery_runs_time_valid" CHECK ("recovery_runs"."restore_point_at" <= "recovery_runs"."completed_at" AND "recovery_runs"."completed_at" >= "recovery_runs"."created_at")
);
--> statement-breakpoint
CREATE TABLE "review_lifecycle_recovery_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recovery_generation" integer NOT NULL,
	"approval_id" varchar(160) NOT NULL,
	"approval_bundle_sha256" varchar(64) NOT NULL,
	"approver_identity" varchar(255) NOT NULL,
	"approval_key_id" varchar(64) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"release_sha" varchar(40) NOT NULL,
	"release_manifest_sha256" varchar(64) NOT NULL,
	"restore_point_at" timestamp with time zone NOT NULL,
	"restore_database_service_name" varchar(255) NOT NULL,
	"railway_project_id" varchar(255),
	"railway_environment_id" varchar(255),
	"evaluated_at" timestamp with time zone NOT NULL,
	"source_policy_version" integer NOT NULL,
	"retention_policy_version" integer NOT NULL,
	"policy_sha256" varchar(64) NOT NULL,
	"report_sha256" varchar(64) NOT NULL,
	"report_expired" integer NOT NULL,
	"operator_id" varchar(255) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"state" varchar(32) NOT NULL,
	"checkpoint_created_at" timestamp with time zone,
	"checkpoint_review_id" uuid,
	"pages" integer DEFAULT 0 NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"rows_redacted" integer DEFAULT 0 NOT NULL,
	"legacy_google_replies_reconciled" integer DEFAULT 0 NOT NULL,
	"recovery_replayed" boolean,
	"error_code" varchar(160),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "review_lifecycle_recovery_state_valid" CHECK ("review_lifecycle_recovery_executions"."state" IN ('applying', 'lifecycle_applied', 'completed')),
	CONSTRAINT "review_lifecycle_recovery_generation_valid" CHECK ("review_lifecycle_recovery_executions"."recovery_generation" >= 1),
	CONSTRAINT "review_lifecycle_recovery_release_valid" CHECK ("review_lifecycle_recovery_executions"."release_sha" ~ '^[0-9a-f]{40}$' AND "review_lifecycle_recovery_executions"."release_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_lifecycle_recovery_digests_valid" CHECK ("review_lifecycle_recovery_executions"."approval_bundle_sha256" ~ '^[0-9a-f]{64}$' AND "review_lifecycle_recovery_executions"."policy_sha256" ~ '^[0-9a-f]{64}$' AND "review_lifecycle_recovery_executions"."report_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_lifecycle_recovery_window_valid" CHECK ("review_lifecycle_recovery_executions"."restore_point_at" <= "review_lifecycle_recovery_executions"."evaluated_at" AND "review_lifecycle_recovery_executions"."evaluated_at" <= "review_lifecycle_recovery_executions"."approved_at" AND "review_lifecycle_recovery_executions"."approved_at" < "review_lifecycle_recovery_executions"."expires_at"),
	CONSTRAINT "review_lifecycle_recovery_counts_valid" CHECK ("review_lifecycle_recovery_executions"."report_expired" >= 0 AND "review_lifecycle_recovery_executions"."pages" >= 0 AND "review_lifecycle_recovery_executions"."scanned" >= 0 AND "review_lifecycle_recovery_executions"."rows_redacted" >= 0 AND "review_lifecycle_recovery_executions"."legacy_google_replies_reconciled" >= 0),
	CONSTRAINT "review_lifecycle_recovery_checkpoint_valid" CHECK (("review_lifecycle_recovery_executions"."checkpoint_created_at" IS NULL) = ("review_lifecycle_recovery_executions"."checkpoint_review_id" IS NULL) AND ("review_lifecycle_recovery_executions"."state" = 'applying' OR "review_lifecycle_recovery_executions"."checkpoint_created_at" IS NULL) AND ("review_lifecycle_recovery_executions"."checkpoint_created_at" IS NULL OR "review_lifecycle_recovery_executions"."checkpoint_created_at" <= "review_lifecycle_recovery_executions"."evaluated_at")),
	CONSTRAINT "review_lifecycle_recovery_completion_valid" CHECK (("review_lifecycle_recovery_executions"."state" = 'completed') = ("review_lifecycle_recovery_executions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "setup_checklist_milestones" (
	"organization_id" varchar(255) NOT NULL,
	"step" varchar(40) NOT NULL,
	"first_completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_checklist_milestones_pk" PRIMARY KEY("organization_id","step"),
	CONSTRAINT "setup_checklist_milestones_step_valid" CHECK ("setup_checklist_milestones"."step" IN ('google_connection', 'initial_review_sync', 'published_portal', 'responsible_managers'))
);
--> statement-breakpoint
CREATE TABLE "google_reply_observation_heads" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"observation_revision" bigint NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"state" varchar(16) NOT NULL,
	"provenance" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_reply_observation_heads_revisions_safe" CHECK ("google_reply_observation_heads"."observation_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "google_reply_observation_heads"."source_epoch" BETWEEN 0 AND 2147483647
        AND "google_reply_observation_heads"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "google_reply_observation_heads_state_valid" CHECK ("google_reply_observation_heads"."state" IN ('live', 'absent')),
	CONSTRAINT "google_reply_observation_heads_provenance_valid" CHECK ("google_reply_observation_heads"."provenance" IN ('repkey_confirmed', 'external_or_unknown', 'none'))
);
--> statement-breakpoint
CREATE TABLE "google_reply_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"observation_revision" bigint NOT NULL,
	"observation_key" varchar(64) NOT NULL,
	"input_digest" varchar(64) NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"read_generation" bigint NOT NULL,
	"state" varchar(16) NOT NULL,
	"change" varchar(16) NOT NULL,
	"resolution" varchar(32) NOT NULL,
	"source" varchar(32) NOT NULL,
	"provenance" varchar(32) NOT NULL,
	"normalized_text" text,
	"normalization_version" varchar(64) NOT NULL,
	"normalized_digest" varchar(64),
	"matched_reply_id" uuid,
	"matched_publication_cycle" bigint,
	"matched_attempt_number" integer,
	"provider_updated_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"content_expires_at" timestamp with time zone NOT NULL,
	"content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_reply_observations_revisions_safe" CHECK ("google_reply_observations"."observation_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "google_reply_observations"."source_epoch" BETWEEN 0 AND 2147483647
        AND "google_reply_observations"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "google_reply_observations"."read_generation" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "google_reply_observations_identity_valid" CHECK ("google_reply_observations"."observation_key" ~ '^[0-9a-f]{64}$'
        AND "google_reply_observations"."input_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "google_reply_observations_state_valid" CHECK ("google_reply_observations"."state" IN ('live', 'absent')),
	CONSTRAINT "google_reply_observations_change_valid" CHECK ("google_reply_observations"."change" IN ('added', 'edited', 'deleted', 'unchanged')),
	CONSTRAINT "google_reply_observations_resolution_valid" CHECK ("google_reply_observations"."resolution" IN (
        'confirmed_on_google', 'external_current_live', 'diverged',
        'absent', 'unchanged'
      )),
	CONSTRAINT "google_reply_observations_source_valid" CHECK ("google_reply_observations"."source" IN ('provider_snapshot', 'targeted_reconciliation')),
	CONSTRAINT "google_reply_observations_provenance_valid" CHECK ("google_reply_observations"."provenance" IN ('repkey_confirmed', 'external_or_unknown', 'none')),
	CONSTRAINT "google_reply_observations_content_valid" CHECK ((
        "google_reply_observations"."content_state" = 'active'
        AND "google_reply_observations"."content_erased_at" IS NULL
        AND "google_reply_observations"."normalization_version" = 'google-reply-v1'
        AND (
          ("google_reply_observations"."state" = 'live' AND "google_reply_observations"."normalized_text" IS NOT NULL
            AND "google_reply_observations"."normalized_digest" ~ '^[0-9a-f]{64}$')
          OR ("google_reply_observations"."state" = 'absent' AND "google_reply_observations"."normalized_text" IS NULL
            AND "google_reply_observations"."normalized_digest" IS NULL)
        )
      ) OR (
        "google_reply_observations"."content_state" IN ('source_expired', 'provider_deleted')
        AND "google_reply_observations"."content_erased_at" IS NOT NULL
        AND "google_reply_observations"."normalized_text" IS NULL
        AND "google_reply_observations"."normalized_digest" IS NULL
      )),
	CONSTRAINT "google_reply_observations_match_valid" CHECK ((
        "google_reply_observations"."resolution" = 'confirmed_on_google'
        AND "google_reply_observations"."provenance" = 'repkey_confirmed'
        AND "google_reply_observations"."matched_reply_id" IS NOT NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NOT NULL
        AND "google_reply_observations"."matched_attempt_number" IS NOT NULL
      ) OR (
        "google_reply_observations"."resolution" <> 'confirmed_on_google'
        AND "google_reply_observations"."provenance" <> 'repkey_confirmed'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      )),
	CONSTRAINT "google_reply_observations_semantics_valid" CHECK ((
        "google_reply_observations"."resolution" = 'confirmed_on_google'
        AND "google_reply_observations"."state" = 'live'
        AND "google_reply_observations"."change" <> 'deleted'
        AND "google_reply_observations"."provenance" = 'repkey_confirmed'
        AND "google_reply_observations"."matched_reply_id" IS NOT NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NOT NULL
        AND "google_reply_observations"."matched_attempt_number" IS NOT NULL
      ) OR (
        "google_reply_observations"."resolution" = 'external_current_live'
        AND "google_reply_observations"."state" = 'live'
        AND "google_reply_observations"."change" <> 'deleted'
        AND "google_reply_observations"."provenance" = 'external_or_unknown'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ) OR (
        "google_reply_observations"."resolution" = 'diverged'
        AND "google_reply_observations"."state" = 'live'
        AND "google_reply_observations"."change" <> 'deleted'
        AND "google_reply_observations"."provenance" = 'external_or_unknown'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ) OR (
        "google_reply_observations"."resolution" = 'absent'
        AND "google_reply_observations"."state" = 'absent'
        AND "google_reply_observations"."change" = 'deleted'
        AND "google_reply_observations"."provenance" = 'none'
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ) OR (
        "google_reply_observations"."resolution" = 'unchanged'
        AND "google_reply_observations"."change" = 'unchanged'
        AND (
          ("google_reply_observations"."state" = 'absent' AND "google_reply_observations"."provenance" = 'none')
          OR ("google_reply_observations"."state" = 'live' AND "google_reply_observations"."provenance" = 'external_or_unknown')
        )
        AND "google_reply_observations"."matched_reply_id" IS NULL
        AND "google_reply_observations"."matched_publication_cycle" IS NULL
        AND "google_reply_observations"."matched_attempt_number" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "material_review_revisions" (
	"review_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"source_digest" varchar(64),
	"normalized_digest" varchar(64),
	"rating" integer,
	"normalized_text" text,
	"response_target_eligibility" varchar(32) DEFAULT 'legacy_unknown' NOT NULL,
	"response_target_start_at" timestamp with time zone,
	"content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_review_revisions_pk" PRIMARY KEY("review_id","revision"),
	CONSTRAINT "material_review_revisions_controls_safe" CHECK ("material_review_revisions"."source_epoch" BETWEEN 0 AND 2147483647
        AND "material_review_revisions"."revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "material_review_revisions_comparison_valid" CHECK ((
        "material_review_revisions"."normalization_version" = 'legacy-unverified-v0'
        AND "material_review_revisions"."source_digest" IS NULL
        AND "material_review_revisions"."normalized_digest" IS NULL
      ) OR (
        "material_review_revisions"."normalization_version" = 'review-material-v1'
        AND "material_review_revisions"."source_digest" IS NOT NULL
        AND "material_review_revisions"."source_digest" ~ '^[0-9a-f]{64}$'
        AND "material_review_revisions"."normalized_digest" IS NOT NULL
        AND "material_review_revisions"."normalized_digest" ~ '^[0-9a-f]{64}$'
      )),
	CONSTRAINT "material_review_revisions_content_state_valid" CHECK ((
        "material_review_revisions"."content_state" = 'active'
        AND "material_review_revisions"."content_erased_at" IS NULL
        AND "material_review_revisions"."rating" IS NOT NULL
        AND "material_review_revisions"."rating" BETWEEN 1 AND 5
      ) OR (
        "material_review_revisions"."content_state" IN ('source_expired', 'provider_deleted')
        AND "material_review_revisions"."content_erased_at" IS NOT NULL
        AND "material_review_revisions"."rating" IS NULL
        AND "material_review_revisions"."normalized_text" IS NULL
      )),
	CONSTRAINT "material_review_revisions_response_target_valid" CHECK ("material_review_revisions"."response_target_eligibility" IN ('measured', 'legacy_unknown', 'historical_onboarding')
        AND (
          ("material_review_revisions"."response_target_eligibility" = 'measured' AND "material_review_revisions"."response_target_start_at" IS NOT NULL)
          OR
          ("material_review_revisions"."response_target_eligibility" <> 'measured' AND "material_review_revisions"."response_target_start_at" IS NULL)
        ))
);
--> statement-breakpoint
CREATE TABLE "replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"text" text NOT NULL,
	"reply_language_tag" varchar(35),
	"status" "reply_status" NOT NULL,
	"source" "reply_source" NOT NULL,
	"created_by" varchar(255),
	"approved_by" varchar(255),
	"rejected_by" varchar(255),
	"rejection_reason" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"authorship" "reply_authorship",
	"state_revision" bigint DEFAULT 1 NOT NULL,
	"origin_operation_id" uuid,
	"origin_source_epoch" integer,
	"origin_source_revision" bigint,
	"origin_base_reply_state_revision" bigint,
	"origin_reply_drafting_epoch" integer,
	"origin_property_profile_version" integer,
	"origin_ai_profile_version" varchar(100),
	"origin_reply_template_id" varchar(64),
	"origin_reply_template_catalogue_version" varchar(100),
	"origin_reply_template_catalogue_digest" varchar(64),
	"origin_concrete_language_tag" varchar(35),
	"origin_template_group" varchar(35),
	"ai_draft_expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"publication_state" text,
	"publication_cycle" bigint DEFAULT 0 NOT NULL,
	"publication_attempts" integer DEFAULT 0 NOT NULL,
	"publication_last_error_class" text,
	"reconcile_due_at" timestamp (3) with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replies_state_revision_safe" CHECK ("replies"."state_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "replies_reply_language_tag_valid" CHECK ("replies"."reply_language_tag" IS NULL OR "replies"."reply_language_tag" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'),
	CONSTRAINT "replies_authorship_valid" CHECK ((
        ("replies"."source" = 'google_sync' AND "replies"."authorship" IS NULL AND "replies"."ai_generated" = false)
        OR (
          "replies"."source" = 'internal'
          AND "replies"."authorship" IS NOT NULL
          AND (
            ("replies"."ai_generated" = false AND "replies"."authorship" = 'human')
            OR ("replies"."ai_generated" = true AND "replies"."authorship" = 'ai_assisted')
          )
        )
      )),
	CONSTRAINT "replies_ai_provenance_valid" CHECK ((
        (
          "replies"."authorship" = 'ai_assisted'
          AND "replies"."origin_operation_id" IS NOT NULL
          AND "replies"."origin_source_epoch" >= 0
          AND "replies"."origin_source_revision" >= 1
          AND "replies"."origin_base_reply_state_revision" BETWEEN 0 AND '9007199254740991'::bigint
          AND "replies"."origin_reply_drafting_epoch" >= 1
          AND "replies"."origin_property_profile_version" >= 1
          AND (
            (
              "replies"."origin_ai_profile_version" = 'reply-suggestion-v1'
              AND "replies"."origin_reply_template_id" IN (
                'appreciation_positive',
                'appreciation_neutral',
                'recovery_service',
                'acknowledge_concern'
              )
              AND "replies"."origin_reply_template_catalogue_version" = 'gbp-reply-template-catalogue-v1'
              AND "replies"."origin_reply_template_catalogue_digest" = 'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'
            )
            OR (
              "replies"."origin_ai_profile_version" IN ('reply-draft-v1', 'reply-draft-v2')
              AND "replies"."origin_reply_template_id" IS NULL
              AND "replies"."origin_reply_template_catalogue_version" IS NULL
              AND "replies"."origin_reply_template_catalogue_digest" IS NULL
              AND "replies"."origin_template_group" IN ('en-Latn', 'bg-Cyrl')
            )
          )
          AND "replies"."origin_template_group" IN (
            'en-Latn', 'es-Latn', 'fr-Latn', 'de-Latn', 'pt-Latn',
            'it-Latn', 'nl-Latn', 'pl-Latn', 'tr-Latn', 'uk-Cyrl',
            'ru-Cyrl', 'ar-Arab', 'he-Hebr', 'hi-Deva', 'bn-Beng',
            'ta-Taml', 'th-Thai', 'vi-Latn', 'id-Latn', 'zh-Hans',
            'zh-Hant', 'ja-Jpan', 'ko-Kore', 'bg-Cyrl'
          )
          AND (
            "replies"."origin_concrete_language_tag" = "replies"."origin_template_group"
            OR "replies"."origin_concrete_language_tag" ~~ ("replies"."origin_template_group" || '-%')
          )
          AND "replies"."ai_draft_expires_at" IS NOT NULL
        )
        OR (
          "replies"."origin_operation_id" IS NULL
          AND "replies"."origin_source_epoch" IS NULL
          AND "replies"."origin_source_revision" IS NULL
          AND "replies"."origin_base_reply_state_revision" IS NULL
          AND "replies"."origin_reply_drafting_epoch" IS NULL
          AND "replies"."origin_property_profile_version" IS NULL
          AND "replies"."origin_ai_profile_version" IS NULL
          AND "replies"."origin_reply_template_id" IS NULL
          AND "replies"."origin_reply_template_catalogue_version" IS NULL
          AND "replies"."origin_reply_template_catalogue_digest" IS NULL
          AND "replies"."origin_concrete_language_tag" IS NULL
          AND "replies"."origin_template_group" IS NULL
          AND "replies"."ai_draft_expires_at" IS NULL
        )
      )),
	CONSTRAINT "replies_publication_state_check" CHECK ("replies"."publication_state" IN ('requested', 'authorized', 'sending', 'pending_observation', 'published', 'terminal', 'ambiguous', 'cancelled')),
	CONSTRAINT "replies_publication_last_error_class_check" CHECK ("replies"."publication_last_error_class" IN ('terminal_rejection', 'retryable', 'ambiguous')),
	CONSTRAINT "replies_publication_cycle_safe" CHECK ("replies"."publication_cycle" BETWEEN 0 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "reply_publication_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"publication_cycle" bigint NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider_operation_key" varchar(255) NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"reply_state_revision" bigint NOT NULL,
	"base_observation_revision" bigint DEFAULT 0 NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"expected_reply_digest" varchar(64) NOT NULL,
	"outcome" varchar(48) DEFAULT 'sending' NOT NULL,
	"provider_correlation_id" varchar(255),
	"provider_responded_at" timestamp with time zone,
	"confirmed_observation_revision" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_publication_attempts_revisions_safe" CHECK ("reply_publication_attempts"."publication_cycle" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_attempts"."attempt_number" BETWEEN 1 AND 2147483647
        AND "reply_publication_attempts"."source_epoch" BETWEEN 0 AND 2147483647
        AND "reply_publication_attempts"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_attempts"."reply_state_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_attempts"."base_observation_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND ("reply_publication_attempts"."confirmed_observation_revision" IS NULL OR "reply_publication_attempts"."confirmed_observation_revision" BETWEEN 1 AND '9007199254740991'::bigint)),
	CONSTRAINT "reply_publication_attempts_digest_valid" CHECK ("reply_publication_attempts"."normalization_version" = 'google-reply-v1'
        AND "reply_publication_attempts"."expected_reply_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reply_publication_attempts_outcome_valid" CHECK ("reply_publication_attempts"."outcome" IN (
        'sending', 'provider_outcome_pending', 'retryable_failure',
        'ambiguous', 'terminal_rejection', 'confirmed', 'superseded'
      )),
	CONSTRAINT "reply_publication_attempts_confirmation_valid" CHECK (("reply_publication_attempts"."outcome" = 'confirmed') = ("reply_publication_attempts"."confirmed_observation_revision" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "reply_publication_authorizations" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"publication_cycle" bigint NOT NULL,
	"source_epoch" integer NOT NULL,
	"material_review_revision" bigint NOT NULL,
	"base_observation_revision" bigint DEFAULT 0 NOT NULL,
	"authorized_by_user_id" varchar(255) NOT NULL,
	"reply_state_revision" bigint NOT NULL,
	"normalization_version" varchar(64) NOT NULL,
	"expected_reply_digest" varchar(64) NOT NULL,
	"authorized_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_publication_authorizations_pk" PRIMARY KEY("reply_id","publication_cycle"),
	CONSTRAINT "reply_publication_authorizations_revisions_safe" CHECK ("reply_publication_authorizations"."publication_cycle" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_authorizations"."source_epoch" BETWEEN 0 AND 2147483647
        AND "reply_publication_authorizations"."material_review_revision" BETWEEN 1 AND '9007199254740991'::bigint
        AND "reply_publication_authorizations"."base_observation_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND "reply_publication_authorizations"."reply_state_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "reply_publication_authorizations_digest_valid" CHECK ("reply_publication_authorizations"."normalization_version" = 'google-reply-v1'
        AND "reply_publication_authorizations"."expected_reply_digest" ~ '^[0-9a-f]{64}$'
        AND length(btrim("reply_publication_authorizations"."authorized_by_user_id")) BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "review_ai_analysis_heads" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"head_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_ai_analysis_heads_pk" PRIMARY KEY("organization_id","property_id","source_epoch"),
	CONSTRAINT "review_ai_analysis_heads_source_epoch_safe" CHECK ("review_ai_analysis_heads"."source_epoch" BETWEEN 0 AND 2147483647),
	CONSTRAINT "review_ai_analysis_heads_sequence_safe" CHECK ("review_ai_analysis_heads"."head_sequence" BETWEEN 0 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "review_google_reputation_snapshot_facts" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"review_count" integer NOT NULL,
	"average_rating" double precision,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_google_reputation_snapshot_source_epoch_valid" CHECK ("review_google_reputation_snapshot_facts"."source_epoch" BETWEEN 0 AND 2147483647),
	CONSTRAINT "review_google_reputation_snapshot_value_valid" CHECK (("review_google_reputation_snapshot_facts"."review_count" = 0 AND "review_google_reputation_snapshot_facts"."average_rating" IS NULL)
        OR ("review_google_reputation_snapshot_facts"."review_count" BETWEEN 1 AND 10000
          AND "review_google_reputation_snapshot_facts"."average_rating" BETWEEN 0 AND 5))
);
--> statement-breakpoint
CREATE TABLE "review_provider_deletion_candidates" (
	"run_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"expected_mapping_state" varchar(24) NOT NULL,
	"expected_source_revision" bigint NOT NULL,
	"state" varchar(24) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_provider_deletion_candidates_pk" PRIMARY KEY("run_id","review_id"),
	CONSTRAINT "review_provider_deletion_candidates_state_valid" CHECK ("review_provider_deletion_candidates"."state" IN ('pending', 'confirmed_missing', 'observed')),
	CONSTRAINT "review_provider_deletion_candidates_mapping_state_valid" CHECK ("review_provider_deletion_candidates"."expected_mapping_state" IN ('linked', 'source_expired')),
	CONSTRAINT "review_provider_deletion_candidates_revision_safe" CHECK ("review_provider_deletion_candidates"."expected_source_revision" BETWEEN 0 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "review_provider_snapshot_members" (
	"run_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"main_seen" boolean DEFAULT false NOT NULL,
	"confirmation_seen" boolean DEFAULT false NOT NULL,
	CONSTRAINT "review_provider_snapshot_members_pk" PRIMARY KEY("run_id","review_id")
);
--> statement-breakpoint
CREATE TABLE "review_provider_snapshot_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"observation_origin" varchar(32) DEFAULT 'legacy_unknown' NOT NULL,
	"state" varchar(16) NOT NULL,
	"phase" varchar(16) NOT NULL,
	"expected_total" integer,
	"expected_average_rating" double precision,
	"main_cursor_ref" varchar(76),
	"confirmation_cursor_ref" varchar(76),
	"main_page_count" integer DEFAULT 0 NOT NULL,
	"main_unique_count" integer DEFAULT 0 NOT NULL,
	"confirmation_page_count" integer DEFAULT 0 NOT NULL,
	"confirmation_unique_count" integer DEFAULT 0 NOT NULL,
	"apply_cursor_review_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"confirmation_deadline" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	"record_expires_at" timestamp with time zone,
	"failure_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_provider_snapshot_runs_state_valid" CHECK ("review_provider_snapshot_runs"."state" IN ('scanning', 'confirming', 'deleting', 'completed', 'failed')),
	CONSTRAINT "review_provider_snapshot_runs_observation_origin_valid" CHECK ("review_provider_snapshot_runs"."observation_origin" IN ('ongoing', 'historical_onboarding', 'legacy_unknown')),
	CONSTRAINT "review_provider_snapshot_runs_phase_valid" CHECK ("review_provider_snapshot_runs"."phase" IN ('main', 'confirmation', 'apply', 'terminal')),
	CONSTRAINT "review_provider_snapshot_runs_counts_valid" CHECK ("review_provider_snapshot_runs"."source_epoch" BETWEEN 0 AND 2147483647
        AND ("review_provider_snapshot_runs"."expected_total" IS NULL OR "review_provider_snapshot_runs"."expected_total" BETWEEN 0 AND 10000)
        AND ("review_provider_snapshot_runs"."expected_average_rating" IS NULL OR "review_provider_snapshot_runs"."expected_average_rating" BETWEEN 0 AND 5)
        AND (
          ("review_provider_snapshot_runs"."expected_total" IS NULL AND "review_provider_snapshot_runs"."expected_average_rating" IS NULL)
          OR ("review_provider_snapshot_runs"."expected_total" = 0 AND "review_provider_snapshot_runs"."expected_average_rating" IS NULL)
          OR ("review_provider_snapshot_runs"."expected_total" > 0 AND "review_provider_snapshot_runs"."expected_average_rating" IS NOT NULL)
        )
        AND "review_provider_snapshot_runs"."main_page_count" BETWEEN 0 AND 200
        AND "review_provider_snapshot_runs"."confirmation_page_count" BETWEEN 0 AND 200
        AND "review_provider_snapshot_runs"."main_unique_count" BETWEEN 0 AND 10000
        AND "review_provider_snapshot_runs"."confirmation_unique_count" BETWEEN 0 AND 10000),
	CONSTRAINT "review_provider_snapshot_runs_terminal_valid" CHECK ((
        ("review_provider_snapshot_runs"."state" IN ('completed', 'failed')
          AND "review_provider_snapshot_runs"."terminal_at" IS NOT NULL
          AND "review_provider_snapshot_runs"."record_expires_at" = "review_provider_snapshot_runs"."terminal_at" + interval '30 days')
        OR
        ("review_provider_snapshot_runs"."state" NOT IN ('completed', 'failed')
          AND "review_provider_snapshot_runs"."terminal_at" IS NULL
          AND "review_provider_snapshot_runs"."record_expires_at" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "review_provider_subject_hmac_key_versions" (
	"key_version" varchar(32) PRIMARY KEY NOT NULL,
	"key_digest" varchar(64) NOT NULL,
	"state" varchar(16) NOT NULL,
	"generation" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retiring_at" timestamp with time zone,
	CONSTRAINT "review_provider_subject_key_version_valid" CHECK ("review_provider_subject_hmac_key_versions"."key_version" ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
	CONSTRAINT "review_provider_subject_key_digest_valid" CHECK ("review_provider_subject_hmac_key_versions"."key_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_provider_subject_key_state_valid" CHECK ("review_provider_subject_hmac_key_versions"."state" IN ('trusted_next', 'active', 'retiring')),
	CONSTRAINT "review_provider_subject_key_generation_safe" CHECK ("review_provider_subject_hmac_key_versions"."generation" BETWEEN 1 AND '9007199254740991'::bigint)
);
--> statement-breakpoint
CREATE TABLE "review_provider_subjects" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"key_version" varchar(32) NOT NULL,
	"locator_hmac" "bytea" NOT NULL,
	"verifier_hmac" "bytea" NOT NULL,
	"review_id" uuid NOT NULL,
	"last_source_revision" bigint NOT NULL,
	"state" varchar(24) NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"last_seen_snapshot_run_id" uuid,
	"first_missing_at" timestamp with time zone,
	"first_missing_snapshot_run_id" uuid,
	"unlinked_at" timestamp with time zone,
	"unlink_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_provider_subjects_pk" PRIMARY KEY("organization_id","property_id","source_epoch","key_version","locator_hmac"),
	CONSTRAINT "review_provider_subjects_hmac_length_valid" CHECK (octet_length("review_provider_subjects"."locator_hmac") = 32 AND octet_length("review_provider_subjects"."verifier_hmac") = 32),
	CONSTRAINT "review_provider_subjects_controls_safe" CHECK ("review_provider_subjects"."source_epoch" BETWEEN 0 AND 2147483647
        AND "review_provider_subjects"."last_source_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "review_provider_subjects_state_valid" CHECK ("review_provider_subjects"."state" IN ('linked', 'source_expired', 'provider_deleted')),
	CONSTRAINT "review_provider_subjects_unlink_valid" CHECK ((
        ("review_provider_subjects"."state" = 'linked' AND "review_provider_subjects"."unlinked_at" IS NULL AND "review_provider_subjects"."unlink_expires_at" IS NULL)
        OR
        ("review_provider_subjects"."state" <> 'linked' AND "review_provider_subjects"."unlinked_at" IS NOT NULL
          AND "review_provider_subjects"."unlink_expires_at" = "review_provider_subjects"."unlinked_at" + interval '2 years')
      )),
	CONSTRAINT "review_provider_subjects_missing_pair_valid" CHECK (("review_provider_subjects"."first_missing_at" IS NULL) = ("review_provider_subjects"."first_missing_snapshot_run_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "review_source_contents" (
	"review_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"platform" "review_platform" NOT NULL,
	"external_id" varchar(500) NOT NULL,
	"external_location_id" varchar(500) NOT NULL,
	"google_connection_id" uuid,
	"reviewer_name" varchar(255),
	"reviewer_profile_photo_url" varchar(1000),
	"rating" integer NOT NULL,
	"text" text,
	"translated_text" text,
	"language_code" varchar(10),
	"reviewed_at" timestamp with time zone NOT NULL,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"first_fetched_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone NOT NULL,
	"content_expires_at" timestamp with time zone NOT NULL,
	"content_hash" text,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"ai_source_byte_length" integer NOT NULL,
	"ai_source_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_source_contents_rating_valid" CHECK ("review_source_contents"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "review_source_contents_epoch_revision_safe" CHECK ("review_source_contents"."source_epoch" BETWEEN 0 AND 2147483647
        AND "review_source_contents"."source_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "review_source_contents_ai_source_valid" CHECK ("review_source_contents"."ai_source_byte_length" BETWEEN 1 AND '4294967295'::bigint
        AND "review_source_contents"."ai_source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "review_source_observations" (
	"review_id" uuid NOT NULL,
	"observation_sequence" bigint NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"source_epoch" integer NOT NULL,
	"observation_key" varchar(64) NOT NULL,
	"observation_digest" varchar(64) NOT NULL,
	"material_revision" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"content_expires_at" timestamp with time zone NOT NULL,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"source_digest" varchar(64),
	"normalization_version" varchar(64) NOT NULL,
	"normalized_digest" varchar(64),
	"comparison_result" varchar(40) NOT NULL,
	"rating" integer,
	"original_text" text,
	"translated_text" text,
	"language_code" varchar(10),
	"reviewer_name" varchar(255),
	"reviewer_profile_photo_url" varchar(1000),
	"reviewed_at" timestamp with time zone,
	"content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"content_erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_source_observations_pk" PRIMARY KEY("review_id","observation_sequence"),
	CONSTRAINT "review_source_observations_controls_safe" CHECK ("review_source_observations"."source_epoch" BETWEEN 0 AND 2147483647
        AND "review_source_observations"."observation_sequence" BETWEEN 1 AND '9007199254740991'::bigint
        AND "review_source_observations"."material_revision" BETWEEN 1 AND '9007199254740991'::bigint),
	CONSTRAINT "review_source_observations_digest_valid" CHECK ("review_source_observations"."observation_key" ~ '^[0-9a-f]{64}$'
        AND "review_source_observations"."observation_digest" ~ '^[0-9a-f]{64}$'
        AND (
          ("review_source_observations"."normalization_version" = 'legacy-unverified-v0'
            AND "review_source_observations"."source_digest" IS NULL
            AND "review_source_observations"."normalized_digest" IS NULL)
          OR
          ("review_source_observations"."normalization_version" = 'review-material-v1'
            AND "review_source_observations"."source_digest" IS NOT NULL
            AND "review_source_observations"."source_digest" ~ '^[0-9a-f]{64}$'
            AND "review_source_observations"."normalized_digest" IS NOT NULL
            AND "review_source_observations"."normalized_digest" ~ '^[0-9a-f]{64}$')
        )),
	CONSTRAINT "review_source_observations_comparison_valid" CHECK ("review_source_observations"."comparison_result" IN (
        'backfilled_unverified',
        'initial_material_revision',
        'unchanged',
        'material_change',
        'normalization_shadow_match',
        'baseline_unavailable',
        'out_of_order_ignored'
      )),
	CONSTRAINT "review_source_observations_content_state_valid" CHECK ((
        "review_source_observations"."content_state" = 'active'
        AND "review_source_observations"."content_erased_at" IS NULL
        AND "review_source_observations"."rating" IS NOT NULL
        AND "review_source_observations"."rating" BETWEEN 1 AND 5
        AND "review_source_observations"."reviewed_at" IS NOT NULL
      ) OR (
        "review_source_observations"."content_state" IN ('source_expired', 'provider_deleted')
        AND "review_source_observations"."content_erased_at" IS NOT NULL
        AND "review_source_observations"."rating" IS NULL
        AND "review_source_observations"."original_text" IS NULL
        AND "review_source_observations"."translated_text" IS NULL
        AND "review_source_observations"."language_code" IS NULL
        AND "review_source_observations"."reviewer_name" IS NULL
        AND "review_source_observations"."reviewer_profile_photo_url" IS NULL
        AND "review_source_observations"."reviewed_at" IS NULL
        AND "review_source_observations"."source_created_at" IS NULL
        AND "review_source_observations"."source_updated_at" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"platform" "review_platform" NOT NULL,
	"external_id" varchar(500),
	"external_location_id" varchar(500),
	"google_connection_id" uuid,
	"reviewer_name" varchar(255),
	"reviewer_profile_photo_url" varchar(1000),
	"rating" integer,
	"text" text,
	"translated_text" text,
	"language_code" varchar(10),
	"reviewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"sentiment_label" varchar(20),
	"sentiment_score" real,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"first_fetched_at" timestamp with time zone,
	"last_fetched_at" timestamp with time zone,
	"content_expires_at" timestamp with time zone,
	"content_hash" text,
	"source_seen_generation" uuid,
	"source_epoch" integer NOT NULL,
	"source_revision" bigint NOT NULL,
	"source_observation_sequence" bigint DEFAULT 0 NOT NULL,
	"material_normalization_version" varchar(64),
	"material_source_digest" varchar(64),
	"material_normalized_digest" varchar(64),
	"analysis_sequence" bigint NOT NULL,
	"ai_source_byte_length" integer,
	"ai_source_digest" varchar(64),
	"source_content_state" varchar(24) DEFAULT 'active' NOT NULL,
	"source_content_erased_at" timestamp with time zone,
	"reply_state_revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_source_epoch_safe" CHECK ("reviews"."source_epoch" BETWEEN 0 AND 2147483647),
	CONSTRAINT "reviews_source_revision_safe" CHECK ("reviews"."source_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "reviews_source_observation_sequence_safe" CHECK ("reviews"."source_observation_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "reviews_material_comparison_head_valid" CHECK ((
        "reviews"."material_normalization_version" IS NULL
        AND "reviews"."material_source_digest" IS NULL
        AND "reviews"."material_normalized_digest" IS NULL
      ) OR (
        "reviews"."material_normalization_version" = 'legacy-unverified-v0'
        AND "reviews"."material_source_digest" IS NULL
        AND "reviews"."material_normalized_digest" IS NULL
      ) OR (
        "reviews"."material_normalization_version" = 'review-material-v1'
        AND "reviews"."material_source_digest" IS NOT NULL
        AND "reviews"."material_source_digest" ~ '^[0-9a-f]{64}$'
        AND "reviews"."material_normalized_digest" IS NOT NULL
        AND "reviews"."material_normalized_digest" ~ '^[0-9a-f]{64}$'
      )),
	CONSTRAINT "reviews_analysis_sequence_safe" CHECK ("reviews"."analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "reviews_ai_source_byte_length_valid" CHECK ("reviews"."ai_source_byte_length" BETWEEN 1 AND '4294967295'::bigint),
	CONSTRAINT "reviews_ai_source_digest_valid" CHECK ("reviews"."ai_source_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "reviews_reply_state_revision_safe" CHECK ("reviews"."reply_state_revision" BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "reviews_source_content_state_valid" CHECK ((
        "reviews"."source_content_state" = 'active'
        AND "reviews"."source_content_erased_at" IS NULL
      ) OR (
        "reviews"."source_content_state" IN ('source_expired', 'provider_deleted')
        AND "reviews"."source_content_erased_at" IS NOT NULL
        AND "reviews"."external_id" IS NULL
        AND "reviews"."external_location_id" IS NULL
        AND "reviews"."google_connection_id" IS NULL
        AND "reviews"."reviewer_name" IS NULL
        AND "reviews"."reviewer_profile_photo_url" IS NULL
        AND "reviews"."rating" IS NULL
        AND "reviews"."text" IS NULL
        AND "reviews"."translated_text" IS NULL
        AND "reviews"."language_code" IS NULL
        AND "reviews"."reviewed_at" IS NULL
        AND "reviews"."source_created_at" IS NULL
        AND "reviews"."source_updated_at" IS NULL
        AND "reviews"."content_hash" IS NULL
        AND "reviews"."ai_source_byte_length" IS NULL
        AND "reviews"."ai_source_digest" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"batch_size" integer NOT NULL,
	"batches" integer DEFAULT 0 NOT NULL,
	"rows_deleted" integer DEFAULT 0 NOT NULL,
	"rows_redacted" integer DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'completed' NOT NULL,
	"error_code" text,
	"policy_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_refresh_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"cursor_content_expires_at" timestamp with time zone,
	"cursor_review_id" uuid,
	"batch_size" integer NOT NULL,
	"max_batches" integer NOT NULL,
	"batches_processed" integer DEFAULT 0 NOT NULL,
	"candidates_seen" integer DEFAULT 0 NOT NULL,
	"refresh_due_count" integer DEFAULT 0 NOT NULL,
	"enqueued_count" integer DEFAULT 0 NOT NULL,
	"enqueue_failed_count" integer DEFAULT 0 NOT NULL,
	"oldest_due_content_expires_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"failure_reason" text,
	"next_attempt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" varchar(255) NOT NULL,
	"source" text DEFAULT 'google' NOT NULL,
	"mode" text NOT NULL,
	"source_epoch" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"page_count" integer DEFAULT 0,
	"review_count" integer DEFAULT 0,
	"created_count" integer DEFAULT 0,
	"updated_count" integer DEFAULT 0,
	"deleted_count" integer DEFAULT 0,
	"failed_count" integer DEFAULT 0,
	"result" text,
	"error_class" text
);
--> statement-breakpoint
CREATE TABLE "review_sync_state" (
	"property_id" varchar(255) NOT NULL,
	"source" text DEFAULT 'google' NOT NULL,
	"connection_id" varchar(255),
	"source_epoch" integer DEFAULT 0 NOT NULL,
	"watermark_updated_at" timestamp with time zone,
	"watermark_source_name" text,
	"overlap_duration_ms" bigint DEFAULT 300000,
	"generation_id" uuid,
	"page_token" text,
	"inventory_started_at" timestamp with time zone,
	"inventory_completed_at" timestamp with time zone,
	"inventory_status" text DEFAULT 'idle',
	"next_incremental_at" timestamp with time zone,
	"next_inventory_at" timestamp with time zone,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"last_notification_at" timestamp with time zone,
	"last_new_review_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_terminal_error_at" timestamp with time zone,
	"error_class" text,
	"error_retry_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_sync_state_property_id_source_pk" PRIMARY KEY("property_id","source")
);
--> statement-breakpoint
CREATE INDEX "ai_operations_due_idx" ON "ai_operations" USING btree ("state","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "ai_operations_property_idx" ON "ai_operations" USING btree ("organization_id","property_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "ai_operations_expiry_idx" ON "ai_operations" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "ai_operations_stale_reservation_idx" ON "ai_operations" USING btree ("budget_reserved_at") WHERE "ai_operations"."budget_settled_at" IS NULL AND "ai_operations"."reserved_micros" > 0;
--> statement-breakpoint
CREATE INDEX "ai_property_aggregate_contributions_date_idx" ON "ai_property_aggregate_contributions" USING btree ("organization_id","property_id","local_date","source_epoch","review_analysis_epoch");
--> statement-breakpoint
CREATE INDEX "ai_property_aggregate_heads_current_idx" ON "ai_property_aggregate_heads" USING btree ("organization_id","property_id","source_epoch","review_analysis_epoch","property_profile_version");
--> statement-breakpoint
CREATE INDEX "ai_property_daily_aggregates_window_idx" ON "ai_property_daily_aggregates" USING btree ("organization_id","property_id","source_epoch","review_analysis_epoch","local_date");
--> statement-breakpoint
CREATE INDEX "ai_property_profiles_org_idx" ON "ai_property_processing_profiles" USING btree ("organization_id","updated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "ai_property_trend_outcomes_property_idx" ON "ai_property_trend_outcomes" USING btree ("organization_id","property_id","recorded_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "ai_property_trend_outcomes_expiry_idx" ON "ai_property_trend_outcomes" USING btree ("expires_at") WHERE "ai_property_trend_outcomes"."expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "ai_property_trend_schedules_property_idx" ON "ai_property_trend_schedules" USING btree ("organization_id","property_id","due_local_date" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "ai_review_analyses_current_idx" ON "ai_review_analyses" USING btree ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence");
--> statement-breakpoint
CREATE INDEX "ai_review_analyses_expiry_idx" ON "ai_review_analyses" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "ai_review_analysis_enrollments_actionable_idx" ON "ai_review_analysis_enrollments" USING btree ("created_at","id") WHERE "ai_review_analysis_enrollments"."state" IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX "ai_review_analysis_enrollments_property_idx" ON "ai_review_analysis_enrollments" USING btree ("organization_id","property_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "operational_action_history_hold_org_idx" ON "operational_action_history_legal_holds" USING btree ("organization_id","released_at","protects_from");
--> statement-breakpoint
CREATE INDEX "operational_action_history_org_time_idx" ON "operational_action_history_records" USING btree ("organization_id","occurred_at" DESC NULLS LAST,"sequence" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "operational_action_history_actor_idx" ON "operational_action_history_records" USING btree ("organization_id","actor_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "operational_action_history_resource_idx" ON "operational_action_history_records" USING btree ("organization_id","resource_type","resource_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "recent_activity_actor_label_redactions_expiry_idx" ON "recent_activity_actor_label_redactions" USING btree ("expires_at","organization_id","actor_subject_id");
--> statement-breakpoint
CREATE INDEX "recent_activity_entries_resource_idx" ON "recent_activity_entries" USING btree ("resource_type","resource_id","created_at");
--> statement-breakpoint
CREATE INDEX "recent_activity_entries_org_property_idx" ON "recent_activity_entries" USING btree ("organization_id","property_id","created_at");
--> statement-breakpoint
CREATE INDEX "recent_activity_entries_event_id_idx" ON "recent_activity_entries" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "recent_activity_entries_actor_idx" ON "recent_activity_entries" USING btree ("actor_id","created_at");
--> statement-breakpoint
CREATE INDEX "recent_activity_replay_org_time_idx" ON "recent_activity_replay_facts" USING btree ("organization_id","source_occurred_at" DESC NULLS LAST,"replay_key");
--> statement-breakpoint
CREATE INDEX "recent_activity_replay_retention_idx" ON "recent_activity_replay_facts" USING btree ("source_occurred_at","replay_key");
--> statement-breakpoint
CREATE INDEX "recent_activity_replay_source_event_idx" ON "recent_activity_replay_facts" USING btree ("source_event_id","organization_id");
--> statement-breakpoint
CREATE INDEX "recent_activity_replay_actor_idx" ON "recent_activity_replay_facts" USING btree ("organization_id","actor_subject_id","replay_key");
--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_work_queue_idx" ON "beta_feedback_triage" USING btree ("owner_queue","triage_state","updated_at" desc);
--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_delivery_idx" ON "beta_feedback_triage" USING btree ("delivery_state","created_at" desc);
--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_attachment_expiry_idx" ON "beta_feedback_triage" USING btree ("attachment_expires_at");
--> statement-breakpoint
CREATE INDEX "beta_feedback_triage_transition_reference_idx" ON "beta_feedback_triage_transitions" USING btree ("feedback_reference","occurred_at" desc);
--> statement-breakpoint
CREATE INDEX "goal_monthly_results_due_idx" ON "goal_monthly_results" USING btree ("status","period_end","organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "goal_program_versions_effective_idx" ON "goal_program_versions" USING btree ("organization_id","property_id","program_id","effective_from");
--> statement-breakpoint
CREATE INDEX "goal_programs_property_status_idx" ON "goal_programs" USING btree ("organization_id","property_id","status");
--> statement-breakpoint
CREATE INDEX "goal_result_revisions_history_idx" ON "goal_result_revisions" USING btree ("organization_id","property_id","monthly_result_id","revision");
--> statement-breakpoint
CREATE INDEX "goal_subject_assignments_program_idx" ON "goal_subject_assignments" USING btree ("organization_id","property_id","program_id","effective_from");
--> statement-breakpoint
CREATE INDEX "goal_subject_assignments_subject_idx" ON "goal_subject_assignments" USING btree ("organization_id","property_id","subject_kind","property_subject_id","portal_group_id","portal_id");
--> statement-breakpoint
CREATE INDEX "google_connections_status_idx" ON "google_connections" USING btree ("status") WHERE "google_connections"."status" NOT IN ('active', 'disconnected');
--> statement-breakpoint
CREATE INDEX "google_import_discovery_records_scope_idx" ON "google_import_discovery_records" USING btree ("organization_id","user_id","connection_id");
--> statement-breakpoint
CREATE INDEX "google_import_discovery_records_property_idx" ON "google_import_discovery_records" USING btree ("organization_id","affected_property_id") WHERE "google_import_discovery_records"."affected_property_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "google_import_discovery_records_expiry_idx" ON "google_import_discovery_records" USING btree ("expires_at","reference_key");
--> statement-breakpoint
CREATE INDEX "gbp_import_request_items_parent_status_idx" ON "gbp_import_request_items" USING btree ("organization_id","import_job_id","status","retry_revision");
--> statement-breakpoint
CREATE INDEX "gbp_import_request_items_effect_deadline_idx" ON "gbp_import_request_items" USING btree ("effect_deadline_at","id") WHERE "gbp_import_request_items"."status" IN ('pending', 'processing');
--> statement-breakpoint
CREATE INDEX "gbp_import_request_items_dispatch_idx" ON "gbp_import_request_items" USING btree ("organization_id","id","status") WHERE "gbp_import_request_items"."status" IN ('pending', 'processing');
--> statement-breakpoint
CREATE INDEX "gbp_import_requests_initiated_request_idx" ON "gbp_import_requests" USING btree ("organization_id","initiated_by","request_id");
--> statement-breakpoint
CREATE INDEX "gbp_import_requests_purge_idx" ON "gbp_import_requests" USING btree ("purge_at","id") WHERE "gbp_import_requests"."purge_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "gbp_import_sagas_initiated_request_idx" ON "gbp_import_sagas" USING btree ("organization_id","initiated_by","request_id");
--> statement-breakpoint
CREATE INDEX "authorization_execution_permits_active_idx" ON "authorization_execution_permits" USING btree ("capability","state","start_deadline_at","operation_deadline_at");
--> statement-breakpoint
CREATE INDEX "authorization_execution_permits_scope_idx" ON "authorization_execution_permits" USING btree ("organization_id","property_id","connection_id");
--> statement-breakpoint
CREATE INDEX "credential_revoke_permits_active_idx" ON "credential_revoke_permits" USING btree ("guard_id","state","cleanup_deadline_at");
--> statement-breakpoint
CREATE INDEX "google_credential_source_operations_active_idx" ON "google_credential_source_operations" USING btree ("guard_id","state","operation_deadline_at");
--> statement-breakpoint
CREATE INDEX "google_subject_authority_guards_active_idx" ON "google_subject_authority_guards" USING btree ("state","cleanup_deadline_at");
--> statement-breakpoint
CREATE INDEX "feedback_portal_idx" ON "feedback" USING btree ("portal_id");
--> statement-breakpoint
CREATE INDEX "guest_contact_reveal_audits_request_idx" ON "guest_contact_request_reveal_audits" USING btree ("organization_id","contact_request_id","revealed_at");
--> statement-breakpoint
CREATE INDEX "guest_contact_requests_expiry_idx" ON "guest_contact_requests" USING btree ("status","expires_at","id");
--> statement-breakpoint
CREATE INDEX "guest_network_pressure_lookup_idx" ON "guest_network_pressure_records" USING btree ("organization_id","property_id","portal_id","pseudonym","action","observed_at");
--> statement-breakpoint
CREATE INDEX "guest_network_pressure_expiry_idx" ON "guest_network_pressure_records" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "guest_qualified_scans_scope_time_idx" ON "guest_qualified_scans" USING btree ("organization_id","property_id","portal_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "guest_response_integrity_decisions_scope_outcome_idx" ON "guest_response_integrity_decisions" USING btree ("organization_id","property_id","portal_id","outcome","decided_at");
--> statement-breakpoint
CREATE INDEX "guest_response_private_feedback_expiry_idx" ON "guest_response_private_feedback" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "guest_response_session_bindings_expiry_idx" ON "guest_response_session_bindings" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "guest_responses_portal_status_idx" ON "guest_responses" USING btree ("organization_id","property_id","portal_id","status");
--> statement-breakpoint
CREATE INDEX "guest_responses_portal_integrity_idx" ON "guest_responses" USING btree ("organization_id","property_id","portal_id","integrity_outcome");
--> statement-breakpoint
CREATE INDEX "ratings_portal_idx" ON "ratings" USING btree ("portal_id");
--> statement-breakpoint
CREATE INDEX "scan_events_session_idx" ON "scan_events" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "scan_events_portal_idx" ON "scan_events" USING btree ("portal_id");
--> statement-breakpoint
CREATE INDEX "inbox_assignment_history_scope_idx" ON "inbox_assignment_history" USING btree ("organization_id","property_id","occurred_at","inbox_item_id");
--> statement-breakpoint
CREATE INDEX "inbox_assignment_history_assignee_idx" ON "inbox_assignment_history" USING btree ("organization_id","next_assignee","occurred_at");
--> statement-breakpoint
CREATE INDEX "inbox_escalation_history_scope_idx" ON "inbox_escalation_history" USING btree ("organization_id","property_id","occurred_at","inbox_item_id");
--> statement-breakpoint
CREATE INDEX "inbox_escalation_history_item_idx" ON "inbox_escalation_history" USING btree ("inbox_item_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "inbox_feedback_handling_outcomes_scope_idx" ON "inbox_feedback_handling_outcomes" USING btree ("organization_id","property_id","inbox_item_id","cycle_number","outcome_revision");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_heads_scope_idx" ON "inbox_handling_cycle_heads" USING btree ("organization_id","property_id","status");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_response_targets_active_due_idx" ON "inbox_handling_cycle_response_targets" USING btree ("organization_id","target_kind","due_at","inbox_item_id") WHERE "inbox_handling_cycle_response_targets"."completion_at" IS NULL AND "inbox_handling_cycle_response_targets"."performance_eligibility" = 'measured';
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_response_targets_property_result_idx" ON "inbox_handling_cycle_response_targets" USING btree ("organization_id","property_id","target_kind","result","start_at");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_transitions_scope_idx" ON "inbox_handling_cycle_transitions" USING btree ("organization_id","property_id","inbox_item_id","state_revision");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycle_transitions_source_idx" ON "inbox_handling_cycle_transitions" USING btree ("source_type","source_id","source_revision");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycles_scope_idx" ON "inbox_handling_cycles" USING btree ("organization_id","property_id","inbox_item_id","cycle_number");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycles_review_revision_idx" ON "inbox_handling_cycles" USING btree ("review_id","material_review_revision","cycle_number");
--> statement-breakpoint
CREATE INDEX "inbox_handling_cycles_source_revision_idx" ON "inbox_handling_cycles" USING btree ("source_type","source_id","source_revision","cycle_number");
--> statement-breakpoint
CREATE INDEX "inbox_items_org_status_idx" ON "inbox_items" USING btree ("organization_id","status");
--> statement-breakpoint
CREATE INDEX "inbox_items_org_source_date_idx" ON "inbox_items" USING btree ("organization_id","source_date" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_items_org_property_idx" ON "inbox_items" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "inbox_items_org_property_status_idx" ON "inbox_items" USING btree ("organization_id","property_id","status");
--> statement-breakpoint
CREATE INDEX "inbox_items_org_escalated_active_idx" ON "inbox_items" USING btree ("organization_id","is_escalated","escalation_resolved_at");
--> statement-breakpoint
CREATE INDEX "inbox_items_source_date_idx" ON "inbox_items" USING btree ("source_date");
--> statement-breakpoint
CREATE INDEX "inbox_items_created_at_idx" ON "inbox_items" USING btree ("created_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_notes_item_idx" ON "inbox_notes" USING btree ("inbox_item_id");
--> statement-breakpoint
CREATE INDEX "inbox_response_target_reminders_due_idx" ON "inbox_response_target_reminders" USING btree ("scheduled_for","inbox_item_id","cycle_number","reminder_kind") WHERE "inbox_response_target_reminders"."delivered_at" IS NULL AND "inbox_response_target_reminders"."cancelled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "identity_organization_lifecycle_receipts_org_time_idx" ON "identity_organization_lifecycle_receipts" USING btree ("organization_id","occurred_at" desc);
--> statement-breakpoint
CREATE INDEX "organization_export_retrieval_issuances_org_time_idx" ON "organization_export_retrieval_issuances" USING btree ("organization_id","issued_at" desc);
--> statement-breakpoint
CREATE INDEX "organization_exports_generation_idx" ON "organization_exports" USING btree ("state","generation_lease_expires_at","created_at");
--> statement-breakpoint
CREATE INDEX "organization_exports_expiry_idx" ON "organization_exports" USING btree ("state","object_expires_at");
--> statement-breakpoint
CREATE INDEX "organization_exports_pre_egress_idx" ON "organization_exports" USING btree ("state","pre_egress_recorded_at");
--> statement-breakpoint
CREATE INDEX "organization_lifecycle_state_deadline_idx" ON "organization_lifecycle_authority" USING btree ("state","recoverable_until");
--> statement-breakpoint
CREATE INDEX "organization_lifecycle_transition_idx" ON "organization_lifecycle_authority" USING btree ("last_transition_at" desc);
--> statement-breakpoint
CREATE INDEX "organization_lifecycle_receipt_org_time_idx" ON "organization_lifecycle_command_receipts" USING btree ("organization_id","occurred_at" desc);
--> statement-breakpoint
CREATE INDEX "context_organization_lifecycle_receipts_org_time_idx" ON "context_organization_lifecycle_receipts" USING btree ("organization_id","occurred_at" desc);
--> statement-breakpoint
CREATE INDEX "context_organization_lifecycle_receipts_lineage_idx" ON "context_organization_lifecycle_receipts" USING btree ("closure_lineage_id","lifecycle_revision","phase");
--> statement-breakpoint
CREATE INDEX "backup_erasure_ledger_replay_idx" ON "backup_erasure_ledger" USING btree ("effective_erasure_at");
--> statement-breakpoint
CREATE INDEX "backup_erasure_ledger_org_idx" ON "backup_erasure_ledger" USING btree ("organization_id","effective_erasure_at");
--> statement-breakpoint
CREATE INDEX "property_erase_authorities_state_idx" ON "property_erase_authorities" USING btree ("state","state_changed_at");
--> statement-breakpoint
CREATE INDEX "property_erase_authorities_org_idx" ON "property_erase_authorities" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "property_erase_context_receipts_authority_idx" ON "property_erase_context_receipts" USING btree ("authority_id","phase");
--> statement-breakpoint
CREATE INDEX "privacy_request_transitions_request_idx" ON "privacy_request_transitions" USING btree ("request_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "privacy_requests_scope_idx" ON "privacy_requests" USING btree ("organization_id","property_id","state");
--> statement-breakpoint
CREATE INDEX "privacy_requests_subject_idx" ON "privacy_requests" USING btree ("subject_ref","received_at");
--> statement-breakpoint
CREATE INDEX "metric_corrections_reading_idx" ON "metric_corrections" USING btree ("reading_id","recorded_at");
--> statement-breakpoint
CREATE INDEX "metric_current_google_reputation_scope_idx" ON "metric_current_google_reputation_snapshots" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "metric_readings_org_idx" ON "metric_readings" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "metric_readings_org_key_recorded_idx" ON "metric_readings" USING btree ("organization_id","metric_key","recorded_at");
--> statement-breakpoint
CREATE INDEX "metric_readings_org_property_idx" ON "metric_readings" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "metric_readings_org_portal_idx" ON "metric_readings" USING btree ("organization_id","portal_id");
--> statement-breakpoint
CREATE INDEX "metric_readings_org_prop_recorded_idx" ON "metric_readings" USING btree ("organization_id","property_id","recorded_at");
--> statement-breakpoint
CREATE INDEX "metric_readings_org_group_idx" ON "metric_readings" USING btree ("organization_id","group_id");
--> statement-breakpoint
CREATE INDEX "metric_readings_recorded_at_idx" ON "metric_readings" USING btree ("recorded_at");
--> statement-breakpoint
CREATE INDEX "metric_readings_version_event_idx" ON "metric_readings" USING btree ("definition_version_id","event_at");
--> statement-breakpoint
CREATE INDEX "portal_metric_lifetime_property_idx" ON "portal_metric_lifetime_aggregates" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "notification_digest_batches_retention_idx" ON "notification_digest_batches" USING btree ("state","updated_at");
--> statement-breakpoint
CREATE INDEX "email_queue_due_idx" ON "notification_email_queue" USING btree ("status","cadence","not_before","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "email_queue_property_digest_idx" ON "notification_email_queue" USING btree ("organization_id","property_id","status","cadence");
--> statement-breakpoint
CREATE INDEX "notification_email_queue_immediate_acceptance_health_idx" ON "notification_email_queue" USING btree ("created_at" DESC NULLS LAST,"id") WHERE "notification_email_queue"."cadence" = 'immediate' AND "notification_email_queue"."not_before" IS NULL;
--> statement-breakpoint
CREATE INDEX "notifications_user_status_idx" ON "notifications" USING btree ("user_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX "idempotency_receipts_recorded_at_idx" ON "idempotency_receipts" USING btree ("recorded_at","scope","key");
--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" IS NULL AND "outbox_events"."lease_expires_at" IS NULL AND "outbox_events"."recovery_fenced_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "outbox_events_lease_expires_idx" ON "outbox_events" USING btree ("lease_expires_at") WHERE "outbox_events"."published_at" IS NULL AND "outbox_events"."lease_expires_at" IS NOT NULL AND "outbox_events"."recovery_fenced_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "outbox_events_org_created_idx" ON "outbox_events" USING btree ("organization_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "outbox_events_recovery_fence_idx" ON "outbox_events" USING btree ("recovery_fence_run_id","created_at") WHERE "outbox_events"."recovery_fenced_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "pgm_org_portal_idx" ON "portal_group_memberships" USING btree ("organization_id","portal_id");
--> statement-breakpoint
CREATE INDEX "pr_org_portal_idx" ON "portal_responsibilities" USING btree ("organization_id","portal_id");
--> statement-breakpoint
CREATE INDEX "pag_org_prop_user_idx" ON "property_access_grants" USING btree ("organization_id","property_id","user_id");
--> statement-breakpoint
CREATE INDEX "staff_participants_org_status_name_idx" ON "staff_participants" USING btree ("organization_id","status","display_name");
--> statement-breakpoint
CREATE INDEX "sp_org_prop_user_idx" ON "staff_participations" USING btree ("organization_id","property_id","user_id");
--> statement-breakpoint
CREATE INDEX "staff_user_links_org_participant_idx" ON "staff_user_links" USING btree ("organization_id","staff_participant_id");
--> statement-breakpoint
CREATE INDEX "staff_user_links_org_user_idx" ON "staff_user_links" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "property_access_grant_user_idx" ON "property_access_grant" USING btree ("organization_id","user_id") WHERE "property_access_grant"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "merchant_ai_consent_evidence_property_version_idx" ON "merchant_ai_consent_evidence" USING btree ("organization_id","property_id","state_version");
--> statement-breakpoint
CREATE INDEX "merchant_ai_enablement_org_idx" ON "merchant_ai_enablement" USING btree ("organization_id","updated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "portal_access_artifacts_portal_idx" ON "portal_access_artifacts" USING btree ("organization_id","property_id","portal_id");
--> statement-breakpoint
CREATE INDEX "portal_group_members_group_idx" ON "portal_group_members" USING btree ("portal_group_id");
--> statement-breakpoint
CREATE INDEX "portal_health_intervals_history_idx" ON "portal_health_intervals" USING btree ("organization_id","property_id","portal_id","effective_from");
--> statement-breakpoint
CREATE INDEX "portal_link_categories_portal_idx" ON "portal_link_categories" USING btree ("portal_id");
--> statement-breakpoint
CREATE INDEX "portal_links_portal_idx" ON "portal_links" USING btree ("portal_id");
--> statement-breakpoint
CREATE INDEX "portal_links_category_idx" ON "portal_links" USING btree ("category_id");
--> statement-breakpoint
CREATE INDEX "portal_pending_content_changes_open_idx" ON "portal_pending_content_changes" USING btree ("organization_id","property_id","portal_id","changed_at") WHERE "portal_pending_content_changes"."resolved_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "portal_publication_activations_snapshot_idx" ON "portal_publication_activations" USING btree ("organization_id","portal_id","snapshot_id");
--> statement-breakpoint
CREATE INDEX "portal_publication_snapshots_portal_created_idx" ON "portal_publication_snapshots" USING btree ("organization_id","portal_id","created_at");
--> statement-breakpoint
CREATE INDEX "prm_org_portal_idx" ON "portal_responsible_managers" USING btree ("organization_id","portal_id");
--> statement-breakpoint
CREATE INDEX "prm_org_user_idx" ON "portal_responsible_managers" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "portal_tokens_active_lookup_idx" ON "portal_tokens" USING btree ("token_identifier","status","grace_period_ends");
--> statement-breakpoint
CREATE INDEX "portal_upload_issuances_scope_idx" ON "portal_upload_issuances" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE INDEX "portal_upload_issuances_expiry_idx" ON "portal_upload_issuances" USING btree ("state","expires_at");
--> statement-breakpoint
CREATE INDEX "portal_upload_issuances_source_cleanup_idx" ON "portal_upload_issuances" USING btree ("expires_at","id") WHERE "portal_upload_issuances"."source_deleted_at" IS NULL OR ("portal_upload_issuances"."orphan_derivatives_deleted_at" IS NULL AND "portal_upload_issuances"."state" IN ('superseded', 'rejected', 'expired'));
--> statement-breakpoint
CREATE INDEX "portals_org_property_idx" ON "portals" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "properties_org_lower_name_id_active_idx" ON "properties" USING btree ("organization_id",lower("name"),"id") WHERE "properties"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "properties_lifecycle_state_idx" ON "properties" USING btree ("lifecycle_state") WHERE lifecycle_state <> 'purged';
--> statement-breakpoint
CREATE INDEX "property_rm_org_property_idx" ON "property_responsible_managers" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE INDEX "property_rm_org_user_idx" ON "property_responsible_managers" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE INDEX "recovery_runs_completed_idx" ON "recovery_runs" USING btree ("completed_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "review_lifecycle_recovery_state_idx" ON "review_lifecycle_recovery_executions" USING btree ("state");
--> statement-breakpoint
CREATE INDEX "google_reply_observation_heads_scope_idx" ON "google_reply_observation_heads" USING btree ("organization_id","property_id","state");
--> statement-breakpoint
CREATE INDEX "google_reply_observations_scope_idx" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","observation_revision");
--> statement-breakpoint
CREATE INDEX "material_review_revisions_scope_idx" ON "material_review_revisions" USING btree ("organization_id","property_id","review_id","revision");
--> statement-breakpoint
CREATE INDEX "replies_review_idx" ON "replies" USING btree ("review_id");
--> statement-breakpoint
CREATE INDEX "replies_org_idx" ON "replies" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "replies_publication_reconcile_idx" ON "replies" USING btree ("reconcile_due_at","id") WHERE publication_state IN ('pending_observation', 'ambiguous') AND reconcile_due_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "reply_publication_attempts_review_idx" ON "reply_publication_attempts" USING btree ("organization_id","review_id","created_at");
--> statement-breakpoint
CREATE INDEX "reply_publication_authorizations_review_idx" ON "reply_publication_authorizations" USING btree ("organization_id","review_id","authorized_at");
--> statement-breakpoint
CREATE INDEX "review_google_reputation_snapshot_scope_idx" ON "review_google_reputation_snapshot_facts" USING btree ("organization_id","property_id","source_epoch","evaluated_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "review_source_contents_expiry_idx" ON "review_source_contents" USING btree ("content_expires_at","review_id");
--> statement-breakpoint
CREATE INDEX "review_source_contents_connection_idx" ON "review_source_contents" USING btree ("google_connection_id");
--> statement-breakpoint
CREATE INDEX "review_source_observations_digest_idx" ON "review_source_observations" USING btree ("review_id","source_epoch","observation_digest");
--> statement-breakpoint
CREATE INDEX "review_source_observations_expiry_idx" ON "review_source_observations" USING btree ("content_state","content_expires_at","review_id","observation_sequence");
--> statement-breakpoint
CREATE INDEX "reviews_property_idx" ON "reviews" USING btree ("property_id");
--> statement-breakpoint
CREATE INDEX "reviews_org_idx" ON "reviews" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "reviews_expires_idx" ON "reviews" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "reviews_org_property_reviewed_idx" ON "reviews" USING btree ("organization_id","property_id","reviewed_at");
--> statement-breakpoint
CREATE INDEX "reviews_google_connection_idx" ON "reviews" USING btree ("google_connection_id");
--> statement-breakpoint
CREATE INDEX "reviews_property_updated_cursor_idx" ON "reviews" USING btree ("property_id","source_updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "reviews_property_created_cursor_idx" ON "reviews" USING btree ("property_id","source_created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "reviews_lifecycle_cursor_idx" ON "reviews" USING btree ("created_at","id");
--> statement-breakpoint
CREATE INDEX "reviews_content_expires_idx" ON "reviews" USING btree ("content_expires_at","id") WHERE content_expires_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "retention_runs_subject_started_idx" ON "retention_runs" USING btree ("subject","started_at");
--> statement-breakpoint
CREATE INDEX "review_refresh_runs_started_at_idx" ON "review_refresh_runs" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "review_sync_runs_started_at_idx" ON "review_sync_runs" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "review_sync_state_due_incremental_idx" ON "review_sync_state" USING btree ("next_incremental_at") WHERE next_incremental_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "review_sync_state_lease_expired_idx" ON "review_sync_state" USING btree ("lease_until") WHERE lease_until IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_control_heads_control_unique" ON "ai_execution_control_heads" USING btree ("control_id","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_control_transitions_scope_generation_unique" ON "ai_execution_control_transitions" USING btree ("scope_key","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operations_idempotency_unique" ON "ai_operations" USING btree ("idempotency_scope","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operations_execution_permit_unique" ON "ai_operations" USING btree ("execution_permit_id") WHERE "ai_operations"."execution_permit_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_organization_cost_windows_month_unique" ON "ai_organization_cost_windows" USING btree ("organization_id","window_start");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_outcomes_operation_unique" ON "ai_property_trend_outcomes" USING btree ("operation_id") WHERE "ai_property_trend_outcomes"."operation_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_schedules_outbox_unique" ON "ai_property_trend_schedules" USING btree ("outbox_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_property_trend_schedules_generation_unique" ON "ai_property_trend_schedules" USING btree ("organization_id","property_id","due_local_date","source_epoch","review_analysis_epoch","property_trends_epoch","property_profile_version","terminal_analysis_sequence","aggregate_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analyses_operation_unique" ON "ai_review_analyses" USING btree ("operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_scope_unique" ON "ai_review_analysis_enrollments" USING btree ("id","organization_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_fence_unique" ON "ai_review_analysis_enrollments" USING btree ("organization_id","property_id","authorization_lineage_id","authorization_state_version","source_epoch","review_analysis_epoch","analysis_start_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_trigger_unique" ON "ai_review_analysis_enrollments" USING btree ("trigger_event_envelope_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_review_analysis_enrollments_one_active" ON "ai_review_analysis_enrollments" USING btree ("organization_id","property_id") WHERE "ai_review_analysis_enrollments"."state" IN ('awaiting_assisted_approval', 'queued', 'running');
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_action_history_org_sequence_uniq" ON "operational_action_history_records" USING btree ("organization_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "operational_action_history_provenance_uniq" ON "operational_action_history_records" USING btree ("organization_id","provenance_kind","provenance_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "recent_activity_entries_event_id_org_uniq" ON "recent_activity_entries" USING btree ("event_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "beta_feedback_triage_provider_reference_unique" ON "beta_feedback_triage" USING btree ("provider_reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "beta_feedback_triage_transition_revision_unique" ON "beta_feedback_triage_transitions" USING btree ("feedback_reference","result_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_role_policy_org_role_unique" ON "organization_role_policy" USING btree ("organization_id","role");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_org_id_key" ON "google_connections" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_google_subject_idx" ON "google_connections" USING btree ("google_subject") WHERE "google_connections"."google_subject" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_request_items_org_id_key" ON "gbp_import_request_items" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_requests_org_request_unique" ON "gbp_import_requests" USING btree ("organization_id","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_requests_org_id_key" ON "gbp_import_requests" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_requests_saga_batch_unique" ON "gbp_import_requests" USING btree ("organization_id","saga_id","batch_ordinal");
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_sagas_org_request_unique" ON "gbp_import_sagas" USING btree ("organization_id","request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "gbp_import_sagas_org_id_key" ON "gbp_import_sagas" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_credential_source_operations_guard_sequence_key" ON "google_credential_source_operations" USING btree ("guard_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_credential_source_operations_one_active_idx" ON "google_credential_source_operations" USING btree ("guard_id") WHERE "google_credential_source_operations"."state" IN ('registered', 'provider_started', 'provider_outcome_ambiguous');
--> statement-breakpoint
CREATE UNIQUE INDEX "google_subject_authority_guards_subject_key" ON "google_subject_authority_guards" USING btree ("project_client_hmac_key_version","project_client_hmac","subject_hmac_key_version","subject_hmac");
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_session_portal_unique" ON "feedback" USING btree ("session_id","portal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_requests_org_id_key" ON "guest_contact_requests" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_requests_scope_id_key" ON "guest_contact_requests" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_contact_requests_response_key" ON "guest_contact_requests" USING btree ("organization_id","response_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_qualified_scans_source_event_key" ON "guest_qualified_scans" USING btree ("source_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_qualified_scans_scope_id_key" ON "guest_qualified_scans" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_response_experience_snapshots_org_key" ON "guest_response_experience_snapshots" USING btree ("organization_id","response_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_response_integrity_decisions_response_revision_key" ON "guest_response_integrity_decisions" USING btree ("response_id","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_response_session_bindings_dedupe" ON "guest_response_session_bindings" USING btree ("organization_id","portal_id","session_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_responses_org_id_key" ON "guest_responses" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "guest_responses_scope_id_key" ON "guest_responses" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_session_portal_unique" ON "ratings" USING btree ("session_id","portal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_cycle_revision_unique" ON "inbox_feedback_handling_outcomes" USING btree ("inbox_item_id","cycle_number","outcome_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_chain_target_unique" ON "inbox_feedback_handling_outcomes" USING btree ("inbox_item_id","cycle_number","id","outcome_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_feedback_handling_outcomes_command_revision_unique" ON "inbox_feedback_handling_outcomes" USING btree ("inbox_item_id","resulting_command_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_handling_cycle_response_targets_scope_unique" ON "inbox_handling_cycle_response_targets" USING btree ("inbox_item_id","cycle_number","organization_id","property_id","target_kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_handling_cycles_outcome_scope_unique" ON "inbox_handling_cycles" USING btree ("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_source_unique" ON "inbox_items" USING btree ("source_type","source_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_cycle_source_scope_unique" ON "inbox_items" USING btree ("id","organization_id","source_type","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_response_target_reminders_event_unique" ON "inbox_response_target_reminders" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_user_views_org_user_unique" ON "inbox_user_views" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_export_retrieval_issuances_operation_idx" ON "organization_export_retrieval_issuances" USING btree ("export_id","operation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_export_retrieval_issuances_digest_idx" ON "organization_export_retrieval_issuances" USING btree ("export_id","token_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_exports_one_open_per_org_idx" ON "organization_exports" USING btree ("organization_id") WHERE "organization_exports"."state" IN ('requested', 'generating', 'egress_pending', 'ready', 'retrieval_issued');
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_erasure_ledger_lineage_unique" ON "backup_erasure_ledger" USING btree ("subject_class","closure_lineage_id","lifecycle_revision","context");
--> statement-breakpoint
CREATE UNIQUE INDEX "property_erase_authorities_live_unique" ON "property_erase_authorities" USING btree ("property_id") WHERE state NOT IN ('purged', 'cancelled');
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_corrections_source_unique" ON "metric_corrections" USING btree ("source_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_corrections_supersedes_unique" ON "metric_corrections" USING btree ("supersedes_correction_id") WHERE "metric_corrections"."supersedes_correction_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_corrections_root_unique" ON "metric_corrections" USING btree ("reading_id") WHERE "metric_corrections"."supersedes_correction_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_current_google_reputation_source_run_unique" ON "metric_current_google_reputation_snapshots" USING btree ("source_run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_current_google_reputation_source_event_unique" ON "metric_current_google_reputation_snapshots" USING btree ("source_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "metric_readings_version_source_unique" ON "metric_readings" USING btree ("definition_version_id","source_event_id") WHERE "metric_readings"."definition_version_id" IS NOT NULL AND "metric_readings"."source_event_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_metric_lifetime_scope_unique" ON "portal_metric_lifetime_aggregates" USING btree ("organization_id","property_id","portal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batch_members_email_unique" ON "notification_digest_batch_members" USING btree ("notification_email_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batch_members_order_unique" ON "notification_digest_batch_members" USING btree ("batch_id","sort_index");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_sequence_unique" ON "notification_digest_batches" USING btree ("organization_id","user_id","local_date","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_provider_key_unique" ON "notification_digest_batches" USING btree ("provider_idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_id_tenant_recipient_unique" ON "notification_digest_batches" USING btree ("id","organization_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_open_unique" ON "notification_digest_batches" USING btree ("organization_id","user_id") WHERE state IN ('prepared', 'retryable');
--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_property_idempotency_unique" ON "notification_email_queue" USING btree ("organization_id","property_id","idempotency_key") WHERE "notification_email_queue"."property_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_organization_idempotency_unique" ON "notification_email_queue" USING btree ("organization_id","idempotency_key") WHERE "notification_email_queue"."property_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_notification_unique" ON "notification_email_queue" USING btree ("notification_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_id_tenant_recipient_unique" ON "notification_email_queue" USING btree ("id","organization_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_scope_unique" ON "notification_preferences" USING btree ("user_id","organization_id","property_id","category","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_user_settings_scope_unique" ON "notification_user_settings" USING btree ("user_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_unread_resource_unique" ON "notifications" USING btree ("user_id","type","resource_id") WHERE status = 'unread';
--> statement-breakpoint
CREATE UNIQUE INDEX "pgm_unique_active" ON "portal_group_memberships" USING btree ("organization_id","portal_id") WHERE effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "pr_scope_id_participation_key" ON "portal_responsibilities" USING btree ("organization_id","property_id","portal_id","id","staff_participation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "pr_unique_active_primary" ON "portal_responsibilities" USING btree ("organization_id","portal_id") WHERE kind = 'primary' AND effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "pag_unique_active" ON "property_access_grants" USING btree ("organization_id","property_id","user_id","kind") WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_participants_org_id_key" ON "staff_participants" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sp_unique_active" ON "staff_participations" USING btree ("organization_id","property_id","user_id") WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "sp_unique_active_participant" ON "staff_participations" USING btree ("organization_id","property_id","staff_participant_id") WHERE status = 'active' AND staff_participant_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "sp_org_property_id_key" ON "staff_participations" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sp_org_property_id_participant_key" ON "staff_participations" USING btree ("organization_id","property_id","id","staff_participant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_links_unique_active_participant" ON "staff_user_links" USING btree ("organization_id","staff_participant_id") WHERE effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_links_unique_active_user" ON "staff_user_links" USING btree ("organization_id","user_id") WHERE effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_consent_active_unique" ON "policy_consent" USING btree ("organization_id","subject_type","subject_id","purpose") WHERE "policy_consent"."state" = 'granted';
--> statement-breakpoint
CREATE UNIQUE INDEX "property_access_grant_active_unique" ON "property_access_grant" USING btree ("organization_id","property_id","user_id") WHERE "property_access_grant"."revoked_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_ai_consent_evidence_scope_unique" ON "merchant_ai_consent_evidence" USING btree ("authorization_lineage_id","state_version","organization_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_ai_consent_evidence_idempotency_unique" ON "merchant_ai_consent_evidence" USING btree ("organization_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_access_artifacts_token_channel_key" ON "portal_access_artifacts" USING btree ("portal_token_id","channel") WHERE "portal_access_artifacts"."status" = 'published';
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_access_artifacts_scope_id_key" ON "portal_access_artifacts" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_approved_destinations_uri_unique" ON "portal_approved_destinations" USING btree ("organization_id","property_id","normalized_uri");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_approved_destinations_scope_id_key" ON "portal_approved_destinations" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_group_members_portal_id_unique" ON "portal_group_members" USING btree ("portal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_groups_org_property_name_unique" ON "portal_groups" USING btree ("organization_id","property_id","name") WHERE "portal_groups"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_groups_org_property_id_key" ON "portal_groups" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_health_intervals_one_current" ON "portal_health_intervals" USING btree ("organization_id","portal_id") WHERE "portal_health_intervals"."effective_to" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_link_categories_org_portal_id_key" ON "portal_link_categories" USING btree ("organization_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_links_org_portal_id_key" ON "portal_links" USING btree ("organization_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_localized_overrides_locale_unique" ON "portal_localized_overrides" USING btree ("organization_id","portal_id","locale");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_pending_content_changes_source_unique" ON "portal_pending_content_changes" USING btree ("organization_id","portal_id","change_kind","change_key","source_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_activations_portal_sequence_unique" ON "portal_publication_activations" USING btree ("organization_id","portal_id","activation_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_activations_one_current_per_portal" ON "portal_publication_activations" USING btree ("organization_id","portal_id") WHERE "portal_publication_activations"."deactivated_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_portal_version_unique" ON "portal_publication_snapshots" USING btree ("organization_id","portal_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_tenant_scope_id_key" ON "portal_publication_snapshots" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_evidence_binding_key" ON "portal_publication_snapshots" USING btree ("organization_id","property_id","portal_id","id","version","configuration_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_publication_snapshots_contact_evidence_binding_key" ON "portal_publication_snapshots" USING btree ("organization_id","property_id","portal_id","id","version","configuration_digest","contact_request_enabled","contact_notice_id","contact_notice_version","contact_notice_digest","contact_notice_locale","contact_request_purpose","contact_retention_policy_version");
--> statement-breakpoint
CREATE UNIQUE INDEX "prm_unique_active_manager" ON "portal_responsible_managers" USING btree ("organization_id","portal_id","user_id") WHERE effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_identifier_unique" ON "portal_tokens" USING btree ("token_identifier");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_hash_unique" ON "portal_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_portal_version_unique" ON "portal_tokens" USING btree ("organization_id","portal_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_tokens_scope_id_key" ON "portal_tokens" USING btree ("organization_id","property_id","portal_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_upload_issuances_object_key_unique" ON "portal_upload_issuances" USING btree ("object_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_upload_issuances_one_processing_per_portal" ON "portal_upload_issuances" USING btree ("organization_id","portal_id","purpose") WHERE state = 'consumed';
--> statement-breakpoint
CREATE UNIQUE INDEX "portals_org_property_slug_unique" ON "portals" USING btree ("organization_id","property_id","slug") WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "portals_org_id_key" ON "portals" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "portals_org_property_id_key" ON "portals" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "property_portal_brand_contents_locale_unique" ON "property_portal_brand_contents" USING btree ("organization_id","property_id","locale");
--> statement-breakpoint
CREATE UNIQUE INDEX "property_portal_brand_profiles_property_unique" ON "property_portal_brand_profiles" USING btree ("organization_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "property_portal_brand_profiles_scope_id_key" ON "property_portal_brand_profiles" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "properties_org_id_key" ON "properties" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "properties_org_slug_unique" ON "properties" USING btree ("organization_id","slug") WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "properties_org_gbp_location_id_unique" ON "properties" USING btree ("organization_id","gbp_location_id") WHERE gbp_location_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "property_rm_unique_active_manager" ON "property_responsible_managers" USING btree ("organization_id","property_id","user_id") WHERE effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_runs_generation_unique" ON "recovery_runs" USING btree ("generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_runs_source_unique" ON "recovery_runs" USING btree ("source_manifest_sha256","restore_point_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_lifecycle_recovery_approval_unique" ON "review_lifecycle_recovery_executions" USING btree ("approval_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_lifecycle_recovery_bundle_unique" ON "review_lifecycle_recovery_executions" USING btree ("approval_bundle_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_lifecycle_recovery_generation_unique" ON "review_lifecycle_recovery_executions" USING btree ("recovery_generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_revision_key" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","observation_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_head_binding_unique" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","id","observation_revision","source_epoch","material_review_revision","state","provenance");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_confirmation_binding_unique" ON "google_reply_observations" USING btree ("organization_id","property_id","review_id","observation_revision","matched_reply_id","matched_publication_cycle","matched_attempt_number","source_epoch","material_review_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "google_reply_observations_idempotency_key" ON "google_reply_observations" USING btree ("organization_id","review_id","observation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "material_review_revisions_exact_binding_unique" ON "material_review_revisions" USING btree ("organization_id","property_id","review_id","source_epoch","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "replies_review_source_unique" ON "replies" USING btree ("review_id","source","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "replies_attempt_binding_unique" ON "replies" USING btree ("organization_id","review_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "replies_origin_operation_unique" ON "replies" USING btree ("origin_operation_id") WHERE origin_operation_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_attempts_cycle_attempt_key" ON "reply_publication_attempts" USING btree ("reply_id","publication_cycle","attempt_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_attempts_observation_binding_unique" ON "reply_publication_attempts" USING btree ("organization_id","property_id","review_id","reply_id","publication_cycle","attempt_number","source_epoch","material_review_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_attempts_operation_key" ON "reply_publication_attempts" USING btree ("organization_id","provider_operation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "reply_publication_authorizations_attempt_binding_unique" ON "reply_publication_authorizations" USING btree ("organization_id","property_id","review_id","reply_id","publication_cycle","source_epoch","material_review_revision","reply_state_revision","normalization_version","expected_reply_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_google_reputation_snapshot_event_unique" ON "review_google_reputation_snapshot_facts" USING btree ("event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_provider_snapshot_one_active_idx" ON "review_provider_snapshot_runs" USING btree ("organization_id","property_id","source_epoch") WHERE "review_provider_snapshot_runs"."state" IN ('scanning', 'confirming', 'deleting');
--> statement-breakpoint
CREATE UNIQUE INDEX "review_provider_subject_one_active_idx" ON "review_provider_subject_hmac_key_versions" USING btree ("state") WHERE "review_provider_subject_hmac_key_versions"."state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "review_provider_subjects_review_unique" ON "review_provider_subjects" USING btree ("organization_id","property_id","source_epoch","review_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_source_contents_provider_identity_unique" ON "review_source_contents" USING btree ("platform","external_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_source_observations_key_unique" ON "review_source_observations" USING btree ("review_id","source_epoch","observation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_platform_external_unique" ON "reviews" USING btree ("platform","external_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_tenant_identity_unique" ON "reviews" USING btree ("organization_id","property_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_org_id_key" ON "reviews" USING btree ("organization_id","id");
--> statement-breakpoint
ALTER TABLE "ai_execution_control_heads" ADD CONSTRAINT "ai_execution_control_heads_transition_fk" FOREIGN KEY ("control_id","generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_global_control_fk" FOREIGN KEY ("global_control_id","global_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_provider_control_fk" FOREIGN KEY ("provider_control_id","provider_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_capability_control_fk" FOREIGN KEY ("capability_control_id","capability_control_generation") REFERENCES "public"."ai_execution_control_transitions"("control_id","generation") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_analysis_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") REFERENCES "public"."ai_review_analyses"("organization_id","property_id","review_id","source_epoch","source_revision","analysis_sequence") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_heads" ADD CONSTRAINT "ai_property_aggregate_heads_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_processing_profiles" ADD CONSTRAINT "ai_property_profiles_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_schedule_id_ai_property_trend_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."ai_property_trend_schedules"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_trend_outcomes" ADD CONSTRAINT "ai_property_trend_outcomes_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_property_trend_schedules" ADD CONSTRAINT "ai_property_trend_schedules_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_review_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_material_review_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","source_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments" ADD CONSTRAINT "ai_review_analysis_enrollments_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_review_analysis_enrollments" ADD CONSTRAINT "ai_review_analysis_enrollments_authorization_fk" FOREIGN KEY ("authorization_lineage_id","authorization_state_version","organization_id","property_id") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id","state_version","organization_id","property_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beta_feedback_triage" ADD CONSTRAINT "beta_feedback_triage_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beta_feedback_triage_transitions" ADD CONSTRAINT "beta_feedback_triage_transitions_feedback_reference_beta_feedback_triage_reference_fk" FOREIGN KEY ("feedback_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "beta_feedback_triage_transitions" ADD CONSTRAINT "beta_feedback_triage_transition_duplicate_reference_fk" FOREIGN KEY ("duplicate_of_reference") REFERENCES "public"."beta_feedback_triage"("reference") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD CONSTRAINT "goal_monthly_results_assignment_fk" FOREIGN KEY ("organization_id","property_id","program_id","program_version_id","assignment_id") REFERENCES "public"."goal_subject_assignments"("organization_id","property_id","program_id","program_version_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_program_versions" ADD CONSTRAINT "goal_program_versions_program_fk" FOREIGN KEY ("organization_id","property_id","program_id") REFERENCES "public"."goal_programs"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_programs" ADD CONSTRAINT "goal_programs_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_result_revisions" ADD CONSTRAINT "goal_result_revisions_supersedes_revision_id_goal_result_revisions_id_fk" FOREIGN KEY ("supersedes_revision_id") REFERENCES "public"."goal_result_revisions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_result_revisions" ADD CONSTRAINT "goal_result_revisions_result_fk" FOREIGN KEY ("organization_id","property_id","monthly_result_id") REFERENCES "public"."goal_monthly_results"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_version_fk" FOREIGN KEY ("organization_id","property_id","program_id","program_version_id","metric_key") REFERENCES "public"."goal_program_versions"("organization_id","property_id","program_id","id","metric_key") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_property_subject_fk" FOREIGN KEY ("organization_id","property_subject_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_portal_group_fk" FOREIGN KEY ("organization_id","property_id","portal_group_id") REFERENCES "public"."portal_groups"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_subject_assignments" ADD CONSTRAINT "goal_subject_assignments_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_import_discovery_records" ADD CONSTRAINT "google_import_discovery_records_connection_tenant_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."google_connections"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_import_discovery_records" ADD CONSTRAINT "google_import_discovery_records_property_tenant_fk" FOREIGN KEY ("organization_id","affected_property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_parent_tenant_fk" FOREIGN KEY ("organization_id","import_job_id") REFERENCES "public"."gbp_import_requests"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_connection_tenant_fk" FOREIGN KEY ("organization_id","connection_id") REFERENCES "public"."google_connections"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gbp_import_request_items" ADD CONSTRAINT "gbp_import_request_items_property_tenant_fk" FOREIGN KEY ("organization_id","existing_property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gbp_import_requests" ADD CONSTRAINT "gbp_import_requests_saga_tenant_fk" FOREIGN KEY ("organization_id","saga_id") REFERENCES "public"."gbp_import_sagas"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credential_revoke_permits" ADD CONSTRAINT "credential_revoke_permits_guard_id_google_subject_authority_guards_id_fk" FOREIGN KEY ("guard_id") REFERENCES "public"."google_subject_authority_guards"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credential_revoke_permits" ADD CONSTRAINT "credential_revoke_permits_source_operation_id_google_credential_source_operations_id_fk" FOREIGN KEY ("source_operation_id") REFERENCES "public"."google_credential_source_operations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credential_revoke_permits" ADD CONSTRAINT "credential_revoke_permits_cleanup_work_permit_id_authorization_execution_permits_id_fk" FOREIGN KEY ("cleanup_work_permit_id") REFERENCES "public"."authorization_execution_permits"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_credential_source_operations" ADD CONSTRAINT "google_credential_source_operations_guard_id_google_subject_authority_guards_id_fk" FOREIGN KEY ("guard_id") REFERENCES "public"."google_subject_authority_guards"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_credential_source_operations" ADD CONSTRAINT "google_credential_source_operations_source_work_permit_id_authorization_execution_permits_id_fk" FOREIGN KEY ("source_work_permit_id") REFERENCES "public"."authorization_execution_permits"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_contact_request_reveal_audits" ADD CONSTRAINT "guest_contact_reveal_audits_request_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","contact_request_id") REFERENCES "public"."guest_contact_requests"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_response_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","response_id") REFERENCES "public"."guest_responses"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_portal_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_contact_requests" ADD CONSTRAINT "guest_contact_requests_publication_evidence_fk" FOREIGN KEY ("organization_id","property_id","portal_id","publication_snapshot_id","publication_version","publication_digest","contact_request_enabled","notice_id","notice_version","notice_digest","notice_locale","purpose","retention_policy_version") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id","version","configuration_digest","contact_request_enabled","contact_notice_id","contact_notice_version","contact_notice_digest","contact_notice_locale","contact_request_purpose","contact_retention_policy_version") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_network_pressure_records" ADD CONSTRAINT "guest_network_pressure_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_participant_scope_fk" FOREIGN KEY ("organization_id","property_id","attributed_staff_participation_id","attributed_staff_participant_id") REFERENCES "public"."staff_participations"("organization_id","property_id","id","staff_participant_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_responsibility_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","attribution_responsibility_id","attributed_staff_participation_id") REFERENCES "public"."portal_responsibilities"("organization_id","property_id","portal_id","id","staff_participation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_group_fk" FOREIGN KEY ("organization_id","property_id","portal_group_id") REFERENCES "public"."portal_groups"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_qualified_scans" ADD CONSTRAINT "guest_qualified_scans_artifact_fk" FOREIGN KEY ("organization_id","property_id","portal_id","access_artifact_id") REFERENCES "public"."portal_access_artifacts"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD CONSTRAINT "guest_response_experience_snapshots_response_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","response_id") REFERENCES "public"."guest_responses"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_experience_snapshots" ADD CONSTRAINT "guest_response_experience_snapshots_publication_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","publication_snapshot_id","publication_version","publication_digest") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id","version","configuration_digest") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_integrity_decisions" ADD CONSTRAINT "guest_response_integrity_decisions_response_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","response_id") REFERENCES "public"."guest_responses"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_private_feedback" ADD CONSTRAINT "guest_response_private_feedback_response_tenant_fk" FOREIGN KEY ("organization_id","response_id") REFERENCES "public"."guest_responses"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_private_feedback" ADD CONSTRAINT "guest_response_private_feedback_response_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","response_id") REFERENCES "public"."guest_responses"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_session_bindings" ADD CONSTRAINT "guest_response_session_bindings_response_tenant_fk" FOREIGN KEY ("organization_id","response_id") REFERENCES "public"."guest_responses"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_response_session_bindings" ADD CONSTRAINT "guest_response_session_bindings_response_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","response_id") REFERENCES "public"."guest_responses"("organization_id","property_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_participant_scope_fk" FOREIGN KEY ("organization_id","property_id","attributed_staff_participation_id","attributed_staff_participant_id") REFERENCES "public"."staff_participations"("organization_id","property_id","id","staff_participant_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_responsibility_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","attribution_responsibility_id","attributed_staff_participation_id") REFERENCES "public"."portal_responsibilities"("organization_id","property_id","portal_id","id","staff_participation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "guest_responses" ADD CONSTRAINT "guest_responses_portal_property_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_assignment_history" ADD CONSTRAINT "inbox_assignment_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_escalation_history" ADD CONSTRAINT "inbox_escalation_history_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes" ADD CONSTRAINT "inbox_feedback_handling_outcomes_cycle_scope_fk" FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","source_type","feedback_id","source_revision") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes" ADD CONSTRAINT "inbox_feedback_handling_outcomes_completion_transition_fk" FOREIGN KEY ("inbox_item_id","completion_state_revision") REFERENCES "public"."inbox_handling_cycle_transitions"("inbox_item_id","state_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_feedback_handling_outcomes" ADD CONSTRAINT "inbox_feedback_handling_outcomes_supersedes_fk" FOREIGN KEY ("inbox_item_id","cycle_number","supersedes_outcome_id","supersedes_outcome_revision") REFERENCES "public"."inbox_feedback_handling_outcomes"("inbox_item_id","cycle_number","id","outcome_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_current_cycle_fk" FOREIGN KEY ("inbox_item_id","current_cycle_number") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_material_revision_fk" FOREIGN KEY ("review_id","current_material_review_revision") REFERENCES "public"."material_review_revisions"("review_id","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_heads" ADD CONSTRAINT "inbox_handling_cycle_heads_source_scope_fk" FOREIGN KEY ("inbox_item_id","organization_id","source_type","source_id") REFERENCES "public"."inbox_items"("id","organization_id","source_type","source_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_response_targets" ADD CONSTRAINT "inbox_handling_cycle_response_targets_cycle_scope_fk" FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number","organization_id","property_id","source_type","source_id","source_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_transitions" ADD CONSTRAINT "inbox_handling_cycle_transitions_cycle_fk" FOREIGN KEY ("inbox_item_id","cycle_number") REFERENCES "public"."inbox_handling_cycles"("inbox_item_id","cycle_number") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycle_transitions" ADD CONSTRAINT "inbox_handling_cycle_transitions_source_scope_fk" FOREIGN KEY ("inbox_item_id","organization_id","source_type","source_id") REFERENCES "public"."inbox_items"("id","organization_id","source_type","source_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_material_revision_fk" FOREIGN KEY ("review_id","material_review_revision") REFERENCES "public"."material_review_revisions"("review_id","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_handling_cycles" ADD CONSTRAINT "inbox_handling_cycles_source_scope_fk" FOREIGN KEY ("inbox_item_id","organization_id","source_type","source_id") REFERENCES "public"."inbox_items"("id","organization_id","source_type","source_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_notes" ADD CONSTRAINT "inbox_notes_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "public"."inbox_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_private_feedback_target_property_overrides" ADD CONSTRAINT "inbox_private_feedback_target_property_overrides_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_response_target_reminders" ADD CONSTRAINT "inbox_response_target_reminders_target_scope_fk" FOREIGN KEY ("inbox_item_id","cycle_number","organization_id","property_id","target_kind") REFERENCES "public"."inbox_handling_cycle_response_targets"("inbox_item_id","cycle_number","organization_id","property_id","target_kind") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_export_retrieval_issuances" ADD CONSTRAINT "organization_export_retrieval_issuances_export_id_organization_exports_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."organization_exports"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "backup_erasure_hold_releases" ADD CONSTRAINT "backup_erasure_hold_releases_ledger_entry_id_backup_erasure_ledger_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."backup_erasure_ledger"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_erase_context_receipts" ADD CONSTRAINT "property_erase_context_receipts_authority_id_property_erase_authorities_id_fk" FOREIGN KEY ("authority_id") REFERENCES "public"."property_erase_authorities"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_request_transitions" ADD CONSTRAINT "privacy_request_transitions_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_corrections" ADD CONSTRAINT "metric_corrections_reading_id_metric_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."metric_readings"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_corrections" ADD CONSTRAINT "metric_corrections_supersedes_correction_id_metric_corrections_id_fk" FOREIGN KEY ("supersedes_correction_id") REFERENCES "public"."metric_corrections"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_current_google_reputation_snapshots" ADD CONSTRAINT "metric_current_google_reputation_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_group_id_portal_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."portal_groups"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_staff_participant_scope_fk" FOREIGN KEY ("organization_id","property_id","attributed_staff_participation_id","attributed_staff_participant_id") REFERENCES "public"."staff_participations"("organization_id","property_id","id","staff_participant_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_staff_responsibility_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","attribution_responsibility_id","attributed_staff_participation_id") REFERENCES "public"."portal_responsibilities"("organization_id","property_id","portal_id","id","staff_participation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_metric_lifetime_aggregates" ADD CONSTRAINT "portal_metric_lifetime_portal_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_digest_batch_members" ADD CONSTRAINT "notification_digest_batch_members_batch_tenant_fk" FOREIGN KEY ("batch_id","organization_id","user_id") REFERENCES "public"."notification_digest_batches"("id","organization_id","user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_digest_batch_members" ADD CONSTRAINT "notification_digest_batch_members_email_tenant_fk" FOREIGN KEY ("notification_email_id","organization_id","user_id") REFERENCES "public"."notification_email_queue"("id","organization_id","user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_email_queue" ADD CONSTRAINT "notification_email_queue_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_consumer_receipts" ADD CONSTRAINT "event_consumer_receipts_event_id_outbox_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_recovery_fence_run_id_recovery_runs_id_fk" FOREIGN KEY ("recovery_fence_run_id") REFERENCES "public"."recovery_runs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_group_memberships" ADD CONSTRAINT "portal_group_memberships_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_group_memberships" ADD CONSTRAINT "portal_group_memberships_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_group_memberships" ADD CONSTRAINT "portal_group_memberships_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "portal_responsibilities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "portal_responsibilities_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "portal_responsibilities_staff_participation_id_staff_participations_id_fk" FOREIGN KEY ("staff_participation_id") REFERENCES "public"."staff_participations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "pr_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_responsibilities" ADD CONSTRAINT "pr_participation_tenant_fk" FOREIGN KEY ("organization_id","property_id","staff_participation_id") REFERENCES "public"."staff_participations"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_access_grants" ADD CONSTRAINT "property_access_grants_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_access_grants" ADD CONSTRAINT "pag_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "staff_participations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_participations" ADD CONSTRAINT "sp_participant_tenant_fk" FOREIGN KEY ("organization_id","staff_participant_id") REFERENCES "public"."staff_participants"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_user_links" ADD CONSTRAINT "staff_user_links_participant_tenant_fk" FOREIGN KEY ("organization_id","staff_participant_id") REFERENCES "public"."staff_participants"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "policy_consent" ADD CONSTRAINT "policy_consent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_access_grant" ADD CONSTRAINT "property_access_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_access_grant" ADD CONSTRAINT "property_access_grant_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_review_head_fk" FOREIGN KEY ("organization_id","property_id","authorized_source_epoch") REFERENCES "public"."review_ai_analysis_heads"("organization_id","property_id","source_epoch") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_evidence_head_fk" FOREIGN KEY ("authorization_lineage_id","state_version") REFERENCES "public"."merchant_ai_consent_evidence"("authorization_lineage_id","state_version") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_review_head_fk" FOREIGN KEY ("organization_id","property_id","authorized_source_epoch") REFERENCES "public"."review_ai_analysis_heads"("organization_id","property_id","source_epoch") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_access_artifacts" ADD CONSTRAINT "portal_access_artifacts_token_scope_fk" FOREIGN KEY ("organization_id","property_id","portal_id","portal_token_id") REFERENCES "public"."portal_tokens"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_access_artifacts" ADD CONSTRAINT "portal_access_artifacts_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_approved_destinations" ADD CONSTRAINT "portal_approved_destinations_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_group_members" ADD CONSTRAINT "portal_group_members_portal_group_id_portal_groups_id_fk" FOREIGN KEY ("portal_group_id") REFERENCES "public"."portal_groups"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_group_members" ADD CONSTRAINT "portal_group_members_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_groups" ADD CONSTRAINT "portal_groups_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_groups" ADD CONSTRAINT "portal_groups_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_health_intervals" ADD CONSTRAINT "portal_health_intervals_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_link_categories" ADD CONSTRAINT "portal_link_categories_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_link_categories" ADD CONSTRAINT "portal_link_categories_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_category_id_portal_link_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."portal_link_categories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_portal_id_portals_id_fk" FOREIGN KEY ("portal_id") REFERENCES "public"."portals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_category_tenant_fk" FOREIGN KEY ("organization_id","portal_id","category_id") REFERENCES "public"."portal_link_categories"("organization_id","portal_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_destination_tenant_fk" FOREIGN KEY ("organization_id","property_id","destination_id") REFERENCES "public"."portal_approved_destinations"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_links" ADD CONSTRAINT "portal_links_property_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_localized_overrides" ADD CONSTRAINT "portal_localized_overrides_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_pending_content_changes" ADD CONSTRAINT "portal_pending_content_changes_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_pending_content_changes" ADD CONSTRAINT "portal_pending_content_changes_snapshot_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id","resolved_snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_publication_activations" ADD CONSTRAINT "portal_publication_activations_snapshot_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id","snapshot_id") REFERENCES "public"."portal_publication_snapshots"("organization_id","property_id","portal_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_responsible_managers" ADD CONSTRAINT "prm_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_portal_tenant_fk" FOREIGN KEY ("organization_id","portal_id") REFERENCES "public"."portals"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_tokens" ADD CONSTRAINT "portal_tokens_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portal_upload_issuances" ADD CONSTRAINT "portal_upload_issuances_portal_tenant_fk" FOREIGN KEY ("organization_id","property_id","portal_id") REFERENCES "public"."portals"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" ADD CONSTRAINT "property_portal_brand_contents_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_portal_brand_profiles" ADD CONSTRAINT "property_portal_brand_profiles_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "property_responsible_managers" ADD CONSTRAINT "property_rm_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_reply_observation_heads" ADD CONSTRAINT "google_reply_observation_heads_exact_observation_fk" FOREIGN KEY ("organization_id","property_id","review_id","observation_id","observation_revision","source_epoch","material_review_revision","state","provenance") REFERENCES "public"."google_reply_observations"("organization_id","property_id","review_id","id","observation_revision","source_epoch","material_review_revision","state","provenance") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_reply_observations" ADD CONSTRAINT "google_reply_observations_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_reply_observations" ADD CONSTRAINT "google_reply_observations_material_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "google_reply_observations" ADD CONSTRAINT "google_reply_observations_matched_attempt_fk" FOREIGN KEY ("organization_id","property_id","review_id","matched_reply_id","matched_publication_cycle","matched_attempt_number","source_epoch","material_review_revision") REFERENCES "public"."reply_publication_attempts"("organization_id","property_id","review_id","reply_id","publication_cycle","attempt_number","source_epoch","material_review_revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "material_review_revisions" ADD CONSTRAINT "material_review_revisions_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_review_tenant_fk" FOREIGN KEY ("organization_id","review_id") REFERENCES "public"."reviews"("organization_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_reply_binding_fk" FOREIGN KEY ("organization_id","review_id","reply_id") REFERENCES "public"."replies"("organization_id","review_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_material_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_authorization_fk" FOREIGN KEY ("organization_id","property_id","review_id","reply_id","publication_cycle","source_epoch","material_review_revision","reply_state_revision","normalization_version","expected_reply_digest") REFERENCES "public"."reply_publication_authorizations"("organization_id","property_id","review_id","reply_id","publication_cycle","source_epoch","material_review_revision","reply_state_revision","normalization_version","expected_reply_digest") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_attempts" ADD CONSTRAINT "reply_publication_attempts_exact_confirmation_fk" FOREIGN KEY ("organization_id","property_id","review_id","confirmed_observation_revision","reply_id","publication_cycle","attempt_number","source_epoch","material_review_revision") REFERENCES "public"."google_reply_observations"("organization_id","property_id","review_id","observation_revision","matched_reply_id","matched_publication_cycle","matched_attempt_number","source_epoch","material_review_revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations" ADD CONSTRAINT "reply_publication_authorizations_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations" ADD CONSTRAINT "reply_publication_authorizations_reply_binding_fk" FOREIGN KEY ("organization_id","review_id","reply_id") REFERENCES "public"."replies"("organization_id","review_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reply_publication_authorizations" ADD CONSTRAINT "reply_publication_authorizations_material_revision_fk" FOREIGN KEY ("organization_id","property_id","review_id","source_epoch","material_review_revision") REFERENCES "public"."material_review_revisions"("organization_id","property_id","review_id","source_epoch","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_ai_analysis_heads" ADD CONSTRAINT "review_ai_analysis_heads_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_google_reputation_snapshot_facts" ADD CONSTRAINT "review_google_reputation_snapshot_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_provider_deletion_candidates" ADD CONSTRAINT "review_provider_deletion_candidates_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."review_provider_snapshot_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_provider_snapshot_members" ADD CONSTRAINT "review_provider_snapshot_members_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."review_provider_snapshot_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_provider_snapshot_runs" ADD CONSTRAINT "review_provider_snapshot_runs_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_provider_subjects" ADD CONSTRAINT "review_provider_subjects_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_provider_subjects" ADD CONSTRAINT "review_provider_subjects_key_version_fk" FOREIGN KEY ("key_version") REFERENCES "public"."review_provider_subject_hmac_key_versions"("key_version") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_provider_subjects" ADD CONSTRAINT "review_provider_subjects_last_seen_run_fk" FOREIGN KEY ("last_seen_snapshot_run_id") REFERENCES "public"."review_provider_snapshot_runs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_source_contents" ADD CONSTRAINT "review_source_contents_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_source_contents" ADD CONSTRAINT "review_source_contents_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_source_observations" ADD CONSTRAINT "review_source_observations_review_tenant_fk" FOREIGN KEY ("organization_id","property_id","review_id") REFERENCES "public"."reviews"("organization_id","property_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_source_observations" ADD CONSTRAINT "review_source_observations_material_revision_fk" FOREIGN KEY ("review_id","material_revision") REFERENCES "public"."material_review_revisions"("review_id","revision") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_google_connection_id_google_connections_id_fk" FOREIGN KEY ("google_connection_id") REFERENCES "public"."google_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;