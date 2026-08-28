-- Bind personalized Reply Drafting to the exact current public Property Brand
-- display name without persisting provider output before explicit manager adoption.
-- Legacy v1/v2 provenance remains verifiable; new grounded output uses v3.

ALTER TABLE "ai_operations" ADD COLUMN "reply_brand_profile_version" integer;--> statement-breakpoint
ALTER TABLE "ai_operations" ADD COLUMN "reply_brand_display_name_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_reply_brand_binding_valid" CHECK ((
  (
    "ai_operations"."command" = 'reply'
    AND (
      (
        "ai_operations"."reply_brand_profile_version" IS NULL
        AND "ai_operations"."reply_brand_display_name_digest" IS NULL
      )
      OR (
        "ai_operations"."reply_brand_profile_version" >= 1
        AND "ai_operations"."reply_brand_display_name_digest" ~ '^[0-9a-f]{64}$'
      )
    )
  )
  OR (
    "ai_operations"."command" <> 'reply'
    AND "ai_operations"."reply_brand_profile_version" IS NULL
    AND "ai_operations"."reply_brand_display_name_digest" IS NULL
  )
));--> statement-breakpoint
ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_reply_adoption_valid";--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_reply_adoption_valid" CHECK ((
  (
    "ai_operations"."command" = 'reply'
    AND "ai_operations"."reply_adoption_disposition" IN ('none', 'adopted', 'invalidated')
    AND (
      (
        "ai_operations"."reply_adoption_disposition" = 'none'
        AND "ai_operations"."adopted_reply_revision" IS NULL
        AND "ai_operations"."adopted_review_reply_state_revision" IS NULL
      )
      OR (
        "ai_operations"."reply_adoption_disposition" = 'adopted'
        AND "ai_operations"."adopted_reply_revision" >= 1
        AND "ai_operations"."adopted_review_reply_state_revision" >= 1
      )
      OR (
        "ai_operations"."reply_adoption_disposition" = 'invalidated'
        AND (
          (
            "ai_operations"."adopted_reply_revision" IS NULL
            AND "ai_operations"."adopted_review_reply_state_revision" IS NULL
          )
          OR (
            "ai_operations"."adopted_reply_revision" >= 1
            AND "ai_operations"."adopted_review_reply_state_revision" >= 1
          )
        )
      )
    )
  )
  OR (
    "ai_operations"."command" <> 'reply'
    AND "ai_operations"."reply_adoption_disposition" = 'none'
    AND "ai_operations"."adopted_reply_revision" IS NULL
    AND "ai_operations"."adopted_review_reply_state_revision" IS NULL
  )
));--> statement-breakpoint

-- Portal owns this content-minimal, transaction-bound currentness authority.
-- It returns a boolean only; callers cannot read Portal Brand content through it.
CREATE OR REPLACE FUNCTION "is_current_portal_ai_reply_brand_profile_v1"(
  organization_id_value text,
  property_id_value uuid,
  profile_version_value integer,
  display_name_digest_value text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  profile_row record;
BEGIN
  IF profile_version_value < 1
    OR display_name_digest_value !~ '^[0-9a-f]{64}$'
  THEN
    RETURN false;
  END IF;

  SELECT
    profile."version",
    profile."display_name"
  INTO profile_row
  FROM public."property_portal_brand_profiles" AS profile
  WHERE profile."organization_id" = organization_id_value
    AND profile."property_id" = property_id_value
  FOR SHARE;

  RETURN FOUND
    AND profile_row."version" = profile_version_value
    AND encode(
      sha256(
        convert_to('repkey-ai-reply-brand-display-name-v1', 'UTF8')
        || decode('00', 'hex')
        || convert_to(profile_row."display_name", 'UTF8')
      ),
      'hex'
    ) = display_name_digest_value;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "is_current_portal_ai_reply_brand_profile_v1"(
  text, uuid, integer, text
) FROM PUBLIC;--> statement-breakpoint

-- Advance personalized Reply Drafting to the exact brand-grounded reply-draft-v2 contract while
-- retaining reply-suggestion-v1 as the stable operation/runtime wrapper. Existing
-- v1/v2 provenance remains valid; newly generated grounded drafts use v3 provenance
-- and carry no template identity. This migration changes no capability, provider,
-- deployment, routing, or merchant authorization control.
--
-- The immutable catalogue trigger is disabled only around one exact full-row
-- replacement and is restored before readiness is re-established.
ALTER TABLE "ai_operation_profiles" DISABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
UPDATE "ai_operation_profiles" AS target
   SET
       "command" = source."command",
       "capability" = source."capability",
       "purpose" = source."purpose",
       "source_route" = source."source_route",
       "gateway_path" = source."gateway_path",
       "caller_role" = source."caller_role",
       "capability_runtime_profile_version" = source."capability_runtime_profile_version",
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "output_schema_name" = source."output_schema_name",
       "output_schema_digest" = source."output_schema_digest",
       "prompt_digest" = source."prompt_digest",
       "artifact_attestations" = source."artifact_attestations",
       "artifact_attestations_digest" = source."artifact_attestations_digest",
       "sdk_request_shape_digest" = source."sdk_request_shape_digest",
       "static_token_bearing_bytes" = source."static_token_bearing_bytes",
       "static_token_bearing_digest" = source."static_token_bearing_digest",
       "source_byte_limit" = source."source_byte_limit",
       "provider_payload_byte_limit" = source."provider_payload_byte_limit",
       "prepared_request_byte_limit" = source."prepared_request_byte_limit",
       "response_byte_limit" = source."response_byte_limit",
       "max_output_tokens" = source."max_output_tokens",
       "reasoning_effort" = source."reasoning_effort",
       "provider_deadline_ms" = source."provider_deadline_ms",
       "request_deadline_ms" = source."request_deadline_ms",
       "execution_lease_ms" = source."execution_lease_ms",
       "profile_digest" = source."profile_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"f9a503bf9283e43cc73f5cc4a0592cd1b780003703c66d49ee53e7d16b9fecf7","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v2","personalizedReplyProfileDigest":"6694c03ef6ad41a8d590a6302f5d73c7185a1c30daca02f156c87c3e777cf540"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"de336a2ed38a5ff90c13a26cd4c647f7be5f4b9e442c2ab48ef59c29f4228156","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1562,"static_token_bearing_digest":"22e13e6b90a157522d472d4f3e614c7d6a963f8bdce3966a95f1aafc08dfc72c","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"1141c19faeb07243a6aca00a3b720d3ba9d3ee3962e013dbfe3a798704c34020"}')) AS source
 WHERE target."profile_version" = 'reply-suggestion-v1';--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" ENABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
DO $$
BEGIN
  IF (
    SELECT to_jsonb(row_value) - 'created_at'
      FROM public.ai_operation_profiles AS row_value
     WHERE row_value.profile_version = 'reply-suggestion-v1'
  ) IS DISTINCT FROM '{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"f9a503bf9283e43cc73f5cc4a0592cd1b780003703c66d49ee53e7d16b9fecf7","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v2","personalizedReplyProfileDigest":"6694c03ef6ad41a8d590a6302f5d73c7185a1c30daca02f156c87c3e777cf540"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"de336a2ed38a5ff90c13a26cd4c647f7be5f4b9e442c2ab48ef59c29f4228156","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1562,"static_token_bearing_digest":"22e13e6b90a157522d472d4f3e614c7d6a963f8bdce3966a95f1aafc08dfc72c","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"1141c19faeb07243a6aca00a3b720d3ba9d3ee3962e013dbfe3a798704c34020"}'::jsonb THEN
    RAISE EXCEPTION 'reply operation profile did not reach the Brand Profile grounding re-pin';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_ai_provenance_valid";--> statement-breakpoint
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
));--> statement-breakpoint
-- The operation row keeps its historical wrapper identity, while the adopted
-- Reply records the output contract that actually produced its content. Teach
-- the destructive freshness assertion about both provenance generations so a
-- current personalized draft is not mistaken for a stale legacy binding.
CREATE OR REPLACE FUNCTION "assert_current_ai_draft_binding_v1"(
  organization_id_value text,
  reply_id_value uuid
) RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  property_id_value uuid;
  review_id_value uuid;
  operation_id_value uuid;
  provider_profile_value text;
  reply_row record;
  review_row record;
  property_row record;
  profile_row record;
  authorization_row record;
  operation_row record;
  binding_is_current boolean;
