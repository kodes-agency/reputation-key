CREATE TABLE "ai_control_heads" (
	"scope_key" varchar(150) PRIMARY KEY NOT NULL,
	"scope_kind" varchar(40) NOT NULL,
	"scope_value" varchar(100),
	"control_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" varchar(20) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_control_heads_generation_valid" CHECK ("ai_control_heads"."generation" >= 1),
	CONSTRAINT "ai_control_heads_scope_valid" CHECK ((
        ("ai_control_heads"."scope_kind" = 'global' AND "ai_control_heads"."scope_key" = 'global' AND "ai_control_heads"."scope_value" IS NULL)
        OR ("ai_control_heads"."scope_kind" = 'provider_deployment_profile' AND "ai_control_heads"."scope_key" = 'provider:private-beta-global-v1' AND "ai_control_heads"."scope_value" = 'private-beta-global-v1')
        OR ("ai_control_heads"."scope_kind" = 'capability' AND "ai_control_heads"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_control_heads"."scope_key" = 'capability:' || "ai_control_heads"."scope_value")
      )),
	CONSTRAINT "ai_control_heads_state_valid" CHECK ("ai_control_heads"."state" IN ('running', 'draining', 'killed'))
);
--> statement-breakpoint
CREATE TABLE "ai_control_history" (
	"control_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"scope_key" varchar(150) NOT NULL,
	"scope_kind" varchar(40) NOT NULL,
	"scope_value" varchar(100),
	"state" varchar(20) NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"actor_user_id" varchar(255),
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_control_history_pk" PRIMARY KEY("control_id","generation"),
	CONSTRAINT "ai_control_history_generation_valid" CHECK ("ai_control_history"."generation" >= 1),
	CONSTRAINT "ai_control_history_scope_valid" CHECK ((
        ("ai_control_history"."scope_kind" = 'global' AND "ai_control_history"."scope_key" = 'global' AND "ai_control_history"."scope_value" IS NULL)
        OR ("ai_control_history"."scope_kind" = 'provider_deployment_profile' AND "ai_control_history"."scope_key" = 'provider:private-beta-global-v1' AND "ai_control_history"."scope_value" = 'private-beta-global-v1')
        OR ("ai_control_history"."scope_kind" = 'capability' AND "ai_control_history"."scope_value" IN ('review_analysis', 'reply_drafting', 'property_trends') AND "ai_control_history"."scope_key" = 'capability:' || "ai_control_history"."scope_value")
      )),
	CONSTRAINT "ai_control_history_state_valid" CHECK ("ai_control_history"."state" IN ('running', 'draining', 'killed')),
	CONSTRAINT "ai_control_history_reason_valid" CHECK ("ai_control_history"."reason_code" ~ '^[a-z][a-z0-9_]{2,63}$')
);
--> statement-breakpoint
CREATE TABLE "ai_execution_permit_settlements" (
	"permit_id" uuid PRIMARY KEY NOT NULL,
	"terminal_state" varchar(20) NOT NULL,
	"settled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_execution_permit_settlements_state_valid" CHECK ("ai_execution_permit_settlements"."terminal_state" IN ('completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "ai_execution_permits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operation_id" uuid NOT NULL,
	"execution_attempt" integer NOT NULL,
	"global_control_id" uuid NOT NULL,
	"global_control_generation" integer NOT NULL,
	"provider_control_id" uuid NOT NULL,
	"provider_control_generation" integer NOT NULL,
	"capability_control_id" uuid,
	"capability_control_generation" integer,
	"admitted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_execution_permits_valid" CHECK ("ai_execution_permits"."execution_attempt" >= 1 AND "ai_execution_permits"."global_control_generation" >= 1 AND "ai_execution_permits"."provider_control_generation" >= 1 AND COALESCE("ai_execution_permits"."capability_control_generation", 1) >= 1 AND "ai_execution_permits"."expires_at" > "ai_execution_permits"."admitted_at")
);
--> statement-breakpoint
CREATE TABLE "ai_operation_attempts" (
	"operation_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"state" varchar(32) NOT NULL,
	"failure_code" varchar(64),
	"started_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "ai_operation_attempts_pk" PRIMARY KEY("operation_id","attempt"),
	CONSTRAINT "ai_operation_attempts_number_valid" CHECK ("ai_operation_attempts"."attempt" >= 1),
	CONSTRAINT "ai_operation_attempts_state_valid" CHECK ("ai_operation_attempts"."state" IN ('executing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ai_operation_attempts_terminal_valid" CHECK ((("ai_operation_attempts"."state" = 'executing' AND "ai_operation_attempts"."settled_at" IS NULL AND "ai_operation_attempts"."failure_code" IS NULL) OR ("ai_operation_attempts"."state" <> 'executing' AND "ai_operation_attempts"."settled_at" IS NOT NULL)) AND ("ai_operation_attempts"."settled_at" IS NULL OR "ai_operation_attempts"."settled_at" >= "ai_operation_attempts"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "ai_operation_profiles" (
	"profile_version" varchar(100) PRIMARY KEY NOT NULL,
	"command" varchar(32) NOT NULL,
	"capability" varchar(40),
	"purpose" varchar(40) NOT NULL,
	"source_route" varchar(80) NOT NULL,
	"gateway_path" varchar(80) NOT NULL,
	"caller_role" varchar(40) NOT NULL,
	"capability_runtime_profile_version" varchar(100),
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"output_schema_name" varchar(100) NOT NULL,
	"output_schema_digest" varchar(64) NOT NULL,
	"prompt_digest" varchar(64) NOT NULL,
	"artifact_attestations" jsonb NOT NULL,
	"artifact_attestations_digest" varchar(64) NOT NULL,
	"sdk_request_shape_digest" varchar(64) NOT NULL,
	"static_token_bearing_bytes" integer NOT NULL,
	"static_token_bearing_digest" varchar(64) NOT NULL,
	"source_byte_limit" integer NOT NULL,
	"provider_payload_byte_limit" integer NOT NULL,
	"prepared_request_byte_limit" integer NOT NULL,
	"response_byte_limit" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"reasoning_effort" varchar(16) NOT NULL,
	"provider_deadline_ms" integer NOT NULL,
	"request_deadline_ms" integer NOT NULL,
	"execution_lease_ms" integer NOT NULL,
	"profile_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_operation_profiles_branch_valid" CHECK ((
        ("ai_operation_profiles"."command" = 'analysis' AND "ai_operation_profiles"."capability" = 'review_analysis' AND "ai_operation_profiles"."profile_version" = 'review-analysis-v1' AND "ai_operation_profiles"."purpose" = 'ai.analyze' AND "ai_operation_profiles"."source_route" = 'review-analysis' AND "ai_operation_profiles"."gateway_path" = '/v1/review-analysis' AND "ai_operation_profiles"."caller_role" = 'worker' AND "ai_operation_profiles"."capability_runtime_profile_version" = 'review-analysis-runtime-v1')
        OR ("ai_operation_profiles"."command" = 'reply' AND "ai_operation_profiles"."capability" = 'reply_drafting' AND "ai_operation_profiles"."profile_version" = 'reply-suggestion-v1' AND "ai_operation_profiles"."purpose" = 'ai.generate_reply' AND "ai_operation_profiles"."source_route" = 'reply-suggestion' AND "ai_operation_profiles"."gateway_path" = '/v1/reply-suggestion' AND "ai_operation_profiles"."caller_role" = 'web' AND "ai_operation_profiles"."capability_runtime_profile_version" = 'reply-drafting-runtime-v1')
        OR ("ai_operation_profiles"."command" = 'trend' AND "ai_operation_profiles"."capability" = 'property_trends' AND "ai_operation_profiles"."profile_version" = 'property-trend-v1' AND "ai_operation_profiles"."purpose" = 'ai.detect_trends' AND "ai_operation_profiles"."source_route" = 'property-trend' AND "ai_operation_profiles"."gateway_path" = '/v1/property-trend' AND "ai_operation_profiles"."caller_role" = 'worker' AND "ai_operation_profiles"."capability_runtime_profile_version" = 'property-trends-runtime-v1')
        OR ("ai_operation_profiles"."command" = 'synthetic_canary' AND "ai_operation_profiles"."capability" IS NULL AND "ai_operation_profiles"."profile_version" = 'synthetic-canary-v1' AND "ai_operation_profiles"."purpose" = 'ai.synthetic_canary' AND "ai_operation_profiles"."source_route" = 'synthetic-canary' AND "ai_operation_profiles"."gateway_path" = 'internal:synthetic-canary' AND "ai_operation_profiles"."caller_role" = 'release_canary' AND "ai_operation_profiles"."capability_runtime_profile_version" IS NULL)
      )),
	CONSTRAINT "ai_operation_profiles_digests_valid" CHECK ("ai_operation_profiles"."output_schema_digest" ~ '^[0-9a-f]{64}$' AND "ai_operation_profiles"."prompt_digest" ~ '^[0-9a-f]{64}$' AND "ai_operation_profiles"."artifact_attestations_digest" ~ '^[0-9a-f]{64}$' AND "ai_operation_profiles"."sdk_request_shape_digest" ~ '^[0-9a-f]{64}$' AND "ai_operation_profiles"."static_token_bearing_digest" ~ '^[0-9a-f]{64}$' AND "ai_operation_profiles"."profile_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_operation_profiles_limits_valid" CHECK ("ai_operation_profiles"."max_output_tokens" BETWEEN 1 AND 8192
        AND "ai_operation_profiles"."source_byte_limit" BETWEEN 1 AND 65536
        AND "ai_operation_profiles"."provider_payload_byte_limit" BETWEEN 1 AND 65536
        AND "ai_operation_profiles"."prepared_request_byte_limit" BETWEEN 1 AND 131072
        AND "ai_operation_profiles"."response_byte_limit" = 131072
        AND "ai_operation_profiles"."static_token_bearing_bytes" BETWEEN 1 AND "ai_operation_profiles"."prepared_request_byte_limit"
        AND "ai_operation_profiles"."provider_deadline_ms" IN (60000, 90000)
        AND "ai_operation_profiles"."request_deadline_ms" = "ai_operation_profiles"."provider_deadline_ms" + 10000
        AND "ai_operation_profiles"."execution_lease_ms" BETWEEN "ai_operation_profiles"."request_deadline_ms" AND 300000),
	CONSTRAINT "ai_operation_profiles_reasoning_effort_valid" CHECK ("ai_operation_profiles"."reasoning_effort" IN ('none', 'low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "ai_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_scope" varchar(255) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"command" varchar(32) NOT NULL,
	"capability" varchar(40),
	"organization_id" varchar(255),
	"property_id" uuid,
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
	"release_sha" varchar(40),
	"canary_authorization_id" uuid,
	"canary_authorization_generation" integer,
	"canary_profile_version" varchar(100),
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
	"routing_policy_version" integer,
	"source_policy_id" varchar(150),
	"source_canonicalizer_digest" varchar(64),
	"redaction_profile_version" varchar(100),
	"output_leakage_profile_version" varchar(100),
	"output_leakage_profile_digest" varchar(64),
	"reply_template_catalogue_version" varchar(100),
	"reply_template_catalogue_digest" varchar(64),
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"operation_profile_version" varchar(100) NOT NULL,
	"capability_runtime_profile_version" varchar(100),
	"global_control_id" uuid NOT NULL,
	"global_control_generation" integer NOT NULL,
	"provider_control_id" uuid NOT NULL,
	"provider_control_generation" integer NOT NULL,
	"capability_control_id" uuid,
	"capability_control_generation" integer,
	"capability_fences" jsonb,
	"state" varchar(40) NOT NULL,
	"execution_attempt" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"failure_code" varchar(64),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "ai_operations_fingerprint_valid" CHECK ("ai_operations"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_operations_state_valid" CHECK ("ai_operations"."state" IN ('pending', 'executing', 'succeeded_pending_delivery', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_operations_attempt_valid" CHECK ("ai_operations"."execution_attempt" >= 0 AND "ai_operations"."expires_at" > "ai_operations"."created_at" AND "ai_operations"."updated_at" >= "ai_operations"."created_at" AND ("ai_operations"."next_attempt_at" IS NULL OR "ai_operations"."next_attempt_at" >= "ai_operations"."updated_at")),
	CONSTRAINT "ai_operations_safe_integers" CHECK (COALESCE("ai_operations"."source_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."reviewed_at_epoch_millis", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."analysis_sequence", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."base_reply_state_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."terminal_analysis_sequence", 0) BETWEEN 0 AND '9007199254740991'::bigint
        AND COALESCE("ai_operations"."aggregate_revision", 0) BETWEEN 0 AND '9007199254740991'::bigint),
	CONSTRAINT "ai_operations_branch_valid" CHECK ((
        ("ai_operations"."command" = 'analysis' AND "ai_operations"."capability" = 'review_analysis' AND "ai_operations"."organization_id" IS NOT NULL AND "ai_operations"."property_id" IS NOT NULL AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'review_event_consumer' AND "ai_operations"."review_id" IS NOT NULL AND "ai_operations"."origin_event_id" IS NOT NULL AND "ai_operations"."subject_hmac" ~ '^[0-9a-f]{64}$' AND "ai_operations"."subject_hmac_key_version" IS NOT NULL AND "ai_operations"."source_epoch" >= 1 AND "ai_operations"."source_revision" >= 1 AND "ai_operations"."analysis_sequence" >= 1 AND "ai_operations"."operation_profile_version" = 'review-analysis-v1' AND "ai_operations"."capability_runtime_profile_version" = 'review-analysis-runtime-v1')
        OR ("ai_operations"."command" = 'reply' AND "ai_operations"."capability" = 'reply_drafting' AND "ai_operations"."organization_id" IS NOT NULL AND "ai_operations"."property_id" IS NOT NULL AND "ai_operations"."actor_user_id" IS NOT NULL AND "ai_operations"."system_principal" IS NULL AND "ai_operations"."review_id" IS NOT NULL AND "ai_operations"."source_epoch" >= 1 AND "ai_operations"."source_revision" >= 1 AND "ai_operations"."tone" IN ('professional', 'friendly', 'casual') AND "ai_operations"."base_reply_state_revision" >= 0 AND "ai_operations"."operation_profile_version" = 'reply-suggestion-v1' AND "ai_operations"."capability_runtime_profile_version" = 'reply-drafting-runtime-v1')
        OR ("ai_operations"."command" = 'trend' AND "ai_operations"."capability" = 'property_trends' AND "ai_operations"."organization_id" IS NOT NULL AND "ai_operations"."property_id" IS NOT NULL AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'property_trend_coordinator' AND "ai_operations"."source_epoch" >= 1 AND "ai_operations"."due_local_date" IS NOT NULL AND "ai_operations"."terminal_analysis_sequence" >= 0 AND "ai_operations"."aggregate_revision" >= 0 AND "ai_operations"."operation_profile_version" = 'property-trend-v1' AND "ai_operations"."capability_runtime_profile_version" = 'property-trends-runtime-v1')
        OR ("ai_operations"."command" = 'synthetic_canary' AND "ai_operations"."capability" IS NULL AND "ai_operations"."organization_id" IS NULL AND "ai_operations"."property_id" IS NULL AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'release_canary' AND "ai_operations"."release_sha" ~ '^[0-9a-f]{40}$' AND "ai_operations"."canary_authorization_id" IS NOT NULL AND "ai_operations"."canary_authorization_generation" BETWEEN 1 AND 3 AND "ai_operations"."canary_profile_version" IS NOT NULL AND "ai_operations"."operation_profile_version" = 'synthetic-canary-v1' AND "ai_operations"."capability_runtime_profile_version" IS NULL)
      )),
	CONSTRAINT "ai_operations_control_fence_valid" CHECK ("ai_operations"."global_control_generation" >= 1
        AND "ai_operations"."provider_control_generation" >= 1
        AND (
          (
            "ai_operations"."command" = 'synthetic_canary'
            AND "ai_operations"."capability_control_id" IS NULL
            AND "ai_operations"."capability_control_generation" IS NULL
            AND jsonb_typeof("ai_operations"."capability_fences") = 'array'
            AND jsonb_array_length("ai_operations"."capability_fences") = 3
          )
          OR (
            "ai_operations"."command" <> 'synthetic_canary'
            AND "ai_operations"."capability_control_id" IS NOT NULL
            AND "ai_operations"."capability_control_generation" >= 1
            AND jsonb_typeof("ai_operations"."capability_fences") = 'object'
            AND (
              ("ai_operations"."command" = 'analysis' AND jsonb_array_length(jsonb_path_query_array("ai_operations"."capability_fences", '$.keyvalue()'::jsonpath)) = 2 AND "ai_operations"."capability_fences"->>'capability' = 'review_analysis' AND ("ai_operations"."capability_fences"->>'reviewAnalysisEpoch') ~ '^[1-9][0-9]*$')
              OR ("ai_operations"."command" = 'reply' AND jsonb_array_length(jsonb_path_query_array("ai_operations"."capability_fences", '$.keyvalue()'::jsonpath)) = 3 AND "ai_operations"."capability_fences"->>'capability' = 'reply_drafting' AND ("ai_operations"."capability_fences"->>'replyDraftingEpoch') ~ '^[1-9][0-9]*$' AND ("ai_operations"."capability_fences"->>'baseReplyStateRevision') ~ '^(0|[1-9][0-9]*)$')
              OR ("ai_operations"."command" = 'trend' AND jsonb_array_length(jsonb_path_query_array("ai_operations"."capability_fences", '$.keyvalue()'::jsonpath)) = 3 AND "ai_operations"."capability_fences"->>'capability' = 'property_trends' AND ("ai_operations"."capability_fences"->>'reviewAnalysisEpoch') ~ '^[1-9][0-9]*$' AND ("ai_operations"."capability_fences"->>'propertyTrendsEpoch') ~ '^[1-9][0-9]*$')
            )
          )
        ))
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
	CONSTRAINT "ai_property_profiles_versions_valid" CHECK ("ai_property_processing_profiles"."source_epoch" >= 1 AND "ai_property_processing_profiles"."profile_version" >= 1),
	CONSTRAINT "ai_property_profiles_lifecycle_valid" CHECK ("ai_property_processing_profiles"."lifecycle_state" IN ('active', 'deleting'))
);
--> statement-breakpoint
CREATE TABLE "ai_provider_deployment_profiles" (
	"profile_version" varchar(100) PRIMARY KEY NOT NULL,
	"region" varchar(20) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"model_snapshot" varchar(100) NOT NULL,
	"reasoning_effort" varchar(20) NOT NULL,
	"service_tier" varchar(20) NOT NULL,
	"store" boolean NOT NULL,
	"response_api_version" varchar(40) NOT NULL,
	"deployment_contract" jsonb NOT NULL,
	"profile_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_provider_profiles_version_valid" CHECK ("ai_provider_deployment_profiles"."profile_version" = 'private-beta-global-v1'),
	CONSTRAINT "ai_provider_profiles_region_valid" CHECK ("ai_provider_deployment_profiles"."region" = 'global'),
	CONSTRAINT "ai_provider_profiles_provider_valid" CHECK ("ai_provider_deployment_profiles"."provider" = 'openai'),
	CONSTRAINT "ai_provider_profiles_model_valid" CHECK ("ai_provider_deployment_profiles"."model_snapshot" = 'gpt-5.6-luna'),
	CONSTRAINT "ai_provider_profiles_reasoning_valid" CHECK ("ai_provider_deployment_profiles"."reasoning_effort" = 'route-profile-effort'),
	CONSTRAINT "ai_provider_profiles_tier_valid" CHECK ("ai_provider_deployment_profiles"."service_tier" = 'default'),
	CONSTRAINT "ai_provider_profiles_store_false" CHECK ("ai_provider_deployment_profiles"."store" = false),
	CONSTRAINT "ai_provider_profiles_api_valid" CHECK ("ai_provider_deployment_profiles"."response_api_version" = 'responses-v1'),
	CONSTRAINT "ai_provider_profiles_contract_valid" CHECK (jsonb_typeof("ai_provider_deployment_profiles"."deployment_contract") = 'object'
        AND "ai_provider_deployment_profiles"."deployment_contract" = '{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"24h","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","evidence":{"retrievalDate":"2026-08-19","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.6-luna","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"pricing":{"catalogueId":"openai-gpt-5.6-luna-standard-2026-08-19","modelSnapshot":"gpt-5.6-luna","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":200000,"cachedInputMicros":20000,"outputMicros":1200000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-19"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}}'::jsonb),
	CONSTRAINT "ai_provider_profiles_digest_valid" CHECK ("ai_provider_deployment_profiles"."profile_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ai_routing_policies" (
	"version" integer PRIMARY KEY NOT NULL,
	"region" varchar(20) NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"policy_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_routing_policies_version_valid" CHECK ("ai_routing_policies"."version" = 1),
	CONSTRAINT "ai_routing_policies_region_valid" CHECK ("ai_routing_policies"."region" = 'global'),
	CONSTRAINT "ai_routing_policies_digest_valid" CHECK ("ai_routing_policies"."policy_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ai_runtime_capability_profiles" (
	"runtime_profile_version" varchar(100) PRIMARY KEY NOT NULL,
	"capability" varchar(40) NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"source_route" varchar(80) NOT NULL,
	"gateway_path" varchar(80) NOT NULL,
	"gateway_profile_version" varchar(100) NOT NULL,
	"caller" varchar(20) NOT NULL,
	"operation_profile_version" varchar(100) NOT NULL,
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"notice_version" varchar(100) NOT NULL,
	"notice_digest" varchar(64) NOT NULL,
	"catalogue_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_runtime_capability_profiles_branch_valid" CHECK ((
        ("ai_runtime_capability_profiles"."capability" = 'review_analysis' AND "ai_runtime_capability_profiles"."runtime_profile_version" = 'review-analysis-runtime-v1' AND "ai_runtime_capability_profiles"."purpose" = 'ai.analyze' AND "ai_runtime_capability_profiles"."source_route" = 'review-analysis' AND "ai_runtime_capability_profiles"."gateway_path" = '/v1/review-analysis' AND "ai_runtime_capability_profiles"."gateway_profile_version" = 'review-analysis-gateway-v1' AND "ai_runtime_capability_profiles"."caller" = 'worker' AND "ai_runtime_capability_profiles"."operation_profile_version" = 'review-analysis-v1')
        OR ("ai_runtime_capability_profiles"."capability" = 'reply_drafting' AND "ai_runtime_capability_profiles"."runtime_profile_version" = 'reply-drafting-runtime-v1' AND "ai_runtime_capability_profiles"."purpose" = 'ai.generate_reply' AND "ai_runtime_capability_profiles"."source_route" = 'reply-suggestion' AND "ai_runtime_capability_profiles"."gateway_path" = '/v1/reply-suggestion' AND "ai_runtime_capability_profiles"."gateway_profile_version" = 'reply-suggestion-gateway-v1' AND "ai_runtime_capability_profiles"."caller" = 'web' AND "ai_runtime_capability_profiles"."operation_profile_version" = 'reply-suggestion-v1')
        OR ("ai_runtime_capability_profiles"."capability" = 'property_trends' AND "ai_runtime_capability_profiles"."runtime_profile_version" = 'property-trends-runtime-v1' AND "ai_runtime_capability_profiles"."purpose" = 'ai.detect_trends' AND "ai_runtime_capability_profiles"."source_route" = 'property-trend' AND "ai_runtime_capability_profiles"."gateway_path" = '/v1/property-trend' AND "ai_runtime_capability_profiles"."gateway_profile_version" = 'property-trend-gateway-v1' AND "ai_runtime_capability_profiles"."caller" = 'worker' AND "ai_runtime_capability_profiles"."operation_profile_version" = 'property-trend-v1')
      )),
	CONSTRAINT "ai_runtime_capability_profiles_provider_valid" CHECK ("ai_runtime_capability_profiles"."provider_deployment_profile_version" = 'private-beta-global-v1'),
	CONSTRAINT "ai_runtime_capability_profiles_digests_valid" CHECK ("ai_runtime_capability_profiles"."notice_digest" ~ '^[0-9a-f]{64}$' AND "ai_runtime_capability_profiles"."catalogue_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "ai_provider_deployment_capabilities" (
	"provider_deployment_profile_version" varchar(100) NOT NULL,
	"capability" varchar(40) NOT NULL,
	"runtime_profile_version" varchar(100) NOT NULL,
	"catalogue_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_provider_deployment_capabilities_pk" PRIMARY KEY("provider_deployment_profile_version","capability"),
	CONSTRAINT "ai_provider_deployment_capabilities_provider_valid" CHECK ("ai_provider_deployment_capabilities"."provider_deployment_profile_version" = 'private-beta-global-v1'),
	CONSTRAINT "ai_provider_deployment_capabilities_digest_valid" CHECK ("ai_provider_deployment_capabilities"."catalogue_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "ai_control_heads" ADD CONSTRAINT "ai_control_heads_history_fk" FOREIGN KEY ("control_id","generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permit_settlements" ADD CONSTRAINT "ai_execution_permit_settlements_permit_id_ai_execution_permits_id_fk" FOREIGN KEY ("permit_id") REFERENCES "public"."ai_execution_permits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_attempt_fk" FOREIGN KEY ("operation_id","execution_attempt") REFERENCES "public"."ai_operation_attempts"("operation_id","attempt") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_global_control_fk" FOREIGN KEY ("global_control_id","global_control_generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_provider_control_fk" FOREIGN KEY ("provider_control_id","provider_control_generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_permits" ADD CONSTRAINT "ai_execution_permits_capability_control_fk" FOREIGN KEY ("capability_control_id","capability_control_generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation_attempts" ADD CONSTRAINT "ai_operation_attempts_operation_id_ai_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."ai_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" ADD CONSTRAINT "ai_operation_profiles_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_operation_profile_version_ai_operation_profiles_profile_version_fk" FOREIGN KEY ("operation_profile_version") REFERENCES "public"."ai_operation_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_global_control_fk" FOREIGN KEY ("global_control_id","global_control_generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_provider_control_fk" FOREIGN KEY ("provider_control_id","provider_control_generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_capability_control_fk" FOREIGN KEY ("capability_control_id","capability_control_generation") REFERENCES "public"."ai_control_history"("control_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_processing_profiles" ADD CONSTRAINT "ai_property_processing_profiles_routing_policy_version_ai_routing_policies_version_fk" FOREIGN KEY ("routing_policy_version") REFERENCES "public"."ai_routing_policies"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_processing_profiles" ADD CONSTRAINT "ai_property_processing_profiles_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_property_processing_profiles" ADD CONSTRAINT "ai_property_profiles_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_routing_policies" ADD CONSTRAINT "ai_routing_policies_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runtime_capability_profiles_complete_unique" ON "ai_runtime_capability_profiles" USING btree ("provider_deployment_profile_version","capability","runtime_profile_version");--> statement-breakpoint
ALTER TABLE "ai_runtime_capability_profiles" ADD CONSTRAINT "ai_runtime_capability_profiles_operation_profile_version_ai_operation_profiles_profile_version_fk" FOREIGN KEY ("operation_profile_version") REFERENCES "public"."ai_operation_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runtime_capability_profiles" ADD CONSTRAINT "ai_runtime_capability_profiles_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_capabilities" ADD CONSTRAINT "ai_provider_deployment_capabilities_provider_deployment_profile_version_ai_provider_deployment_profiles_profile_version_fk" FOREIGN KEY ("provider_deployment_profile_version") REFERENCES "public"."ai_provider_deployment_profiles"("profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_capabilities" ADD CONSTRAINT "ai_provider_deployment_capabilities_runtime_fk" FOREIGN KEY ("provider_deployment_profile_version","capability","runtime_profile_version") REFERENCES "public"."ai_runtime_capability_profiles"("provider_deployment_profile_version","capability","runtime_profile_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_control_heads_control_unique" ON "ai_control_heads" USING btree ("control_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_control_history_scope_generation_unique" ON "ai_control_history" USING btree ("scope_key","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_permits_operation_attempt_unique" ON "ai_execution_permits" USING btree ("operation_id","execution_attempt");--> statement-breakpoint
CREATE INDEX "ai_execution_permits_expiry_idx" ON "ai_execution_permits" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operations_idempotency_unique" ON "ai_operations" USING btree ("idempotency_scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_operations_due_idx" ON "ai_operations" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ai_operations_property_idx" ON "ai_operations" USING btree ("organization_id","property_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_operations_expiry_idx" ON "ai_operations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_property_profiles_org_idx" ON "ai_property_processing_profiles" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
INSERT INTO "ai_provider_deployment_profiles" ("profile_version","region","provider","model_snapshot","reasoning_effort","service_tier","store","response_api_version","deployment_contract","profile_digest","created_at") VALUES
('private-beta-global-v1','global','openai','gpt-5.6-luna','route-profile-effort','default',false,'responses-v1','{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"24h","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","evidence":{"retrievalDate":"2026-08-19","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.6-luna","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"pricing":{"catalogueId":"openai-gpt-5.6-luna-standard-2026-08-19","modelSnapshot":"gpt-5.6-luna","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":200000,"cachedInputMicros":20000,"outputMicros":1200000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-19"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}}'::jsonb,'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90','2026-08-16T00:00:00Z');--> statement-breakpoint
INSERT INTO "ai_routing_policies" ("version","region","provider_deployment_profile_version","policy_digest","created_at") VALUES
(1,'global','private-beta-global-v1','8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66','2026-08-16T00:00:00Z');--> statement-breakpoint
INSERT INTO "ai_operation_profiles" ("profile_version","command","capability","purpose","source_route","gateway_path","caller_role","capability_runtime_profile_version","provider_deployment_profile_version","output_schema_name","output_schema_digest","prompt_digest","artifact_attestations","artifact_attestations_digest","sdk_request_shape_digest","static_token_bearing_bytes","static_token_bearing_digest","source_byte_limit","provider_payload_byte_limit","prepared_request_byte_limit","response_byte_limit","max_output_tokens","reasoning_effort","provider_deadline_ms","request_deadline_ms","execution_lease_ms","profile_digest","created_at") VALUES
('review-analysis-v1','analysis','review_analysis','ai.analyze','review-analysis','/v1/review-analysis','worker','review-analysis-runtime-v1','private-beta-global-v1','review_analysis_v1','6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a','df34437016d742e69ebfce7376b8c32601e24198c74f95ad02ea0f0c7a17863e','{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"}'::jsonb,'1fc168bae40d57907ffd1fa4a92f36a87db79f9f1d70e831682b3fab1082ac25','69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',1253,'f4920f0c542d1eef653599d6dbfcd03759a7f8b5580032b23000db2e9ed8f0bf',16384,16384,65536,131072,1024,'low',60000,70000,120000,'13c6d338f96dd04f44a1e03edce8d290f20f34dea8a2f9fbf6f4ee9b03312d22','2026-08-16T00:00:00Z'),
('reply-suggestion-v1','reply','reply_drafting','ai.generate_reply','reply-suggestion','/v1/reply-suggestion','web','reply-drafting-runtime-v1','private-beta-global-v1','reply_template_selection_v1','d123646236e874e901bdd6706f98a3e607fe5f27d41318190efed543d27ba0cc','1d7c999abbf0185c22673b071a080c5afcae28ea1ede09f7208fce51ca3b805d','{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"3ed39117b80bfd90afa9b18a30f9c7406ce99bf709f32f5edb08829001c5a509","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}}'::jsonb,'5a58659a96b62a552eb8e28f19a418b4fa2a9a441739b1dbb97b790ffd8894e3','69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',1373,'b6a12b09410e85c35ede1fa73a64338904b9e87e2c565dd1da8e9c9534cd40f4',16384,16384,65536,131072,1024,'low',60000,70000,120000,'add2a398f82b55404f77c3995c38473f81f29f9f7800e17f0e735946b2acb0ba','2026-08-16T00:00:00Z'),
('property-trend-v1','trend','property_trends','ai.detect_trends','property-trend','/v1/property-trend','worker','property-trends-runtime-v1','private-beta-global-v1','property_trend_v1','f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776','30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64','{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}}'::jsonb,'93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078','69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',890,'980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601',65536,65536,131072,131072,2048,'low',90000,100000,150000,'501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72','2026-08-16T00:00:00Z'),
('synthetic-canary-v1','synthetic_canary',NULL,'ai.synthetic_canary','synthetic-canary','internal:synthetic-canary','release_canary',NULL,'private-beta-global-v1','synthetic_canary_v1','9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7','28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a','{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}}'::jsonb,'e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097','69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd',419,'11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4',16384,16384,65536,131072,512,'low',60000,70000,120000,'71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7','2026-08-16T00:00:00Z');--> statement-breakpoint
INSERT INTO "ai_runtime_capability_profiles" ("runtime_profile_version","capability","purpose","source_route","gateway_path","gateway_profile_version","caller","operation_profile_version","provider_deployment_profile_version","notice_version","notice_digest","catalogue_digest","created_at") VALUES
('review-analysis-runtime-v1','review_analysis','ai.analyze','review-analysis','/v1/review-analysis','review-analysis-gateway-v1','worker','review-analysis-v1','private-beta-global-v1','merchant-ai-notice-2026-08-19.v1','f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31','191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298','2026-08-16T00:00:00Z'),
('reply-drafting-runtime-v1','reply_drafting','ai.generate_reply','reply-suggestion','/v1/reply-suggestion','reply-suggestion-gateway-v1','web','reply-suggestion-v1','private-beta-global-v1','merchant-ai-notice-2026-08-19.v1','f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31','191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298','2026-08-16T00:00:00Z'),
('property-trends-runtime-v1','property_trends','ai.detect_trends','property-trend','/v1/property-trend','property-trend-gateway-v1','worker','property-trend-v1','private-beta-global-v1','merchant-ai-notice-2026-08-19.v1','f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31','191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298','2026-08-16T00:00:00Z');--> statement-breakpoint
INSERT INTO "ai_provider_deployment_capabilities" ("provider_deployment_profile_version","capability","runtime_profile_version","catalogue_digest","created_at") VALUES
('private-beta-global-v1','review_analysis','review-analysis-runtime-v1','191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298','2026-08-16T00:00:00Z'),
('private-beta-global-v1','reply_drafting','reply-drafting-runtime-v1','191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298','2026-08-16T00:00:00Z'),
('private-beta-global-v1','property_trends','property-trends-runtime-v1','191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298','2026-08-16T00:00:00Z');--> statement-breakpoint
INSERT INTO "ai_control_history" (
  "control_id", "generation", "scope_key", "scope_kind", "scope_value",
  "state", "reason_code", "actor_user_id", "occurred_at"
) VALUES
  ('00000000-0000-4000-8000-00000000a001', 1, 'global', 'global', NULL, 'running', 'migration_seed', NULL, '2026-08-16T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000a002', 1, 'provider:private-beta-global-v1', 'provider_deployment_profile', 'private-beta-global-v1', 'running', 'migration_seed', NULL, '2026-08-16T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000a003', 1, 'capability:property_trends', 'capability', 'property_trends', 'killed', 'migration_seed', NULL, '2026-08-16T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000a004', 1, 'capability:reply_drafting', 'capability', 'reply_drafting', 'killed', 'migration_seed', NULL, '2026-08-16T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000a005', 1, 'capability:review_analysis', 'capability', 'review_analysis', 'killed', 'migration_seed', NULL, '2026-08-16T00:00:00Z');--> statement-breakpoint
INSERT INTO "ai_control_heads" (
  "scope_key", "scope_kind", "scope_value", "control_id", "generation", "state", "updated_at"
) VALUES
  ('global', 'global', NULL, '00000000-0000-4000-8000-00000000a001', 1, 'running', '2026-08-16T00:00:00Z'),
  ('provider:private-beta-global-v1', 'provider_deployment_profile', 'private-beta-global-v1', '00000000-0000-4000-8000-00000000a002', 1, 'running', '2026-08-16T00:00:00Z'),
  ('capability:property_trends', 'capability', 'property_trends', '00000000-0000-4000-8000-00000000a003', 1, 'killed', '2026-08-16T00:00:00Z'),
  ('capability:reply_drafting', 'capability', 'reply_drafting', '00000000-0000-4000-8000-00000000a004', 1, 'killed', '2026-08-16T00:00:00Z'),
  ('capability:review_analysis', 'capability', 'review_analysis', '00000000-0000-4000-8000-00000000a005', 1, 'killed', '2026-08-16T00:00:00Z');--> statement-breakpoint
CREATE OR REPLACE FUNCTION "resolve_ai_runtime_capability_v1"(
  p_provider_deployment_profile_version text,
  p_capability text,
  p_catalogue_digest text
)
RETURNS TABLE (
  runtime_profile_version varchar,
  operation_profile_version varchar,
  gateway_profile_version varchar,
  notice_version varchar,
  notice_digest varchar,
  resolved_catalogue_digest varchar
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_provider_count integer;
  v_routing_count integer;
  v_operation_count integer;
  v_runtime_count integer;
  v_membership_count integer;
BEGIN
  SELECT count(*) INTO v_provider_count FROM public.ai_provider_deployment_profiles;
  SELECT count(*) INTO v_routing_count FROM public.ai_routing_policies;
  SELECT count(*) INTO v_operation_count FROM public.ai_operation_profiles;
  SELECT count(*) INTO v_runtime_count FROM public.ai_runtime_capability_profiles;
  SELECT count(*) INTO v_membership_count FROM public.ai_provider_deployment_capabilities;

  IF v_provider_count <> 1
    OR v_routing_count <> 1
    OR v_operation_count <> 4
    OR v_runtime_count <> 3
    OR v_membership_count <> 3
  THEN
    RAISE EXCEPTION 'AI runtime catalogue is incomplete'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    runtime_profile.runtime_profile_version,
    runtime_profile.operation_profile_version,
    runtime_profile.gateway_profile_version,
    runtime_profile.notice_version,
    runtime_profile.notice_digest,
    runtime_profile.catalogue_digest
  FROM public.ai_provider_deployment_capabilities AS membership
  INNER JOIN public.ai_runtime_capability_profiles AS runtime_profile
    ON runtime_profile.provider_deployment_profile_version = membership.provider_deployment_profile_version
   AND runtime_profile.capability = membership.capability
   AND runtime_profile.runtime_profile_version = membership.runtime_profile_version
  INNER JOIN public.ai_operation_profiles AS operation_profile
    ON operation_profile.profile_version = runtime_profile.operation_profile_version
   AND operation_profile.capability = runtime_profile.capability
   AND operation_profile.capability_runtime_profile_version = runtime_profile.runtime_profile_version
   AND operation_profile.provider_deployment_profile_version = runtime_profile.provider_deployment_profile_version
  INNER JOIN public.ai_provider_deployment_profiles AS provider_profile
    ON provider_profile.profile_version = runtime_profile.provider_deployment_profile_version
  INNER JOIN public.ai_routing_policies AS routing_policy
    ON routing_policy.provider_deployment_profile_version = provider_profile.profile_version
  WHERE membership.provider_deployment_profile_version = p_provider_deployment_profile_version
    AND membership.capability = p_capability
    AND membership.catalogue_digest = p_catalogue_digest
    AND runtime_profile.catalogue_digest = p_catalogue_digest;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AI runtime capability is unavailable'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_ai_runtime_capability_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_ai_capability_set_executable_v1"(
  p_capabilities text[],
  p_notice_version text,
  p_notice_digest text,
  p_provider_deployment_profile_version text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  canonical_capabilities text[];
  current_capability text;
  mapping record;
  result jsonb := '{}'::jsonb;
BEGIN
  IF p_notice_version <> 'merchant-ai-notice-2026-08-19.v1'
    OR p_notice_digest <> 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31'
    OR p_provider_deployment_profile_version <> 'private-beta-global-v1'
  THEN
    RAISE EXCEPTION 'merchant_ai_runtime_mapping_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(
    array_agg(catalogue.capability ORDER BY catalogue.ordinal),
    ARRAY[]::text[]
  )
  INTO canonical_capabilities
  FROM unnest(ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[])
    WITH ORDINALITY AS catalogue(capability, ordinal)
  WHERE catalogue.capability = ANY(coalesce(p_capabilities, ARRAY[]::text[]));

  IF cardinality(canonical_capabilities) = 0
    OR cardinality(canonical_capabilities) <> cardinality(p_capabilities)
    OR canonical_capabilities <> p_capabilities
    OR ('property_trends' = ANY(p_capabilities) AND NOT 'review_analysis' = ANY(p_capabilities))
  THEN
    RAISE EXCEPTION 'merchant_ai_invalid_capability_set' USING ERRCODE = 'P0001';
  END IF;

  FOREACH current_capability IN ARRAY canonical_capabilities
  LOOP
    SELECT *
    INTO STRICT mapping
    FROM public.resolve_ai_runtime_capability_v1(
      p_provider_deployment_profile_version,
      current_capability,
      '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
    );

    IF mapping.notice_version IS DISTINCT FROM p_notice_version
      OR mapping.notice_digest IS DISTINCT FROM p_notice_digest
      OR mapping.resolved_catalogue_digest IS DISTINCT FROM
        '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
    THEN
      RAISE EXCEPTION 'merchant_ai_runtime_mapping_unavailable'
        USING ERRCODE = 'P0001';
    END IF;

    result := result || jsonb_build_object(
      current_capability,
      mapping.runtime_profile_version
    );
  END LOOP;

  RETURN result;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_capability_set_executable_v1"(text[], text, text, text) FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "assert_ai_runtime_catalogue_ready_v1"(
  p_provider_deployment_profile_version text,
  p_provider_deployment_profile_digest text,
  p_runtime_capability_catalogue_digest text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    p_provider_deployment_profile_version = 'private-beta-global-v1'
    AND p_provider_deployment_profile_digest = 'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90'
    AND p_runtime_capability_catalogue_digest = '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_provider_deployment_profiles AS row_value) = '[{"profile_version":"private-beta-global-v1","region":"global","provider":"openai","model_snapshot":"gpt-5.6-luna","reasoning_effort":"route-profile-effort","service_tier":"default","store":false,"response_api_version":"responses-v1","deployment_contract":{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"24h","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","evidence":{"retrievalDate":"2026-08-19","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.6-luna","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"pricing":{"catalogueId":"openai-gpt-5.6-luna-standard-2026-08-19","modelSnapshot":"gpt-5.6-luna","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":200000,"cachedInputMicros":20000,"outputMicros":1200000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-19"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}},"profile_digest":"f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY version), '[]'::jsonb) FROM public.ai_routing_policies AS row_value) = '[{"version":1,"region":"global","provider_deployment_profile_version":"private-beta-global-v1","policy_digest":"8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_template_selection_v1","output_schema_digest":"d123646236e874e901bdd6706f98a3e607fe5f27d41318190efed543d27ba0cc","prompt_digest":"1d7c999abbf0185c22673b071a080c5afcae28ea1ede09f7208fce51ca3b805d","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"3ed39117b80bfd90afa9b18a30f9c7406ce99bf709f32f5edb08829001c5a509","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"5a58659a96b62a552eb8e28f19a418b4fa2a9a441739b1dbb97b790ffd8894e3","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1373,"static_token_bearing_digest":"b6a12b09410e85c35ede1fa73a64338904b9e87e2c565dd1da8e9c9534cd40f4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"add2a398f82b55404f77c3995c38473f81f29f9f7800e17f0e735946b2acb0ba"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"df34437016d742e69ebfce7376b8c32601e24198c74f95ad02ea0f0c7a17863e","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"1fc168bae40d57907ffd1fa4a92f36a87db79f9f1d70e831682b3fab1082ac25","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1253,"static_token_bearing_digest":"f4920f0c542d1eef653599d6dbfcd03759a7f8b5580032b23000db2e9ed8f0bf","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"13c6d338f96dd04f44a1e03edce8d290f20f34dea8a2f9fbf6f4ee9b03312d22"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":512,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY runtime_profile_version), '[]'::jsonb) FROM public.ai_runtime_capability_profiles AS row_value) = '[{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY capability), '[]'::jsonb) FROM public.ai_provider_deployment_capabilities AS row_value) = '[{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_runtime_catalogue_ready_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "reject_ai_catalogue_mutation_v1"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI catalogue and history rows are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_runtime_capability_profiles_immutable"
BEFORE UPDATE OR DELETE ON "ai_runtime_capability_profiles"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_runtime_capability_profiles_no_truncate"
BEFORE TRUNCATE ON "ai_runtime_capability_profiles"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_provider_deployment_capabilities_immutable"
BEFORE UPDATE OR DELETE ON "ai_provider_deployment_capabilities"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_provider_deployment_capabilities_no_truncate"
BEFORE TRUNCATE ON "ai_provider_deployment_capabilities"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_provider_profiles_immutable"
BEFORE UPDATE OR DELETE ON "ai_provider_deployment_profiles"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_routing_policies_immutable"
BEFORE UPDATE OR DELETE ON "ai_routing_policies"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_operation_profiles_immutable"
BEFORE UPDATE OR DELETE ON "ai_operation_profiles"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_control_history_immutable"
BEFORE UPDATE OR DELETE ON "ai_control_history"
FOR EACH ROW EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_provider_profiles_no_truncate"
BEFORE TRUNCATE ON "ai_provider_deployment_profiles"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_routing_policies_no_truncate"
BEFORE TRUNCATE ON "ai_routing_policies"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_operation_profiles_no_truncate"
BEFORE TRUNCATE ON "ai_operation_profiles"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();--> statement-breakpoint
CREATE TRIGGER "ai_control_history_no_truncate"
BEFORE TRUNCATE ON "ai_control_history"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_ai_catalogue_mutation_v1"();