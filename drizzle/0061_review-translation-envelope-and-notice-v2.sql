ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_branch_valid";--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" DROP CONSTRAINT "ai_property_aggregate_contributions_values_valid";--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_heads" DROP CONSTRAINT "ai_property_aggregate_heads_versions_valid";--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" DROP CONSTRAINT "ai_property_daily_aggregates_versions_valid";--> statement-breakpoint
ALTER TABLE "ai_property_processing_profiles" DROP CONSTRAINT "ai_property_profiles_versions_valid";--> statement-breakpoint
ALTER TABLE "ai_property_trend_schedules" DROP CONSTRAINT "ai_property_trend_schedules_versions_valid";--> statement-breakpoint
ALTER TABLE "ai_review_analyses" DROP CONSTRAINT "ai_review_analyses_versions_valid";--> statement-breakpoint
ALTER TABLE "ai_review_event_cursors" DROP CONSTRAINT "ai_review_event_cursors_sequences_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_versions_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_contract_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_versions_valid";--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_contract_valid";--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_ai_provenance_valid";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "translated_text" text;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_branch_valid" CHECK ((
        ("ai_operations"."command" = 'analysis' AND "ai_operations"."capability" = 'review_analysis' AND "ai_operations"."organization_id" IS NOT NULL AND "ai_operations"."property_id" IS NOT NULL AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'review_event_consumer' AND "ai_operations"."review_id" IS NOT NULL AND "ai_operations"."origin_event_id" IS NOT NULL AND "ai_operations"."subject_hmac" ~ '^[0-9a-f]{64}$' AND "ai_operations"."subject_hmac_key_version" IS NOT NULL AND "ai_operations"."source_epoch" >= 0 AND "ai_operations"."source_revision" >= 1 AND "ai_operations"."analysis_sequence" >= 1 AND "ai_operations"."operation_profile_version" = 'review-analysis-v1' AND "ai_operations"."capability_runtime_profile_version" = 'review-analysis-runtime-v1')
        OR ("ai_operations"."command" = 'reply' AND "ai_operations"."capability" = 'reply_drafting' AND "ai_operations"."organization_id" IS NOT NULL AND "ai_operations"."property_id" IS NOT NULL AND "ai_operations"."actor_user_id" IS NOT NULL AND "ai_operations"."system_principal" IS NULL AND "ai_operations"."review_id" IS NOT NULL AND "ai_operations"."source_epoch" >= 0 AND "ai_operations"."source_revision" >= 1 AND "ai_operations"."tone" IN ('professional', 'friendly', 'casual') AND "ai_operations"."base_reply_state_revision" >= 0 AND "ai_operations"."operation_profile_version" = 'reply-suggestion-v1' AND "ai_operations"."capability_runtime_profile_version" = 'reply-drafting-runtime-v1')
        OR ("ai_operations"."command" = 'trend' AND "ai_operations"."capability" = 'property_trends' AND "ai_operations"."organization_id" IS NOT NULL AND "ai_operations"."property_id" IS NOT NULL AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'property_trend_coordinator' AND "ai_operations"."source_epoch" >= 0 AND "ai_operations"."due_local_date" IS NOT NULL AND "ai_operations"."terminal_analysis_sequence" >= 0 AND "ai_operations"."aggregate_revision" >= 0 AND "ai_operations"."operation_profile_version" = 'property-trend-v1' AND "ai_operations"."capability_runtime_profile_version" = 'property-trends-runtime-v1')
        OR ("ai_operations"."command" = 'synthetic_canary' AND "ai_operations"."capability" IS NULL AND "ai_operations"."organization_id" IS NULL AND "ai_operations"."property_id" IS NULL AND "ai_operations"."actor_user_id" IS NULL AND "ai_operations"."system_principal" = 'release_canary' AND "ai_operations"."release_sha" ~ '^[0-9a-f]{40}$' AND "ai_operations"."canary_authorization_id" IS NOT NULL AND "ai_operations"."canary_authorization_generation" BETWEEN 1 AND 3 AND "ai_operations"."canary_profile_version" IS NOT NULL AND "ai_operations"."operation_profile_version" = 'synthetic-canary-v1' AND "ai_operations"."capability_runtime_profile_version" IS NULL)
      ));--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_contributions" ADD CONSTRAINT "ai_property_aggregate_contributions_values_valid" CHECK ("ai_property_aggregate_contributions"."source_epoch" >= 0 AND "ai_property_aggregate_contributions"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contributions"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_property_aggregate_contributions"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_contributions"."property_profile_version" >= 1 AND "ai_property_aggregate_contributions"."rating" BETWEEN 1 AND 5 AND "ai_property_aggregate_contributions"."applied_aggregate_revision" BETWEEN 1 AND '9007199254740991'::bigint);--> statement-breakpoint
