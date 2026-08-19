-- Re-pin the AI runtime catalogue for databases migrated before the
-- 2026-08-19 contract changes.
--
-- 1. Bulgarian (`bg-Cyrl`) entered the reply-template language catalogue as its
--    24th group. That rotated the language-catalogue attestation, the reply
--    language verifier and the reply-template catalogue digests, which are
--    bound into the `review-analysis-v1` and `reply-suggestion-v1` operation
--    profile digests.
-- 2. The merchant consent notice was re-versioned
--    (`merchant-ai-notice-2026-08-15.v1` -> `merchant-ai-notice-2026-08-19.v1`).
--    `AI_RUNTIME_CAPABILITIES_V1` embeds the notice version and digest, so the
--    runtime-capability catalogue digest moved with it and every runtime and
--    deployment-membership row carries the new values.
--
-- Fresh databases get these values from the unshipped 0046 seed; this migration
-- is the forward fix for an already-migrated one and is a no-op there. The
-- catalogue tables are immutable and the runtime byte-compares their rows
-- against the compiled contract, so the seed must move with the contract or
-- every AI operation resolves `policy_unavailable`. Same trigger-disable
-- ceremony as 0050/0055/0057.
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
       "provider_deadline_ms" = source."provider_deadline_ms",
       "request_deadline_ms" = source."request_deadline_ms",
       "execution_lease_ms" = source."execution_lease_ms",
       "profile_digest" = source."profile_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"7ae4aabfc187f0c402bbb1d6e44012a0f19bcf31a89871c80d259878f82094ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"bab4c65fc804d23f1de614c8480524c28d67162e7db9bae85e15634ac7c4facb","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":1081,"static_token_bearing_digest":"70aea6dab74ccf1df331a42264c06120c0bedd509f7cdad3b05088a3c953b066","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":4096,"provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"4bb7694a964f6ff2187a509bbc2bf69818fc41fc17c61bc5360fbedf1c65acfe"}')) AS source
 WHERE target."profile_version" = 'review-analysis-v1';--> statement-breakpoint
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
       "provider_deadline_ms" = source."provider_deadline_ms",
       "request_deadline_ms" = source."request_deadline_ms",
       "execution_lease_ms" = source."execution_lease_ms",
       "profile_digest" = source."profile_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_template_selection_v1","output_schema_digest":"8a5366b0c962d6aaa5280198911957456fa8a4b3e2501d8d02d7648ddd8177df","prompt_digest":"3d9ff8af03d9d9289db57ca29854a6daf0d337e1414c171d7e983648b0da75ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"3ed39117b80bfd90afa9b18a30f9c7406ce99bf709f32f5edb08829001c5a509","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"a2e0fff245e76e4c57cc495daccc6c3bc46c2ec98947e6f1efbae8773795f9d3","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":903,"static_token_bearing_digest":"1353194070405029cfb4e0d07d800ce92a6e4298264b305bb6cef7b64d69b02d","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":6144,"provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"c83709f95797af21fd02cf18dd6a7eefa1f580eb325d6a0122ae31e8e2a724f3"}')) AS source
 WHERE target."profile_version" = 'reply-suggestion-v1';--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" ENABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_runtime_capability_profiles" DISABLE TRIGGER "ai_runtime_capability_profiles_immutable";--> statement-breakpoint
UPDATE "ai_runtime_capability_profiles" AS target
   SET
       "capability" = source."capability",
       "purpose" = source."purpose",
       "source_route" = source."source_route",
       "gateway_path" = source."gateway_path",
       "gateway_profile_version" = source."gateway_profile_version",
       "caller" = source."caller",
       "operation_profile_version" = source."operation_profile_version",
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "notice_version" = source."notice_version",
       "notice_digest" = source."notice_digest",
       "catalogue_digest" = source."catalogue_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_runtime_capability_profiles, '{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}')) AS source
 WHERE target."runtime_profile_version" = 'review-analysis-runtime-v1';--> statement-breakpoint
UPDATE "ai_runtime_capability_profiles" AS target
   SET
       "capability" = source."capability",
       "purpose" = source."purpose",
       "source_route" = source."source_route",
       "gateway_path" = source."gateway_path",
       "gateway_profile_version" = source."gateway_profile_version",
       "caller" = source."caller",
       "operation_profile_version" = source."operation_profile_version",
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "notice_version" = source."notice_version",
       "notice_digest" = source."notice_digest",
       "catalogue_digest" = source."catalogue_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_runtime_capability_profiles, '{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}')) AS source
 WHERE target."runtime_profile_version" = 'reply-drafting-runtime-v1';--> statement-breakpoint
