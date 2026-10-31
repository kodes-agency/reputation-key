-- Reply drafting v2 contract, registered dark. No notice, grant or serving change.;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "reply_drafting_v2" jsonb;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "rewrite_parent_operation_id" uuid;
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_rewrite_parent_fk" FOREIGN KEY ("rewrite_parent_operation_id") REFERENCES "ai_operations"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_operations_one_rewrite_unique" ON "ai_operations" ("rewrite_parent_operation_id") WHERE "rewrite_parent_operation_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "reply_ai_frame_reservations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" varchar(255) NOT NULL, "property_id" uuid NOT NULL,
    "language_group" varchar(35) NOT NULL, "rating_band" varchar(30) NOT NULL,
    "voice_digest" varchar(64) NOT NULL, "generation_seed" varchar(64) NOT NULL,
    "choices" jsonb NOT NULL, "closing_order" integer[] NOT NULL,
    "adopted_at" timestamp with time zone, "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "reply_ai_frame_property_tenant_fk" FOREIGN KEY ("organization_id", "property_id") REFERENCES "properties"("organization_id", "id") ON DELETE cascade
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "reply_ai_frame_generation_unique" ON "reply_ai_frame_reservations" ("organization_id", "property_id", "language_group", "rating_band", "voice_digest", "generation_seed");
--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_reply_v2_valid" CHECK (((
      ("ai_operations"."operation_profile_version" <> 'reply-suggestion-v2' AND "ai_operations"."reply_drafting_v2" IS NULL AND "ai_operations"."rewrite_parent_operation_id" IS NULL)
      OR ("ai_operations"."operation_profile_version" = 'reply-suggestion-v2' AND "ai_operations"."reply_drafting_v2" IS NOT NULL
        AND jsonb_typeof("ai_operations"."reply_drafting_v2") = 'object'
        AND "ai_operations"."reply_drafting_v2" ?& ARRAY['options','voiceDigest','generationSeed','parentOperationId','rewriteOrdinal','rewriteIssues']
        AND ("ai_operations"."reply_drafting_v2" - ARRAY['options','voiceDigest','generationSeed','parentOperationId','rewriteOrdinal','rewriteIssues']) = '{}'::jsonb
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'options') = 'object'
        AND ("ai_operations"."reply_drafting_v2"->'options') ?& ARRAY['variation','length','opening','apologyStart']
        AND (("ai_operations"."reply_drafting_v2"->'options') - ARRAY['variation','length','maxWords','opening','apologyStart']) = '{}'::jsonb
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'voiceDigest') = 'string'
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'generationSeed') = 'string'
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'options'->'apologyStart') = 'string'
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'options'->'length') = 'string'
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'options'->'variation') = 'number'
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'options'->'opening') = 'number'
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'rewriteOrdinal') = 'number'
        AND "ai_operations"."reply_drafting_v2"->>'voiceDigest' ~ '^[0-9a-f]{64}$'
        AND "ai_operations"."reply_drafting_v2"->>'generationSeed' ~ '^[0-9a-f]{64}$'
        AND "ai_operations"."reply_drafting_v2"->'options'->>'apologyStart' = ANY (ARRAY['We''re sorry', 'We''re so sorry', 'We apologize', 'We''re truly sorry', 'Sentimos', 'Lamentamos', 'Nos apena', 'Le pedimos disculpas', 'Съжаляваме', 'Искрено съжаляваме', 'Извиняваме се', 'Много съжаляваме'])
        AND "ai_operations"."reply_drafting_v2"->'options'->>'length' = ANY (ARRAY['standard','short'])
        AND trunc(("ai_operations"."reply_drafting_v2"->'options'->>'variation')::numeric) = ("ai_operations"."reply_drafting_v2"->'options'->>'variation')::numeric
        AND ("ai_operations"."reply_drafting_v2"->'options'->>'variation')::numeric >= 0::numeric AND ("ai_operations"."reply_drafting_v2"->'options'->>'variation')::numeric <= '9007199254740991'::numeric
        AND ("ai_operations"."reply_drafting_v2"->'options'->>'opening')::numeric >= 1::numeric AND ("ai_operations"."reply_drafting_v2"->'options'->>'opening')::numeric <= 3::numeric
        AND trunc(("ai_operations"."reply_drafting_v2"->'options'->>'opening')::numeric) = ("ai_operations"."reply_drafting_v2"->'options'->>'opening')::numeric
        AND (NOT ("ai_operations"."reply_drafting_v2"->'options' ? 'maxWords') OR (
          jsonb_typeof("ai_operations"."reply_drafting_v2"->'options'->'maxWords') = 'number'
          AND "ai_operations"."reply_drafting_v2"->'options'->>'length' = 'short'
          AND ("ai_operations"."reply_drafting_v2"->'options'->>'maxWords')::numeric >= 8::numeric AND ("ai_operations"."reply_drafting_v2"->'options'->>'maxWords')::numeric <= 80::numeric
          AND trunc(("ai_operations"."reply_drafting_v2"->'options'->>'maxWords')::numeric) = ("ai_operations"."reply_drafting_v2"->'options'->>'maxWords')::numeric))
        AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'rewriteIssues') = 'array'
        AND ("ai_operations"."reply_drafting_v2"->'rewriteIssues') <@ '["empty_body","digits","symbols","emoji","avoidance","damaging_words","singular_voice","invitation","greeting","sign_off","complaint_exclamation","gendered_guest","invented_name","serious_praise","bulgarian_calque","bulgarian_unwell","multiple_apologies","max_words","sentence_reference","prohibited_content","private_data"]'::jsonb
        AND (("ai_operations"."rewrite_parent_operation_id" IS NULL AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'parentOperationId') = 'null' AND jsonb_array_length("ai_operations"."reply_drafting_v2"->'rewriteIssues') = 0)
          OR ("ai_operations"."rewrite_parent_operation_id" IS NOT NULL AND jsonb_typeof("ai_operations"."reply_drafting_v2"->'parentOperationId') = 'string' AND jsonb_array_length("ai_operations"."reply_drafting_v2"->'rewriteIssues') BETWEEN 1 AND 28))

        AND NOT ("ai_operations"."rewrite_parent_operation_id" IS DISTINCT FROM (("ai_operations"."reply_drafting_v2"->>'parentOperationId')::uuid))
        AND (("ai_operations"."reply_drafting_v2"->>'rewriteOrdinal')::numeric = CASE WHEN "ai_operations"."rewrite_parent_operation_id" IS NULL THEN 0 ELSE 1 END))
    ) IS TRUE));