ALTER TABLE "ai_property_aggregate_heads" ADD CONSTRAINT "ai_property_aggregate_heads_versions_valid" CHECK ("ai_property_aggregate_heads"."source_epoch" >= 0 AND "ai_property_aggregate_heads"."review_analysis_epoch" >= 1 AND "ai_property_aggregate_heads"."property_profile_version" >= 1 AND "ai_property_aggregate_heads"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_aggregate_heads"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint);--> statement-breakpoint
ALTER TABLE "ai_property_daily_aggregates" ADD CONSTRAINT "ai_property_daily_aggregates_versions_valid" CHECK ("ai_property_daily_aggregates"."source_epoch" >= 0 AND "ai_property_daily_aggregates"."review_analysis_epoch" >= 1 AND "ai_property_daily_aggregates"."property_profile_version" >= 1 AND "ai_property_daily_aggregates"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint AND "ai_property_daily_aggregates"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint);--> statement-breakpoint
ALTER TABLE "ai_property_processing_profiles" ADD CONSTRAINT "ai_property_profiles_versions_valid" CHECK ("ai_property_processing_profiles"."source_epoch" >= 0 AND "ai_property_processing_profiles"."profile_version" >= 1);--> statement-breakpoint
ALTER TABLE "ai_property_trend_schedules" ADD CONSTRAINT "ai_property_trend_schedules_versions_valid" CHECK ("ai_property_trend_schedules"."source_epoch" >= 0 AND "ai_property_trend_schedules"."review_analysis_epoch" >= 1 AND "ai_property_trend_schedules"."property_trends_epoch" >= 1
        AND "ai_property_trend_schedules"."property_profile_version" >= 1 AND "ai_property_trend_schedules"."terminal_analysis_sequence" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."scheduler_generation" BETWEEN 1 AND '9007199254740991'::bigint
        AND "ai_property_trend_schedules"."timezone" ~ '^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$');--> statement-breakpoint
ALTER TABLE "ai_review_analyses" ADD CONSTRAINT "ai_review_analyses_versions_valid" CHECK ("ai_review_analyses"."source_epoch" >= 0 AND "ai_review_analyses"."source_revision" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analyses"."analysis_sequence" BETWEEN 1 AND '9007199254740991'::bigint AND "ai_review_analyses"."review_analysis_epoch" >= 1 AND "ai_review_analyses"."property_profile_version" >= 1);--> statement-breakpoint
ALTER TABLE "ai_review_event_cursors" ADD CONSTRAINT "ai_review_event_cursors_sequences_valid" CHECK ("ai_review_event_cursors"."source_epoch" >= 0 AND "ai_review_event_cursors"."review_analysis_epoch" >= 1
        AND "ai_review_event_cursors"."analysis_start_sequence" BETWEEN 0 AND '9007199254740991'::bigint
        AND "ai_review_event_cursors"."consumed_sequence" BETWEEN "ai_review_event_cursors"."analysis_start_sequence" AND '9007199254740991'::bigint
        AND "ai_review_event_cursors"."terminal_analysis_sequence" BETWEEN "ai_review_event_cursors"."analysis_start_sequence" AND "ai_review_event_cursors"."consumed_sequence"
        AND "ai_review_event_cursors"."aggregate_revision" BETWEEN 0 AND '9007199254740991'::bigint);--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_versions_valid" CHECK ("merchant_ai_consent_evidence"."state_version" >= 1 AND "merchant_ai_consent_evidence"."review_analysis_epoch" >= 1 AND "merchant_ai_consent_evidence"."reply_drafting_epoch" >= 1 AND "merchant_ai_consent_evidence"."property_trends_epoch" >= 1 AND "merchant_ai_consent_evidence"."authorized_source_epoch" >= 0 AND "merchant_ai_consent_evidence"."analysis_start_sequence" >= 0 AND "merchant_ai_consent_evidence"."routing_policy_version" >= 1);--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_contract_valid" CHECK ((
          ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_consent_evidence"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_consent_evidence"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
        )
        AND "merchant_ai_consent_evidence"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_consent_evidence"."routing_policy_version" = 1
        AND "merchant_ai_consent_evidence"."redaction_profile_family" = 'gbp-review-global-v1');--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_versions_valid" CHECK ("merchant_ai_enablement"."state_version" >= 1 AND "merchant_ai_enablement"."review_analysis_epoch" >= 1 AND "merchant_ai_enablement"."reply_drafting_epoch" >= 1 AND "merchant_ai_enablement"."property_trends_epoch" >= 1 AND "merchant_ai_enablement"."authorized_source_epoch" >= 0 AND "merchant_ai_enablement"."analysis_start_sequence" >= 0 AND "merchant_ai_enablement"."routing_policy_version" >= 1);--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_contract_valid" CHECK ((
          ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-15.v1'
            AND "merchant_ai_enablement"."notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b')
          OR ("merchant_ai_enablement"."notice_version" = 'merchant-ai-notice-2026-08-19.v1'
            AND "merchant_ai_enablement"."notice_digest" = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31')
        )
        AND "merchant_ai_enablement"."source_policy_id" = 'google-business-profile-source-policy-v1'
        AND "merchant_ai_enablement"."routing_policy_version" = 1
        AND "merchant_ai_enablement"."redaction_profile_family" = 'gbp-review-global-v1');--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_ai_provenance_valid" CHECK ((
        (
          "replies"."authorship" = 'ai_assisted'
          AND "replies"."origin_operation_id" IS NOT NULL
          AND "replies"."origin_source_epoch" >= 0
          AND "replies"."origin_source_revision" >= 1
          AND "replies"."origin_base_reply_state_revision" BETWEEN 0 AND '9007199254740991'::bigint
          AND "replies"."origin_reply_drafting_epoch" >= 1
          AND "replies"."origin_property_profile_version" >= 1
          AND "replies"."origin_ai_profile_version" = 'reply-suggestion-v1'
          AND "replies"."origin_reply_template_id" IN (
            'appreciation_positive',
            'appreciation_neutral',
            'recovery_service',
            'acknowledge_concern'
          )
          AND "replies"."origin_reply_template_catalogue_version" = 'gbp-reply-template-catalogue-v1'
          AND "replies"."origin_reply_template_catalogue_digest" = 'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'
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
      ));