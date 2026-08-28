-- Replace stock-template selection with the exact reply-draft-v1 contract while
-- retaining reply-suggestion-v1 as the stable operation/runtime wrapper. Existing
-- v1 provenance remains valid; newly adopted personalized drafts use v2 provenance
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
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"3bf41295c16fc1fdb6455e8712812b880ee11beca5ec1014c884eaa4bd59e8b4","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v1","personalizedReplyProfileDigest":"86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"187b63b82b6e12297777deab150e61159ec692a40470e62f7a3cb43695c63eb8","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1409,"static_token_bearing_digest":"ae950e78f6d8ad646db084cbdeff1ea579cec12b846daf991a94e4bf33e4697d","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"029203e3f20c86e3df3c54588eb51beb0dfb386affb0a5251707dd9ce9210bdc"}')) AS source
 WHERE target."profile_version" = 'reply-suggestion-v1';--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" ENABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
DO $$
BEGIN
  IF (
    SELECT to_jsonb(row_value) - 'created_at'
      FROM public.ai_operation_profiles AS row_value
     WHERE row_value.profile_version = 'reply-suggestion-v1'
  ) IS DISTINCT FROM '{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"3bf41295c16fc1fdb6455e8712812b880ee11beca5ec1014c884eaa4bd59e8b4","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v1","personalizedReplyProfileDigest":"86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"187b63b82b6e12297777deab150e61159ec692a40470e62f7a3cb43695c63eb8","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1409,"static_token_bearing_digest":"ae950e78f6d8ad646db084cbdeff1ea579cec12b846daf991a94e4bf33e4697d","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"029203e3f20c86e3df3c54588eb51beb0dfb386affb0a5251707dd9ce9210bdc"}'::jsonb THEN
    RAISE EXCEPTION 'reply operation profile did not reach the personalized draft re-pin';
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
        "replies"."origin_ai_profile_version" = 'reply-draft-v1'
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
    AND reply_row."origin_ai_profile_version" IN ('reply-suggestion-v1', 'reply-draft-v1')
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
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_draft_v1","output_schema_digest":"e8c29f4e2fd80391fbb483390e671dd0c4c5b639b1d1ec85e9d018ab90c33d35","prompt_digest":"3bf41295c16fc1fdb6455e8712812b880ee11beca5ec1014c884eaa4bd59e8b4","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"d62f52f214a4488577e7a66b6f5234dcc7505cac03ace131c602b4f3f7e8219a","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673","personalizedReplyProfileVersion":"reply-draft-v1","personalizedReplyProfileDigest":"86bb98cb3b0b1c8561141e2ec30e019725d5f0ba5dd57be4745c7db5bc851769"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"187b63b82b6e12297777deab150e61159ec692a40470e62f7a3cb43695c63eb8","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1409,"static_token_bearing_digest":"ae950e78f6d8ad646db084cbdeff1ea579cec12b846daf991a94e4bf33e4697d","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"029203e3f20c86e3df3c54588eb51beb0dfb386affb0a5251707dd9ce9210bdc"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"df34437016d742e69ebfce7376b8c32601e24198c74f95ad02ea0f0c7a17863e","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"d117b9f16e90bec59f007861e86cd73ebe84b20497f004ecfc3b0ef86f12501a"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"4245e4f7c72c4248760eb72bbb1d3ba6f10427691f1112fe573ae7bdf0539905","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1253,"static_token_bearing_digest":"f4920f0c542d1eef653599d6dbfcd03759a7f8b5580032b23000db2e9ed8f0bf","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"54db53fcfa12b721010c06b5e6c8f140b1871dddbaf47f985c53ce04bd42d75b"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":512,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7"}]'::jsonb
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
    RAISE EXCEPTION 'AI runtime catalogue readiness did not converge on personalized Reply Drafting';
  END IF;
END $$;--> statement-breakpoint