UPDATE "ai_runtime_capability_profiles" AS target
   SET
       "capability" = source."capability",
       "purpose" = source."purpose",
       "source_route" = source."source_route",
       "gateway_path" = source."gateway_path",
       "gateway_profile_version" = source."gateway_profile_version",
       "caller" = source."caller",
       "operation_profile_version" = source."operation_profile_version",
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "notice_version" = source."notice_version",
       "notice_digest" = source."notice_digest",
       "catalogue_digest" = source."catalogue_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_runtime_capability_profiles, '{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}')) AS source
 WHERE target."runtime_profile_version" = 'property-trends-runtime-v1';--> statement-breakpoint
ALTER TABLE "ai_runtime_capability_profiles" ENABLE TRIGGER "ai_runtime_capability_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_capabilities" DISABLE TRIGGER "ai_provider_deployment_capabilities_immutable";--> statement-breakpoint
UPDATE "ai_provider_deployment_capabilities" AS target
   SET
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "runtime_profile_version" = source."runtime_profile_version",
       "catalogue_digest" = source."catalogue_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_provider_deployment_capabilities, '{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}')) AS source
 WHERE target."capability" = 'review_analysis';--> statement-breakpoint
UPDATE "ai_provider_deployment_capabilities" AS target
   SET
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "runtime_profile_version" = source."runtime_profile_version",
       "catalogue_digest" = source."catalogue_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_provider_deployment_capabilities, '{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}')) AS source
 WHERE target."capability" = 'reply_drafting';--> statement-breakpoint
UPDATE "ai_provider_deployment_capabilities" AS target
   SET
       "provider_deployment_profile_version" = source."provider_deployment_profile_version",
       "runtime_profile_version" = source."runtime_profile_version",
       "catalogue_digest" = source."catalogue_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_provider_deployment_capabilities, '{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}')) AS source
 WHERE target."capability" = 'property_trends';--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_capabilities" ENABLE TRIGGER "ai_provider_deployment_capabilities_immutable";--> statement-breakpoint
DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.ai_operation_profiles
     WHERE (profile_version, artifact_attestations_digest, profile_digest) IN (
       ('review-analysis-v1', 'bab4c65fc804d23f1de614c8480524c28d67162e7db9bae85e15634ac7c4facb', '4bb7694a964f6ff2187a509bbc2bf69818fc41fc17c61bc5360fbedf1c65acfe'),
       ('reply-suggestion-v1', 'a2e0fff245e76e4c57cc495daccc6c3bc46c2ec98947e6f1efbae8773795f9d3', 'c83709f95797af21fd02cf18dd6a7eefa1f580eb325d6a0122ae31e8e2a724f3')
     )
  ) <> 2 THEN
    RAISE EXCEPTION 'AI operation profiles did not reach the bg-Cyrl language-catalogue re-pin';
  END IF;
  IF (
    SELECT count(*) FROM public.ai_runtime_capability_profiles
     WHERE notice_version = 'merchant-ai-notice-2026-08-19.v1'
       AND notice_digest = 'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31'
       AND catalogue_digest = '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
  ) <> 3 THEN
    RAISE EXCEPTION 'AI runtime capability profiles did not reach the re-versioned merchant notice';
  END IF;
  IF (
    SELECT count(*) FROM public.ai_provider_deployment_capabilities
     WHERE catalogue_digest = '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
  ) <> 3 THEN
    RAISE EXCEPTION 'AI provider deployment capabilities did not reach the rotated catalogue digest';
  END IF;