BEGIN
  SELECT
    reply."review_id",
    review."property_id",
    reply."origin_operation_id",
    operation."provider_deployment_profile_version"
  INTO
    review_id_value,
    property_id_value,
    operation_id_value,
    provider_profile_value
  FROM "replies" AS reply
  JOIN "reviews" AS review
    ON review."id" = reply."review_id"
   AND review."organization_id" = reply."organization_id"
  LEFT JOIN "ai_operations" AS operation
    ON operation."id" = reply."origin_operation_id"
  WHERE reply."id" = reply_id_value
    AND reply."organization_id" = organization_id_value;

  IF NOT FOUND THEN RETURN 'not_ai'; END IF;

  PERFORM 1
  FROM "ai_execution_control_heads"
  WHERE "scope_key" IN (
    'global',
    'provider:' || COALESCE(provider_profile_value, ''),
    'capability:reply_drafting'
  )
  ORDER BY "scope_key"
  FOR UPDATE;

  SELECT
    property."organization_id",
    property."profile_version",
    property."source_epoch",
    property."lifecycle_state",
    property."deleted_at"
  INTO property_row
  FROM "properties" AS property
  WHERE property."id" = property_id_value
    AND property."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT profile.*
  INTO profile_row
  FROM "ai_property_processing_profiles" AS profile
  WHERE profile."property_id" = property_id_value
    AND profile."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT enablement.*
  INTO authorization_row
  FROM "merchant_ai_enablement" AS enablement
  WHERE enablement."property_id" = property_id_value
    AND enablement."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT
    review."property_id",
    review."source_epoch",
    review."source_revision",
    review."content_expires_at"
  INTO review_row
  FROM "reviews" AS review
  WHERE review."id" = review_id_value
    AND review."organization_id" = organization_id_value
  FOR UPDATE;

  SELECT reply.*
  INTO reply_row
  FROM "replies" AS reply
  WHERE reply."id" = reply_id_value
    AND reply."organization_id" = organization_id_value
  FOR UPDATE;

  IF NOT FOUND OR reply_row."authorship" IS DISTINCT FROM 'ai_assisted' THEN
    RETURN 'not_ai';
  END IF;

  SELECT operation.*
  INTO operation_row
  FROM "ai_operations" AS operation
  WHERE operation."id" = reply_row."origin_operation_id"
  FOR UPDATE;

  binding_is_current :=
    property_row."organization_id" = organization_id_value
    AND property_row."deleted_at" IS NULL
    AND property_row."lifecycle_state" = 'active'
    AND property_row."source_epoch" = reply_row."origin_source_epoch"
    AND profile_row."organization_id" = organization_id_value
    AND profile_row."property_id" = property_id_value
    AND profile_row."lifecycle_state" = 'active'
    AND profile_row."source_epoch" = reply_row."origin_source_epoch"
    AND profile_row."profile_version" = reply_row."origin_property_profile_version"
    AND review_row."property_id" = property_id_value
    AND review_row."source_epoch" = reply_row."origin_source_epoch"
    AND review_row."source_revision" = reply_row."origin_source_revision"
    AND review_row."content_expires_at" > transaction_timestamp()
    AND reply_row."ai_draft_expires_at" > transaction_timestamp()
    AND authorization_row."organization_id" = organization_id_value
    AND authorization_row."property_id" = property_id_value
    AND authorization_row."state" = 'enabled'
    AND authorization_row."authorized_source_epoch" = reply_row."origin_source_epoch"
    AND authorization_row."reply_drafting_epoch" = reply_row."origin_reply_drafting_epoch"
    AND authorization_row."capabilities" @> ARRAY['reply_drafting']::text[]
    AND authorization_row."capability_runtime_profile_versions"->>'reply_drafting' = 'reply-drafting-runtime-v1'
    AND operation_row."id" = reply_row."origin_operation_id"
    AND operation_row."command" = 'reply'
    AND operation_row."capability" = 'reply_drafting'
    AND operation_row."organization_id" = organization_id_value
    AND operation_row."property_id" = property_id_value
    AND operation_row."review_id" = review_id_value
    AND operation_row."source_epoch" = reply_row."origin_source_epoch"
    AND operation_row."source_revision" = reply_row."origin_source_revision"
    AND operation_row."property_profile_version" = reply_row."origin_property_profile_version"
    AND operation_row."operation_profile_version" = 'reply-suggestion-v1'
    AND (
      (
        reply_row."origin_ai_profile_version" IN ('reply-suggestion-v1', 'reply-draft-v1')
        AND operation_row."reply_brand_profile_version" IS NULL
        AND operation_row."reply_brand_display_name_digest" IS NULL
      )
      OR (
        reply_row."origin_ai_profile_version" = 'reply-draft-v2'
        AND operation_row."reply_brand_profile_version" >= 1
        AND operation_row."reply_brand_display_name_digest" ~ '^[0-9a-f]{64}$'
      )
    )
    AND operation_row."capability_runtime_profile_version" = 'reply-drafting-runtime-v1'
    AND operation_row."provider_deployment_profile_version" = profile_row."provider_deployment_profile_version"
    AND operation_row."provider_deployment_profile_version" = authorization_row."provider_deployment_profile_version"
    AND operation_row."authorization_lineage_id" = authorization_row."authorization_lineage_id"
    AND operation_row."reply_adoption_disposition" = 'adopted'
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'global'
        AND head."control_id" = operation_row."global_control_id"
        AND head."generation" = operation_row."global_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    )
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'provider:' || operation_row."provider_deployment_profile_version"
        AND head."control_id" = operation_row."provider_control_id"
        AND head."generation" = operation_row."provider_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    )
    AND EXISTS (
      SELECT 1 FROM "ai_execution_control_heads" AS head
      WHERE head."scope_key" = 'capability:reply_drafting'
        AND head."control_id" = operation_row."capability_control_id"
        AND head."generation" = operation_row."capability_control_generation"
        AND head."execution_state" = 'enabled'
        AND head."admission_state" = 'accepting'
    );

  IF binding_is_current THEN RETURN 'current'; END IF;

  DELETE FROM "replies"
  WHERE "id" = reply_id_value
    AND "organization_id" = organization_id_value
    AND "authorship" = 'ai_assisted'
    AND ("publication_state" IS NULL OR "publication_state" = 'authorized');

  IF FOUND THEN RETURN 'stale'; END IF;
  RETURN 'current';