--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_ai_provenance_valid";
--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_ai_provenance_valid" CHECK ((
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
              "replies"."origin_ai_profile_version" IN ('reply-draft-v1', 'reply-draft-v2', 'reply-draft-v3')
              AND "replies"."origin_reply_template_id" IS NULL
              AND "replies"."origin_reply_template_catalogue_version" IS NULL
              AND "replies"."origin_reply_template_catalogue_digest" IS NULL
              AND "replies"."origin_template_group" IN ('en-Latn', 'bg-Cyrl')
            )
            OR (
              "replies"."origin_ai_profile_version" = 'reply-draft-v4'
              AND "replies"."origin_reply_template_id" IS NULL
              AND "replies"."origin_reply_template_catalogue_version" IS NULL
              AND "replies"."origin_reply_template_catalogue_digest" IS NULL
              AND "replies"."origin_template_group" IN ('en-Latn', 'es-Latn', 'bg-Cyrl')
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
      ));
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" DROP CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid";
--> statement-breakpoint
ALTER TABLE "merchant_ai_consent_evidence" ADD CONSTRAINT "merchant_ai_consent_evidence_runtime_map_valid" CHECK ((
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
  ));
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" DROP CONSTRAINT "merchant_ai_enablement_runtime_map_valid";
--> statement-breakpoint
ALTER TABLE "merchant_ai_enablement" ADD CONSTRAINT "merchant_ai_enablement_runtime_map_valid" CHECK ((
    ("capabilities" = ARRAY[]::text[] AND "capability_runtime_profile_versions" = '{}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis']::text[] AND "capability_runtime_profile_versions" = '{"review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v1"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
    OR ("capabilities" = ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[] AND "capability_runtime_profile_versions" = '{"reply_drafting": "reply-drafting-runtime-v2", "property_trends": "property-trends-runtime-v1", "review_analysis": "review-analysis-runtime-v2"}'::jsonb)
  ));
--> statement-breakpoint
ALTER TABLE "reply_ai_frame_reservations" ADD CONSTRAINT "reply_ai_frame_digest_valid" CHECK ("reply_ai_frame_reservations"."voice_digest" ~ '^[0-9a-f]{64}$' AND "reply_ai_frame_reservations"."generation_seed" ~ '^[0-9a-f]{64}$');