END $$;--> statement-breakpoint
-- The readiness assertion byte-compares the exact catalogue projection and
-- pins the runtime-capability catalogue digest, so re-pinning the rows above
-- without re-pinning the assertion makes every caller read "catalogue not
-- ready" and the whole AI plane fails closed.
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
    AND p_provider_deployment_profile_digest = 'c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501'
    AND p_runtime_capability_catalogue_digest = '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_provider_deployment_profiles AS row_value) = '[{"profile_version":"private-beta-global-v1","region":"global","provider":"openai","model_snapshot":"gpt-5.4-mini-2026-03-17","reasoning_effort":"route-profile-effort","service_tier":"default","store":false,"response_api_version":"responses-v1","deployment_contract":{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"in_memory","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"4b45167b560a5fa8fd8640127c4df6dcdde43be7693091726745e5e247c50da2","evidence":{"retrievalDate":"2026-08-15","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.4-mini","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"047243baef7a73dabf6a708aea2e66ae88102da3cc801d5893e91301155ffb06"},"pricing":{"catalogueId":"openai-gpt-5.4-mini-standard-2026-08-15","modelSnapshot":"gpt-5.4-mini-2026-03-17","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":750000,"cachedInputMicros":75000,"outputMicros":4500000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-15"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}},"profile_digest":"c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY version), '[]'::jsonb) FROM public.ai_routing_policies AS row_value) = '[{"version":1,"region":"global","provider_deployment_profile_version":"private-beta-global-v1","policy_digest":"8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"b4f443d021fd425076aa38ce0c7de7b26e6f6df0ceebdbe17856a8c14e29c813","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":8192,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"06633151a1b7c90b4247494e671cc2daa8aa73f68f4a64b6dc8149381085b97e"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_template_selection_v1","output_schema_digest":"8a5366b0c962d6aaa5280198911957456fa8a4b3e2501d8d02d7648ddd8177df","prompt_digest":"3d9ff8af03d9d9289db57ca29854a6daf0d337e1414c171d7e983648b0da75ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"3ed39117b80bfd90afa9b18a30f9c7406ce99bf709f32f5edb08829001c5a509","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"a2e0fff245e76e4c57cc495daccc6c3bc46c2ec98947e6f1efbae8773795f9d3","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":903,"static_token_bearing_digest":"1353194070405029cfb4e0d07d800ce92a6e4298264b305bb6cef7b64d69b02d","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":6144,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"c83709f95797af21fd02cf18dd6a7eefa1f580eb325d6a0122ae31e8e2a724f3"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"7ae4aabfc187f0c402bbb1d6e44012a0f19bcf31a89871c80d259878f82094ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"bab4c65fc804d23f1de614c8480524c28d67162e7db9bae85e15634ac7c4facb","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":1081,"static_token_bearing_digest":"70aea6dab74ccf1df331a42264c06120c0bedd509f7cdad3b05088a3c953b066","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":4096,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"4bb7694a964f6ff2187a509bbc2bf69818fc41fc17c61bc5360fbedf1c65acfe"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"7a89df76f972347487e8cc1ec29dd4a6bd606b27313bfbd642ff0f00c183002a","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"580a13229a6d75b4b0c9b31e5cec4b9669705b168519a995e96a2d26514f2ffe"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY runtime_profile_version), '[]'::jsonb) FROM public.ai_runtime_capability_profiles AS row_value) = '[{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY capability), '[]'::jsonb) FROM public.ai_provider_deployment_capabilities AS row_value) = '[{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_runtime_catalogue_ready_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF NOT public.assert_ai_runtime_catalogue_ready_v1(
    'private-beta-global-v1',
    'c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501',
    '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
  ) THEN
    RAISE EXCEPTION 'AI runtime catalogue readiness did not converge on the re-pinned contract';
  END IF;
END $$;--> statement-breakpoint
-- `assert_ai_capability_set_executable_v1` hard-pins the consent-notice
-- version/digest and the runtime-capability catalogue digest it resolves
-- against. Left on the retired notice it raises
-- `merchant_ai_runtime_mapping_unavailable` for every merchant enable/revoke
-- command, so it moves with the notice re-version. Same body as 0046 with the
-- notice and catalogue digest re-pinned.
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
DO $$
BEGIN
  IF public.assert_ai_capability_set_executable_v1(
    ARRAY['review_analysis', 'reply_drafting', 'property_trends']::text[],
    'merchant-ai-notice-2026-08-19.v1',
    'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31',
    'private-beta-global-v1'
  ) <> '{"review_analysis": "review-analysis-runtime-v1", "reply_drafting": "reply-drafting-runtime-v1", "property_trends": "property-trends-runtime-v1"}'::jsonb THEN
    RAISE EXCEPTION 'merchant AI capability-set authority did not converge on the re-versioned notice';
  END IF;
END $$;--> statement-breakpoint
-- `issue_ai_canary_authorization_v1` pins the deployment-membership catalogue
-- digest, so re-pinning the memberships above without re-pinning this guard
-- makes every canary issue return "not eligible" and no release can pass its
-- gate. Same body as 0057 with the catalogue digest moved.
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
        'c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501'
      AND provider_profile.provider = 'openai'
      AND provider_profile.model_snapshot = 'gpt-5.4-mini-2026-03-17'
  )
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_operation_profiles AS operation_profile
      WHERE operation_profile.profile_version = p_canary_profile_version
        AND operation_profile.profile_digest =
          '580a13229a6d75b4b0c9b31e5cec4b9669705b168519a995e96a2d26514f2ffe'
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
          '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
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