END;
$$;--> statement-breakpoint
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
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"f9a503bf9283e43cc73f5cc4a0592cd1b780003703c66d49ee53e7d16b9fecf7","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v2","personalizedReplyProfileDigest":"6694c03ef6ad41a8d590a6302f5d73c7185a1c30daca02f156c87c3e777cf540"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"de336a2ed38a5ff90c13a26cd4c647f7be5f4b9e442c2ab48ef59c29f4228156","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1562,"static_token_bearing_digest":"22e13e6b90a157522d472d4f3e614c7d6a963f8bdce3966a95f1aafc08dfc72c","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"1141c19faeb07243a6aca00a3b720d3ba9d3ee3962e013dbfe3a798704c34020"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"df34437016d742e69ebfce7376b8c32601e24198c74f95ad02ea0f0c7a17863e","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"4245e4f7c72c4248760eb72bbb1d3ba6f10427691f1112fe573ae7bdf0539905","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1253,"static_token_bearing_digest":"f4920f0c542d1eef653599d6dbfcd03759a7f8b5580032b23000db2e9ed8f0bf","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"54db53fcfa12b721010c06b5e6c8f140b1871dddbaf47f985c53ce04bd42d75b"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":512,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY runtime_profile_version), '[]'::jsonb) FROM public.ai_runtime_capability_profiles AS row_value) = '[{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY capability), '[]'::jsonb) FROM public.ai_provider_deployment_capabilities AS row_value) = '[{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_runtime_catalogue_ready_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF NOT public.assert_ai_runtime_catalogue_ready_v1(
    'private-beta-global-v1',
    'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90',
    '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
  ) THEN
    RAISE EXCEPTION 'AI runtime catalogue readiness did not converge on Brand Profile-grounded Reply Drafting';
  END IF;
END $$;--> statement-breakpoint


-- Admission consumes the exact immutable Brand Profile binding. The Portal-owned
-- boolean authority locks the public profile row in the same transaction; no
-- Portal content crosses into the AI admission boundary.
CREATE OR REPLACE FUNCTION "admit_ai_property_v1"(
  p_descriptor jsonb,
  p_request_binding_key_id varchar,
  p_request_binding_hmac varchar,
  p_grant_kid varchar
)
RETURNS TABLE (
  status text,
  code text,
  nonce text,
  issued_at_epoch_millis bigint,
  expires_at_epoch_millis bigint,
  reply_token_expires_at_epoch_millis bigint,
  reply_draft_expires_at_epoch_millis bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  operation_row ai_operations%ROWTYPE;
  permit_row ai_execution_permits%ROWTYPE;
  property_row properties%ROWTYPE;
  review_row reviews%ROWTYPE;
  aggregate_row ai_property_aggregate_heads%ROWTYPE;
  profile_row ai_property_processing_profiles%ROWTYPE;
  operation_profile_row ai_operation_profiles%ROWTYPE;
  runtime_profile_row ai_runtime_capability_profiles%ROWTYPE;
  provider_profile_row ai_provider_deployment_profiles%ROWTYPE;
  membership_row ai_provider_deployment_capabilities%ROWTYPE;
  enablement_row merchant_ai_enablement%ROWTYPE;
  control_row ai_execution_control_heads%ROWTYPE;
  quota_row ai_property_quota_windows%ROWTYPE;
  circuit_row ai_provider_circuit_states%ROWTYPE;
  actor_role text;
  product_consumed boolean;
  rate_denied boolean := false;
  effective_actor_id text;
  route_name text := p_descriptor->>'route';
  capability_name text;
  command_name text;
  operation_id_value uuid;
  permit_id_value uuid;
  attempt_value integer;
  claimed_cost_value bigint;
  maximum_cost_value bigint;
  maximum_input_tokens bigint;
  caller_deadline_value bigint;
  observed_content_expiry bigint;
  source_digest_value text;
  source_byte_count_value integer;
  now_value timestamp with time zone := transaction_timestamp();
  now_millis bigint;
  deployment_rate_limit integer;
  deployment_concurrency_limit integer;
  organization_concurrency_limit integer;
  property_concurrency_limit integer;
  local_date_value date;
  local_start timestamp with time zone;
  local_end timestamp with time zone;
  transition_anchor_value timestamp with time zone;
  candidate_adoption timestamp with time zone;
  reply_count_value integer;
BEGIN
  BEGIN
    operation_id_value := (p_descriptor->>'operationId')::uuid;
    permit_id_value := (p_descriptor->>'permitId')::uuid;
    attempt_value := (p_descriptor->>'attemptNumber')::integer;
    claimed_cost_value := (p_descriptor#>>'{limits,costMicros}')::bigint;
    caller_deadline_value := (p_descriptor->>'callerDeadlineEpochMillis')::bigint;
    observed_content_expiry :=
      NULLIF(p_descriptor->>'observedContentExpiresAtEpochMillis', '')::bigint;
    source_digest_value := p_descriptor->>'sourceDigest';
    source_byte_count_value := (p_descriptor->>'sourceByteCount')::integer;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END;

  IF route_name NOT IN ('review-analysis', 'reply-suggestion', 'property-trend')
    OR attempt_value NOT BETWEEN 1 AND 4
    OR p_request_binding_key_id !~ '^[a-z][a-z0-9_-]{0,31}$'
    OR p_request_binding_hmac !~ '^[A-Za-z0-9_-]{43}$'
    OR p_grant_kid !~ '^[a-z][a-z0-9_-]{0,31}$'
    OR claimed_cost_value < 0
    OR claimed_cost_value > 9007199254740991
    OR source_digest_value !~ '^[0-9a-f]{64}$'
    OR source_byte_count_value NOT BETWEEN 1 AND 131072
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  capability_name := CASE route_name
    WHEN 'review-analysis' THEN 'review_analysis'
    WHEN 'reply-suggestion' THEN 'reply_drafting'
    ELSE 'property_trends'
  END;
  command_name := CASE route_name
    WHEN 'review-analysis' THEN 'analysis'
    WHEN 'reply-suggestion' THEN 'reply'
    ELSE 'trend'
  END;
  SELECT * INTO operation_profile_row
  FROM ai_operation_profiles
  WHERE profile_version = p_descriptor#>>'{binding,operationProfileVersion}';
  SELECT * INTO runtime_profile_row
  FROM ai_runtime_capability_profiles
  WHERE runtime_profile_version =
    p_descriptor#>>'{binding,capabilityRuntimeProfileVersion}';
  SELECT * INTO provider_profile_row
  FROM ai_provider_deployment_profiles
  WHERE profile_version =
    p_descriptor#>>'{binding,providerDeploymentProfileVersion}';
  SELECT * INTO membership_row
  FROM ai_provider_deployment_capabilities AS membership
  WHERE membership.provider_deployment_profile_version =
      provider_profile_row.profile_version
    AND membership.capability = capability_name;
  IF operation_profile_row.profile_version IS NULL
    OR runtime_profile_row.runtime_profile_version IS NULL
    OR provider_profile_row.profile_version IS NULL
    OR membership_row.provider_deployment_profile_version IS NULL
    OR operation_profile_row.command <> command_name
    OR operation_profile_row.capability <> capability_name
    OR operation_profile_row.source_route <> route_name
    OR operation_profile_row.provider_deployment_profile_version <>
      provider_profile_row.profile_version
    OR operation_profile_row.capability_runtime_profile_version <>
      runtime_profile_row.runtime_profile_version
    OR runtime_profile_row.capability <> capability_name
    OR runtime_profile_row.source_route <> route_name
    OR runtime_profile_row.operation_profile_version <>
      operation_profile_row.profile_version
    OR runtime_profile_row.provider_deployment_profile_version <>
      provider_profile_row.profile_version
    OR membership_row.runtime_profile_version <>
      runtime_profile_row.runtime_profile_version
    OR membership_row.catalogue_digest <> runtime_profile_row.catalogue_digest
    OR (p_descriptor#>>'{limits,sourceBytes}')::integer <>
      operation_profile_row.source_byte_limit
    OR (p_descriptor#>>'{limits,providerPayloadBytes}')::integer <>
      operation_profile_row.provider_payload_byte_limit
    OR (p_descriptor#>>'{limits,preparedRequestBytes}')::integer <>
      operation_profile_row.prepared_request_byte_limit
    OR (p_descriptor#>>'{limits,responseBytes}')::integer <>
      operation_profile_row.response_byte_limit
    OR (p_descriptor#>>'{limits,outputTokens}')::integer <>
      operation_profile_row.max_output_tokens
    OR source_byte_count_value > operation_profile_row.source_byte_limit
    OR (p_descriptor->>'providerPayloadByteCount')::integer >
      operation_profile_row.provider_payload_byte_limit
    OR (p_descriptor->>'preparedByteCount')::integer >
      operation_profile_row.prepared_request_byte_limit
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  maximum_input_tokens :=
    operation_profile_row.static_token_bearing_bytes::bigint +
    (p_descriptor->>'providerPayloadByteCount')::bigint;
  maximum_cost_value := floor((
    maximum_input_tokens::numeric * 200000::numeric +
    operation_profile_row.max_output_tokens::numeric * 1200000::numeric +
    999999::numeric
  ) / 1000000::numeric)::bigint;
  IF maximum_cost_value NOT BETWEEN 0 AND 9007199254740991
    OR claimed_cost_value <> maximum_cost_value
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  deployment_rate_limit := CASE route_name
    WHEN 'review-analysis' THEN 60
    WHEN 'reply-suggestion' THEN 30
    ELSE 10
  END;
  deployment_concurrency_limit := CASE route_name
    WHEN 'review-analysis' THEN 16
    WHEN 'reply-suggestion' THEN 8
    ELSE 4
  END;
  organization_concurrency_limit := CASE route_name
    WHEN 'review-analysis' THEN 8
    WHEN 'reply-suggestion' THEN 4
    ELSE 2
  END;
  property_concurrency_limit := CASE route_name
    WHEN 'review-analysis' THEN 2
    WHEN 'reply-suggestion' THEN 2
    ELSE 1
  END;
  now_millis := public.ai_epoch_millis_v1(now_value);

  IF caller_deadline_value <= now_millis
    OR caller_deadline_value > now_millis +
      operation_profile_row.request_deadline_ms
    OR caller_deadline_value - now_millis <
      operation_profile_row.provider_deadline_ms + 5000
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(lock_key)
  FROM (
    SELECT DISTINCT public.ai_advisory_lock_key_v1(value) AS lock_key
    FROM unnest(ARRAY[
      'provider-rate|' || provider_profile_row.profile_version || '|' ||
        command_name,
      'deployment-concurrency|' || provider_profile_row.profile_version || '|' ||
        command_name,
      'organization-concurrency|' || (p_descriptor->>'organizationId') || '|' ||
        command_name,
      'property-concurrency|' || (p_descriptor->>'propertyId') || '|' ||
        command_name,
      'operation-attempt|' || operation_id_value::text || '|' ||
        attempt_value::text
    ]) AS value
    ORDER BY lock_key
  ) AS ordered_locks;

  SELECT * INTO operation_row
  FROM ai_operations
  WHERE id = operation_id_value
  FOR UPDATE;
  IF NOT FOUND
    OR operation_row.state <> 'executing'
    OR operation_row.execution_attempt <> attempt_value
    OR operation_row.capability <> capability_name
    OR operation_row.organization_id <> p_descriptor->>'organizationId'
    OR operation_row.property_id::text <> p_descriptor->>'propertyId'
    OR operation_row.review_id::text IS DISTINCT FROM
      p_descriptor->>'internalSubjectId'
    OR operation_row.actor_user_id IS DISTINCT FROM p_descriptor->>'actorId'
    OR operation_row.source_digest <> source_digest_value
    OR operation_row.source_byte_count <> source_byte_count_value
    OR p_descriptor->'binding' IS DISTINCT FROM (
      jsonb_build_object(
      'authorizationLineageId', operation_row.authorization_lineage_id,
      'noticeVersion', operation_row.notice_version,
      'noticeDigest', operation_row.notice_digest,
      'capabilityFence', operation_row.capability_fences,
      'sourceEpoch', operation_row.source_epoch,
      'evaluatedLanguage', operation_row.evaluated_language,
      'concreteReplyLanguage', CASE
        WHEN operation_row.concrete_reply_language_tag IS NULL THEN NULL
        ELSE jsonb_build_object(
          'tag', operation_row.concrete_reply_language_tag,
          'templateGroup', operation_row.concrete_reply_template_group
        )
      END,
      'languageCatalogueDigest', operation_row.language_catalogue_digest,
      'replyLanguageVerifierDigest', operation_row.reply_language_verifier_digest,
      'languageScriptConsistencyDigest',
        operation_row.language_script_consistency_digest,
      'zhOrthographyVerifierDigest', operation_row.zh_orthography_verifier_digest,
      'sourceRevision', operation_row.source_revision,
      'reviewedAtEpochMillis', operation_row.reviewed_at_epoch_millis,
      'propertyProfileVersion', operation_row.property_profile_version,
      'routingPolicyVersion', operation_row.routing_policy_version,
      'sourcePolicyId', operation_row.source_policy_id,
      'sourceCanonicalizerDigest', operation_row.source_canonicalizer_digest,
      'redactionProfileVersion', operation_row.redaction_profile_version,
      'outputLeakageProfileVersion', operation_row.output_leakage_profile_version,
      'outputLeakageProfileDigest', operation_row.output_leakage_profile_digest,
      'replyTemplateCatalogueVersion', operation_row.reply_template_catalogue_version,
      'replyTemplateCatalogueDigest', operation_row.reply_template_catalogue_digest,
      'providerDeploymentProfileVersion',
        operation_row.provider_deployment_profile_version,
      'operationProfileVersion', operation_row.operation_profile_version,
      'capabilityRuntimeProfileVersion',
        operation_row.capability_runtime_profile_version,
      'aiSubjectHmacKeyVersion', operation_row.subject_hmac_key_version,
      'stopFence', jsonb_build_object(
        'globalControlId', operation_row.global_control_id,
        'globalGeneration', operation_row.global_control_generation,
        'providerControlId', operation_row.provider_control_id,
        'providerGeneration', operation_row.provider_control_generation,
        'capabilityControlId', operation_row.capability_control_id,
        'capabilityGeneration', operation_row.capability_control_generation
      )
      )
      || CASE
        WHEN route_name = 'reply-suggestion' THEN jsonb_build_object(
          'replyBrandProfileVersion', operation_row.reply_brand_profile_version,
          'replyBrandDisplayNameDigest',
            operation_row.reply_brand_display_name_digest
        )
        ELSE '{}'::jsonb
      END
    )
    OR p_descriptor->>'redactionProfileVersion' IS DISTINCT FROM
      operation_row.redaction_profile_version
    OR p_descriptor->>'outputLeakageProfileVersion' IS DISTINCT FROM
      operation_row.output_leakage_profile_version
    OR p_descriptor->>'outputLeakageProfileDigest' IS DISTINCT FROM
      operation_row.output_leakage_profile_digest
    OR p_descriptor->>'replyTemplateCatalogueVersion' IS DISTINCT FROM
      operation_row.reply_template_catalogue_version
    OR p_descriptor->>'replyTemplateCatalogueDigest' IS DISTINCT FROM
      operation_row.reply_template_catalogue_digest
    OR operation_row.operation_profile_version <>
      p_descriptor#>>'{binding,operationProfileVersion}'
    OR operation_row.provider_deployment_profile_version <>
      p_descriptor#>>'{binding,providerDeploymentProfileVersion}'
    OR operation_row.capability_runtime_profile_version <>
      p_descriptor#>>'{binding,capabilityRuntimeProfileVersion}'
    OR operation_row.authorization_lineage_id::text <>
      p_descriptor#>>'{binding,authorizationLineageId}'
    OR operation_row.source_epoch <>
      (p_descriptor#>>'{binding,sourceEpoch}')::integer
    OR operation_row.property_profile_version <>
      (p_descriptor#>>'{binding,propertyProfileVersion}')::integer
    OR operation_row.expires_at <= now_value
    OR (
      route_name = 'reply-suggestion'
      AND (
        operation_row.reply_brand_profile_version IS NULL
        OR operation_row.reply_brand_display_name_digest IS NULL
        OR NOT public.is_current_portal_ai_reply_brand_profile_v1(
          operation_row.organization_id,
          operation_row.property_id,
          operation_row.reply_brand_profile_version,
          operation_row.reply_brand_display_name_digest
        )
      )
    )
  THEN
    RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO permit_row
  FROM ai_execution_permits
  WHERE id = permit_id_value
    AND operation_id = operation_id_value
    AND execution_attempt = attempt_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied', 'permit_unknown', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF permit_row.state <> 'issued' THEN
    RETURN QUERY SELECT 'denied', 'already_consumed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF permit_row.expires_at <= now_value THEN
    RETURN QUERY SELECT 'denied', 'permit_expired', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row
  FROM ai_execution_control_heads
  WHERE scope_key = 'global'
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.global_control_id
    OR control_row.generation <> operation_row.global_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row
  FROM ai_execution_control_heads
  WHERE scope_key =
    'provider:' || operation_row.provider_deployment_profile_version
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.provider_control_id
    OR control_row.generation <> operation_row.provider_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO control_row
  FROM ai_execution_control_heads
  WHERE scope_key = 'capability:' || capability_name
  FOR SHARE;
  IF NOT FOUND
    OR control_row.control_id <> operation_row.capability_control_id
    OR control_row.generation <> operation_row.capability_control_generation
    OR control_row.execution_state <> 'enabled'
    OR control_row.admission_state <> 'accepting'
  THEN
    RETURN QUERY SELECT 'denied', 'control_disabled', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO circuit_row
  FROM ai_provider_circuit_states
  WHERE provider_deployment_profile_version =
    operation_row.provider_deployment_profile_version
  FOR UPDATE;
  IF NOT FOUND
    OR circuit_row.state = 'open'
      AND circuit_row.opened_until > now_value
  THEN
    RETURN QUERY SELECT 'denied', 'circuit_open', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF circuit_row.state = 'open' THEN
    UPDATE ai_provider_circuit_states
    SET state = 'half_open',
      opened_until = now_value + interval '60 seconds',
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version
      AND state = 'open';
  ELSIF circuit_row.state = 'half_open' AND EXISTS (
    SELECT 1
    FROM ai_execution_permits AS probe_permit
    JOIN ai_operations AS probe_operation
      ON probe_operation.id = probe_permit.operation_id
    WHERE probe_permit.state = 'consumed'
      AND probe_permit.concurrency_expires_at > now_value
      AND probe_operation.provider_deployment_profile_version =
        operation_row.provider_deployment_profile_version
  ) THEN
    RETURN QUERY SELECT 'denied', 'circuit_open', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO property_row
  FROM properties
  WHERE organization_id = operation_row.organization_id
    AND id = operation_row.property_id
  FOR SHARE;
  IF NOT FOUND
    OR property_row.deleted_at IS NOT NULL
    OR property_row.lifecycle_state <> 'active'
    OR property_row.source_epoch <> operation_row.source_epoch
    OR property_row.country_code <> p_descriptor->>'redactionCountry'
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF route_name IN ('review-analysis', 'reply-suggestion') THEN
    SELECT * INTO review_row
    FROM reviews
    WHERE organization_id = operation_row.organization_id
      AND property_id = operation_row.property_id
      AND id = operation_row.review_id
    FOR SHARE;
    IF NOT FOUND
      OR review_row.source_epoch <> operation_row.source_epoch
      OR review_row.source_revision <> operation_row.source_revision
      OR floor(extract(epoch FROM review_row.reviewed_at) * 1000)::bigint <>
        operation_row.reviewed_at_epoch_millis
      OR review_row.ai_source_digest <> source_digest_value
      OR review_row.ai_source_byte_length <> source_byte_count_value
      OR review_row.content_expires_at IS NULL
      OR review_row.content_expires_at <= now_value
      OR floor(extract(epoch FROM review_row.content_expires_at) * 1000)::bigint <>
        observed_content_expiry
      OR (
        route_name = 'review-analysis'
        AND review_row.analysis_sequence <> operation_row.analysis_sequence
      )
    THEN
      RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
  ELSE
    SELECT * INTO aggregate_row
    FROM ai_property_aggregate_heads
    WHERE organization_id = operation_row.organization_id
      AND property_id = operation_row.property_id
      AND source_epoch = operation_row.source_epoch
      AND review_analysis_epoch =
        (operation_row.capability_fences->>'reviewAnalysisEpoch')::integer
      AND property_profile_version = operation_row.property_profile_version
    FOR SHARE;
    IF observed_content_expiry IS NOT NULL
      OR NOT FOUND
      OR aggregate_row.aggregate_revision <> operation_row.aggregate_revision
      OR aggregate_row.terminal_analysis_sequence <>
        operation_row.terminal_analysis_sequence
    THEN
      RETURN QUERY SELECT 'denied', 'source_mismatch', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO profile_row
  FROM ai_property_processing_profiles
  WHERE organization_id = operation_row.organization_id
    AND property_id = operation_row.property_id
  FOR SHARE;
  IF NOT FOUND
    OR profile_row.lifecycle_state <> 'active'
    OR profile_row.source_epoch <> operation_row.source_epoch
    OR profile_row.profile_version <> operation_row.property_profile_version
    OR profile_row.timezone <> property_row.timezone
    OR profile_row.provider_deployment_profile_version <>
      operation_row.provider_deployment_profile_version
    OR profile_row.country_code <> p_descriptor->>'redactionCountry'
    OR profile_row.routing_policy_version <> operation_row.routing_policy_version
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO enablement_row
  FROM merchant_ai_enablement
  WHERE organization_id = operation_row.organization_id
    AND property_id = operation_row.property_id
  FOR SHARE;
  IF NOT FOUND
    OR enablement_row.state <> 'enabled'
    OR enablement_row.authorization_lineage_id <>
      operation_row.authorization_lineage_id
    OR enablement_row.authorized_source_epoch <> operation_row.source_epoch
    OR NOT capability_name = ANY(enablement_row.capabilities)
    OR enablement_row.capability_runtime_profile_versions->>capability_name <>
      operation_row.capability_runtime_profile_version
    OR (
      capability_name = 'review_analysis'
      AND enablement_row.review_analysis_epoch <>
        (operation_row.capability_fences->>'reviewAnalysisEpoch')::integer
    )
    OR (
      capability_name = 'reply_drafting'
      AND enablement_row.reply_drafting_epoch <>
        (operation_row.capability_fences->>'replyDraftingEpoch')::integer
    )
    OR (
      capability_name = 'property_trends'
      AND (
        enablement_row.review_analysis_epoch <>
          (operation_row.capability_fences->>'reviewAnalysisEpoch')::integer
        OR enablement_row.property_trends_epoch <>
          (operation_row.capability_fences->>'propertyTrendsEpoch')::integer
      )
    )
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  effective_actor_id := operation_row.actor_user_id;
  IF effective_actor_id IS NULL THEN
    SELECT actor_user_id INTO effective_actor_id
    FROM merchant_ai_consent_evidence
    WHERE authorization_lineage_id = operation_row.authorization_lineage_id
      AND state_version = enablement_row.state_version
    FOR SHARE;
  END IF;
  SELECT role INTO actor_role
  FROM member
  WHERE "organizationId" = operation_row.organization_id
    AND "userId" = effective_actor_id
  FOR SHARE;
  IF NOT FOUND
    OR (
      NOT (
        'owner' = ANY (
          regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
        )
      )
      AND (
        NOT (
          'admin' = ANY (
            regexp_split_to_array(lower(actor_role), '[[:space:]]*,[[:space:]]*')
          )
        )
        OR NOT EXISTS (
          SELECT 1 FROM property_access_grant
          WHERE organization_id = operation_row.organization_id
            AND property_id = operation_row.property_id
            AND user_id = effective_actor_id
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now_value)
        )
      )
    )
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  -- `organization_capability` is keyed by PURPOSE (`ai.generate_reply`), not by
  -- capability (`reply_drafting`); comparing it to `capability_name` could never
  -- match, so every AI operation was denied `authorization_changed`.
  -- `property_policy` rows are written only by setPropertyPolicy (the
  -- suspend/restore command), so a property that has never been suspended has NO
  -- row: requiring one to exist denied every such property. Deny only on an actual
  -- suspension.
  IF NOT EXISTS (
    SELECT 1 FROM organization_capability
    WHERE organization_id = operation_row.organization_id
      AND capability = operation_profile_row.purpose
  ) OR EXISTS (
    SELECT 1 FROM property_policy
    WHERE property_id = operation_row.property_id
      AND suspended_at IS NOT NULL
  )
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF (
    SELECT count(*) FROM ai_execution_permits
    WHERE state = 'consumed' AND concurrency_expires_at > now_value
  ) >= 16 OR (
    SELECT count(*) FROM ai_execution_permits p
    JOIN ai_operations o ON o.id = p.operation_id
    WHERE p.state = 'consumed'
      AND p.concurrency_expires_at > now_value
      AND o.organization_id = operation_row.organization_id
  ) >= 8 OR (
    SELECT count(*) FROM ai_execution_permits p
    JOIN ai_operations o ON o.id = p.operation_id
    WHERE p.state = 'consumed'
      AND p.concurrency_expires_at > now_value
      AND o.property_id = operation_row.property_id
  ) >= 4 OR (
    SELECT count(*) FROM ai_execution_permits p
    JOIN ai_operations o ON o.id = p.operation_id
    WHERE p.state = 'consumed'
      AND p.concurrency_expires_at > now_value
      AND o.provider_deployment_profile_version =
        operation_row.provider_deployment_profile_version
  ) >= 16
  THEN
    RETURN QUERY SELECT 'denied', 'concurrency_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;


  local_date_value := public.resolve_ai_property_local_date_v1(
    now_value,
    property_row.timezone,
    'property-calendar-v1'
  );
  local_start := public.ai_property_local_midnight_v1(
    local_date_value,
    property_row.timezone
  );
  local_end := public.ai_property_local_midnight_v1(
    local_date_value + 1,
    property_row.timezone
  );
  IF local_date_value IS NULL OR local_start IS NULL OR local_end IS NULL
    OR local_end <= now_value OR local_end <= local_start
  THEN
    RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  INSERT INTO ai_property_quota_windows (
    property_id, organization_id, generation, property_profile_version,
    timezone, local_date, starts_at, ends_at,
    transition_anchor, adoption_at, pending_timezone,
    pending_property_profile_version, analysis_count, reply_count,
    reserved_cost_micros, settled_cost_micros, updated_at
  ) VALUES (
    operation_row.property_id, operation_row.organization_id, 1,
    operation_row.property_profile_version, property_row.timezone,
    local_date_value, local_start, local_end, NULL, NULL, NULL, NULL,
    0, 0, 0, 0, now_value
  )
  ON CONFLICT (property_id) DO NOTHING;
  SELECT * INTO STRICT quota_row
  FROM ai_property_quota_windows
  WHERE property_id = operation_row.property_id
  FOR UPDATE;

  IF quota_row.transition_anchor IS NULL
    AND quota_row.timezone = property_row.timezone
  THEN
    IF quota_row.ends_at <= now_value THEN
      UPDATE ai_property_quota_windows
      SET generation = generation + 1,
        property_profile_version = operation_row.property_profile_version,
        local_date = local_date_value,
        starts_at = local_start,
        ends_at = local_end,
        analysis_count = 0,
        reply_count = 0,
        reserved_cost_micros = 0,
        settled_cost_micros = 0,
        updated_at = now_value
      WHERE property_id = operation_row.property_id
      RETURNING * INTO quota_row;
    ELSIF quota_row.property_profile_version <>
      operation_row.property_profile_version
    THEN
      UPDATE ai_property_quota_windows
      SET property_profile_version = operation_row.property_profile_version,
        updated_at = now_value
      WHERE property_id = operation_row.property_id
      RETURNING * INTO quota_row;
    END IF;
  ELSE
    transition_anchor_value := COALESCE(
      quota_row.transition_anchor,
      quota_row.ends_at
    );
    candidate_adoption := public.ai_property_quota_adoption_v1(
      transition_anchor_value,
      property_row.timezone
    );
    IF candidate_adoption IS NULL THEN
      RETURN QUERY SELECT 'denied', 'authorization_changed', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
    candidate_adoption := GREATEST(
      COALESCE(quota_row.adoption_at, candidate_adoption),
      candidate_adoption
    );
    UPDATE ai_property_quota_windows
    SET transition_anchor = transition_anchor_value,
      adoption_at = candidate_adoption,
      ends_at = candidate_adoption,
      pending_timezone = property_row.timezone,
      pending_property_profile_version = operation_row.property_profile_version,
      updated_at = now_value
    WHERE property_id = operation_row.property_id
    RETURNING * INTO quota_row;

    IF now_value >= candidate_adoption THEN
      UPDATE ai_property_quota_windows
      SET generation = generation + 1,
        property_profile_version = operation_row.property_profile_version,
        timezone = property_row.timezone,
        local_date = local_date_value,
        starts_at = local_start,
        ends_at = local_end,
        transition_anchor = NULL,
        adoption_at = NULL,
        pending_timezone = NULL,
        pending_property_profile_version = NULL,
        analysis_count = 0,
        reply_count = 0,
        reserved_cost_micros = 0,
        settled_cost_micros = 0,
        updated_at = now_value
      WHERE property_id = operation_row.property_id
      RETURNING * INTO quota_row;
    END IF;
  END IF;

  IF capability_name = 'review_analysis'
    AND quota_row.analysis_count >= 500
  THEN
    RETURN QUERY SELECT 'denied', 'quota_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;
  IF capability_name = 'reply_drafting' THEN
    SELECT count(*) INTO reply_count_value
    FROM ai_admission_product_consumptions
    WHERE property_id = operation_row.property_id
      AND capability = 'reply_drafting'
      AND accounted_at > now_value - interval '1 hour';
    IF quota_row.reply_count >= 100 OR reply_count_value >= 20 THEN
      RETURN QUERY SELECT 'denied', 'quota_exhausted', NULL::text,
        NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
      RETURN;
    END IF;
  END IF;

  INSERT INTO ai_organization_cost_windows (
    organization_id, utc_date, reserved_cost_micros,
    settled_cost_micros, updated_at
  ) VALUES (
    operation_row.organization_id, (now_value AT TIME ZONE 'UTC')::date,
    0, 0, now_value
  )
  ON CONFLICT (organization_id, utc_date) DO NOTHING;
  PERFORM 1 FROM ai_organization_cost_windows
  WHERE organization_id = operation_row.organization_id
    AND utc_date = (now_value AT TIME ZONE 'UTC')::date
  FOR UPDATE;
  IF quota_row.reserved_cost_micros + quota_row.settled_cost_micros
      + maximum_cost_value > 10000000
    OR (
      SELECT reserved_cost_micros + settled_cost_micros
      FROM ai_organization_cost_windows
      WHERE organization_id = operation_row.organization_id
        AND utc_date = (now_value AT TIME ZONE 'UTC')::date
    ) + maximum_cost_value > 50000000
  THEN
    RETURN QUERY SELECT 'denied', 'quota_exhausted', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  BEGIN
    IF NOT consume_ai_admission_rate_v1('global', 16, 60, now_value)
      OR NOT consume_ai_admission_rate_v1(
        'provider:' || operation_row.provider_deployment_profile_version,
        16, 60, now_value
      )
      OR NOT consume_ai_admission_rate_v1(
        'organization:' || operation_row.organization_id,
        8, 60, now_value
      )
      OR NOT consume_ai_admission_rate_v1(
        'property:' || operation_row.property_id::text,
        4, 60, now_value
      )
    THEN
      RAISE EXCEPTION 'ai_admission_rate_limited' USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      rate_denied := true;
  END;
  IF rate_denied THEN
    RETURN QUERY SELECT 'denied', 'rate_limited', NULL::text,
      NULL::bigint, NULL::bigint, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  INSERT INTO ai_admission_product_consumptions (
    operation_id, organization_id, property_id, capability,
    property_window_generation, accounted_at
  ) VALUES (
    operation_row.id, operation_row.organization_id, operation_row.property_id,
    capability_name, quota_row.generation, now_value
  )
  ON CONFLICT (operation_id) DO NOTHING;
  product_consumed := FOUND;
  UPDATE ai_property_quota_windows
  SET analysis_count = analysis_count +
        CASE
          WHEN product_consumed AND capability_name = 'review_analysis' THEN 1
          ELSE 0
        END,
      reply_count = reply_count +
        CASE
          WHEN product_consumed AND capability_name = 'reply_drafting' THEN 1
          ELSE 0
        END,
      reserved_cost_micros = reserved_cost_micros + maximum_cost_value,
      updated_at = now_value
  WHERE property_id = operation_row.property_id;
  UPDATE ai_organization_cost_windows
  SET reserved_cost_micros = reserved_cost_micros + maximum_cost_value,
    updated_at = now_value
  WHERE organization_id = operation_row.organization_id
    AND utc_date = (now_value AT TIME ZONE 'UTC')::date;

  UPDATE ai_execution_permits
  SET request_binding_key_id = p_request_binding_key_id,
    request_binding_hmac = p_request_binding_hmac,
    grant_kid = p_grant_kid,
    nonce = replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', ''),
    state = 'consumed',
    consumed_at = now_value,
    concurrency_expires_at = to_timestamp(caller_deadline_value / 1000.0),
    maximum_cost_micros = maximum_cost_value
  WHERE id = permit_id_value AND state = 'issued'
  RETURNING * INTO permit_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_admission_permit_race' USING ERRCODE = '40001';
  END IF;

  INSERT INTO ai_admission_cost_reservations (
    permit_id, organization_id, property_id, property_window_generation,
    organization_utc_date, release_sha, maximum_cost_micros,
    actual_cost_micros, state, created_at, settled_at
  ) VALUES (
    permit_row.id, operation_row.organization_id, operation_row.property_id,
    quota_row.generation, (now_value AT TIME ZONE 'UTC')::date, NULL,
    maximum_cost_value, NULL, 'reserved', now_value, NULL
  );

  -- Column 6 is reply_token_expires_at, column 7 is reply_draft_expires_at, and
  -- both the gateway (grantMatchesInvocation) and the signed grant contract
  -- (validateGrantFields in ai-internal-transport-contract.ts) require
  -- token <= draft: a request-scoped token must not outlive the draft it authorises.
  -- These two expressions were the wrong way round, so the token carried the review's
  -- content expiry (weeks out) while the draft carried the caller deadline (~70s),
  -- making token <= draft impossible. Every reply-suggestion grant was rejected as
  -- ambiguous before the connector was ever reached.
  RETURN QUERY SELECT 'admitted', NULL::text, permit_row.nonce::text,
    now_millis, caller_deadline_value,
    CASE WHEN route_name = 'reply-suggestion'
      THEN LEAST(observed_content_expiry, caller_deadline_value) ELSE NULL END,
    CASE WHEN route_name = 'reply-suggestion'
      THEN observed_content_expiry ELSE NULL END;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "admit_ai_property_v1"(
  jsonb, varchar, varchar, varchar
) FROM PUBLIC;--> statement-breakpoint
