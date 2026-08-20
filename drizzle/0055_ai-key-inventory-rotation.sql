ALTER TABLE "ai_property_calendar_authorities" DROP CONSTRAINT "ai_property_calendar_authorities_range_valid";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" DROP CONSTRAINT "ai_provider_profiles_contract_valid";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" DISABLE TRIGGER "ai_provider_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_routing_policies" DISABLE TRIGGER "ai_routing_policies_immutable";--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" DISABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_runtime_capability_profiles" DISABLE TRIGGER "ai_runtime_capability_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_capabilities" DISABLE TRIGGER "ai_provider_deployment_capabilities_immutable";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" DISABLE TRIGGER "ai_property_calendar_catalogues_immutable";--> statement-breakpoint
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
    OR v_authority.tested_postgres_major_versions <> ARRAY[16,17]::integer[]
    OR v_postgres_major NOT IN (16,17)
  THEN
    RETURN NULL;
  END IF;
  RETURN public.ai_property_local_date_v1(p_reviewed_at, p_timezone);
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_ai_property_local_date_v1"(timestamp with time zone, text, text) FROM PUBLIC;--> statement-breakpoint
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
  ARRAY[16,17],
  test_vectors,
  '2026-08-16T00:00:00Z'::timestamp with time zone
FROM calendar_vectors
ON CONFLICT ("profile_version") DO UPDATE SET
    "epoch_millis_function_name" = EXCLUDED."epoch_millis_function_name",
    "epoch_millis_function_digest" = EXCLUDED."epoch_millis_function_digest",
    "local_date_function_name" = EXCLUDED."local_date_function_name",
    "local_date_function_digest" = EXCLUDED."local_date_function_digest",
    "local_midnight_function_name" = EXCLUDED."local_midnight_function_name",
    "local_midnight_function_digest" = EXCLUDED."local_midnight_function_digest",
    "image_digest" = EXCLUDED."image_digest",
    "vector_digest" = EXCLUDED."vector_digest",
    "vector_count" = EXCLUDED."vector_count",
    "minimum_year" = EXCLUDED."minimum_year",
    "maximum_year" = EXCLUDED."maximum_year",
    "tested_postgres_major_versions" = EXCLUDED."tested_postgres_major_versions",
    "test_vectors" = EXCLUDED."test_vectors",
    "created_at" = EXCLUDED."created_at";
DO $$
BEGIN
  IF NOT public.assert_ai_property_calendar_authority_v1() THEN
    RAISE EXCEPTION 'property-calendar-v1 authority mismatch' USING ERRCODE = '22023';
  END IF;
END;
$$;--> statement-breakpoint
UPDATE "ai_provider_deployment_profiles" SET "region" = 'global', "provider" = 'openai', "model_snapshot" = 'gpt-5.6-luna', "reasoning_effort" = 'route-profile-effort', "service_tier" = 'default', "store" = false, "response_api_version" = 'responses-v1', "deployment_contract" = '{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"24h","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","evidence":{"retrievalDate":"2026-08-19","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.6-luna","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"pricing":{"catalogueId":"openai-gpt-5.6-luna-standard-2026-08-19","modelSnapshot":"gpt-5.6-luna","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":200000,"cachedInputMicros":20000,"outputMicros":1200000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-19"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}}'::jsonb, "profile_digest" = 'c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501' WHERE "profile_version" = 'private-beta-global-v1';--> statement-breakpoint
UPDATE "ai_routing_policies" SET "region" = 'global', "provider_deployment_profile_version" = 'private-beta-global-v1', "policy_digest" = '8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66' WHERE "version" = 1;--> statement-breakpoint
UPDATE "ai_operation_profiles" SET "command" = 'analysis', "capability" = 'review_analysis', "purpose" = 'ai.analyze', "source_route" = 'review-analysis', "gateway_path" = '/v1/review-analysis', "caller_role" = 'worker', "capability_runtime_profile_version" = 'review-analysis-runtime-v1', "provider_deployment_profile_version" = 'private-beta-global-v1', "output_schema_name" = 'review_analysis_v1', "output_schema_digest" = '6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a', "prompt_digest" = '7ae4aabfc187f0c402bbb1d6e44012a0f19bcf31a89871c80d259878f82094ca', "artifact_attestations" = '{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"24a40ff70877122ece7c7db0dcbc35c5a882eda1d9accfe8cbd829715bafbc03"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"}'::jsonb, "artifact_attestations_digest" = '2fc21e34bd725e5118b8de65f064b1ab1f07d7eac6eaa881b06edb2fccd35918', "sdk_request_shape_digest" = '6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850', "static_token_bearing_bytes" = 1081, "static_token_bearing_digest" = '70aea6dab74ccf1df331a42264c06120c0bedd509f7cdad3b05088a3c953b066', "source_byte_limit" = 16384, "provider_payload_byte_limit" = 16384, "prepared_request_byte_limit" = 65536, "response_byte_limit" = 131072, "max_output_tokens" = 4096, "provider_deadline_ms" = 60000, "request_deadline_ms" = 70000, "execution_lease_ms" = 120000, "profile_digest" = '46c0419e69de69aeee6a6bab40e59b1fac88b7e668e954a64be1dca8e3f918f1' WHERE "profile_version" = 'review-analysis-v1';--> statement-breakpoint
UPDATE "ai_operation_profiles" SET "command" = 'reply', "capability" = 'reply_drafting', "purpose" = 'ai.generate_reply', "source_route" = 'reply-suggestion', "gateway_path" = '/v1/reply-suggestion', "caller_role" = 'web', "capability_runtime_profile_version" = 'reply-drafting-runtime-v1', "provider_deployment_profile_version" = 'private-beta-global-v1', "output_schema_name" = 'reply_template_selection_v1', "output_schema_digest" = '8a5366b0c962d6aaa5280198911957456fa8a4b3e2501d8d02d7648ddd8177df', "prompt_digest" = '3d9ff8af03d9d9289db57ca29854a6daf0d337e1414c171d7e983648b0da75ca', "artifact_attestations" = '{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"24a40ff70877122ece7c7db0dcbc35c5a882eda1d9accfe8cbd829715bafbc03","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"e1a1873388c6d92a7fb2d91688c8267a0998d08076c6202ad0e612131dce012e","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"dc0e767cfe8aa4694e2b37870e1f9510fe1b56ed4eea0ed91af4655ea3404f33","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}}'::jsonb, "artifact_attestations_digest" = '931e669cc7b66467a0be971d247f73f5117020ba9ec4347be08d5ebf911d5c33', "sdk_request_shape_digest" = '6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850', "static_token_bearing_bytes" = 903, "static_token_bearing_digest" = '1353194070405029cfb4e0d07d800ce92a6e4298264b305bb6cef7b64d69b02d', "source_byte_limit" = 16384, "provider_payload_byte_limit" = 16384, "prepared_request_byte_limit" = 65536, "response_byte_limit" = 131072, "max_output_tokens" = 6144, "provider_deadline_ms" = 60000, "request_deadline_ms" = 70000, "execution_lease_ms" = 120000, "profile_digest" = '6aff0551cf951266b6c0551680544bfcc73044afc8d5392968782d3ab8408793' WHERE "profile_version" = 'reply-suggestion-v1';--> statement-breakpoint
UPDATE "ai_operation_profiles" SET "command" = 'trend', "capability" = 'property_trends', "purpose" = 'ai.detect_trends', "source_route" = 'property-trend', "gateway_path" = '/v1/property-trend', "caller_role" = 'worker', "capability_runtime_profile_version" = 'property-trends-runtime-v1', "provider_deployment_profile_version" = 'private-beta-global-v1', "output_schema_name" = 'property_trend_v1', "output_schema_digest" = 'f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776', "prompt_digest" = '30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64', "artifact_attestations" = '{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}}'::jsonb, "artifact_attestations_digest" = 'b4f443d021fd425076aa38ce0c7de7b26e6f6df0ceebdbe17856a8c14e29c813', "sdk_request_shape_digest" = '6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850', "static_token_bearing_bytes" = 890, "static_token_bearing_digest" = '980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601', "source_byte_limit" = 65536, "provider_payload_byte_limit" = 65536, "prepared_request_byte_limit" = 131072, "response_byte_limit" = 131072, "max_output_tokens" = 8192, "provider_deadline_ms" = 90000, "request_deadline_ms" = 100000, "execution_lease_ms" = 150000, "profile_digest" = '06633151a1b7c90b4247494e671cc2daa8aa73f68f4a64b6dc8149381085b97e' WHERE "profile_version" = 'property-trend-v1';--> statement-breakpoint
UPDATE "ai_operation_profiles" SET "command" = 'synthetic_canary', "capability" = NULL, "purpose" = 'ai.synthetic_canary', "source_route" = 'synthetic-canary', "gateway_path" = 'internal:synthetic-canary', "caller_role" = 'release_canary', "capability_runtime_profile_version" = NULL, "provider_deployment_profile_version" = 'private-beta-global-v1', "output_schema_name" = 'synthetic_canary_v1', "output_schema_digest" = '9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7', "prompt_digest" = '28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a', "artifact_attestations" = '{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}}'::jsonb, "artifact_attestations_digest" = '7a89df76f972347487e8cc1ec29dd4a6bd606b27313bfbd642ff0f00c183002a', "sdk_request_shape_digest" = '6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850', "static_token_bearing_bytes" = 419, "static_token_bearing_digest" = '11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4', "source_byte_limit" = 16384, "provider_payload_byte_limit" = 16384, "prepared_request_byte_limit" = 65536, "response_byte_limit" = 131072, "max_output_tokens" = 2048, "provider_deadline_ms" = 60000, "request_deadline_ms" = 70000, "execution_lease_ms" = 120000, "profile_digest" = '580a13229a6d75b4b0c9b31e5cec4b9669705b168519a995e96a2d26514f2ffe' WHERE "profile_version" = 'synthetic-canary-v1';--> statement-breakpoint
UPDATE "ai_runtime_capability_profiles" SET "capability" = 'review_analysis', "purpose" = 'ai.analyze', "source_route" = 'review-analysis', "gateway_path" = '/v1/review-analysis', "gateway_profile_version" = 'review-analysis-gateway-v1', "caller" = 'worker', "operation_profile_version" = 'review-analysis-v1', "provider_deployment_profile_version" = 'private-beta-global-v1', "notice_version" = 'merchant-ai-notice-2026-08-15.v1', "notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b', "catalogue_digest" = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5' WHERE "runtime_profile_version" = 'review-analysis-runtime-v1';--> statement-breakpoint
UPDATE "ai_runtime_capability_profiles" SET "capability" = 'reply_drafting', "purpose" = 'ai.generate_reply', "source_route" = 'reply-suggestion', "gateway_path" = '/v1/reply-suggestion', "gateway_profile_version" = 'reply-suggestion-gateway-v1', "caller" = 'web', "operation_profile_version" = 'reply-suggestion-v1', "provider_deployment_profile_version" = 'private-beta-global-v1', "notice_version" = 'merchant-ai-notice-2026-08-15.v1', "notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b', "catalogue_digest" = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5' WHERE "runtime_profile_version" = 'reply-drafting-runtime-v1';--> statement-breakpoint
UPDATE "ai_runtime_capability_profiles" SET "capability" = 'property_trends', "purpose" = 'ai.detect_trends', "source_route" = 'property-trend', "gateway_path" = '/v1/property-trend', "gateway_profile_version" = 'property-trend-gateway-v1', "caller" = 'worker', "operation_profile_version" = 'property-trend-v1', "provider_deployment_profile_version" = 'private-beta-global-v1', "notice_version" = 'merchant-ai-notice-2026-08-15.v1', "notice_digest" = '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b', "catalogue_digest" = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5' WHERE "runtime_profile_version" = 'property-trends-runtime-v1';--> statement-breakpoint
UPDATE "ai_provider_deployment_capabilities" SET "runtime_profile_version" = 'review-analysis-runtime-v1', "catalogue_digest" = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5' WHERE "provider_deployment_profile_version" = 'private-beta-global-v1' AND "capability" = 'review_analysis';--> statement-breakpoint
UPDATE "ai_provider_deployment_capabilities" SET "runtime_profile_version" = 'reply-drafting-runtime-v1', "catalogue_digest" = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5' WHERE "provider_deployment_profile_version" = 'private-beta-global-v1' AND "capability" = 'reply_drafting';--> statement-breakpoint
UPDATE "ai_provider_deployment_capabilities" SET "runtime_profile_version" = 'property-trends-runtime-v1', "catalogue_digest" = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5' WHERE "provider_deployment_profile_version" = 'private-beta-global-v1' AND "capability" = 'property_trends';--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT count(*) FROM "ai_provider_deployment_profiles") <> 1
    OR (SELECT count(*) FROM "ai_routing_policies") <> 1
    OR (SELECT count(*) FROM "ai_operation_profiles") <> 4
    OR (SELECT count(*) FROM "ai_runtime_capability_profiles") <> 3
    OR (SELECT count(*) FROM "ai_provider_deployment_capabilities") <> 3
  THEN
    RAISE EXCEPTION 'AI runtime catalogue upgrade requires the complete v1 catalogue';
  END IF;
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
    AND p_provider_deployment_profile_digest = 'c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501'
    AND p_runtime_capability_catalogue_digest = '902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5'
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_provider_deployment_profiles AS row_value) = '[{"profile_version":"private-beta-global-v1","region":"global","provider":"openai","model_snapshot":"gpt-5.4-mini-2026-03-17","reasoning_effort":"route-profile-effort","service_tier":"default","store":false,"response_api_version":"responses-v1","deployment_contract":{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"in_memory","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","evidence":{"retrievalDate":"2026-08-15","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.4-mini","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"047243baef7a73dabf6a708aea2e66ae88102da3cc801d5893e91301155ffb06"},"pricing":{"catalogueId":"openai-gpt-5.4-mini-standard-2026-08-15","modelSnapshot":"gpt-5.4-mini-2026-03-17","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":750000,"cachedInputMicros":75000,"outputMicros":4500000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-15"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}},"profile_digest":"c362776c6ae85ed4825717cab18ee842e77292031e25c012e1abc6b26f79a501"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY version), '[]'::jsonb) FROM public.ai_routing_policies AS row_value) = '[{"version":1,"region":"global","provider_deployment_profile_version":"private-beta-global-v1","policy_digest":"8e464f1cff54fca49124bca418420d913088ccd675610149ef679bb4b2e83d66"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"b4f443d021fd425076aa38ce0c7de7b26e6f6df0ceebdbe17856a8c14e29c813","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":8192,"provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"06633151a1b7c90b4247494e671cc2daa8aa73f68f4a64b6dc8149381085b97e"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_template_selection_v1","output_schema_digest":"8a5366b0c962d6aaa5280198911957456fa8a4b3e2501d8d02d7648ddd8177df","prompt_digest":"3d9ff8af03d9d9289db57ca29854a6daf0d337e1414c171d7e983648b0da75ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"24a40ff70877122ece7c7db0dcbc35c5a882eda1d9accfe8cbd829715bafbc03","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"e1a1873388c6d92a7fb2d91688c8267a0998d08076c6202ad0e612131dce012e","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"dc0e767cfe8aa4694e2b37870e1f9510fe1b56ed4eea0ed91af4655ea3404f33","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"931e669cc7b66467a0be971d247f73f5117020ba9ec4347be08d5ebf911d5c33","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":903,"static_token_bearing_digest":"1353194070405029cfb4e0d07d800ce92a6e4298264b305bb6cef7b64d69b02d","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":6144,"provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"6aff0551cf951266b6c0551680544bfcc73044afc8d5392968782d3ab8408793"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"7ae4aabfc187f0c402bbb1d6e44012a0f19bcf31a89871c80d259878f82094ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"24a40ff70877122ece7c7db0dcbc35c5a882eda1d9accfe8cbd829715bafbc03"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"2fc21e34bd725e5118b8de65f064b1ab1f07d7eac6eaa881b06edb2fccd35918","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":1081,"static_token_bearing_digest":"70aea6dab74ccf1df331a42264c06120c0bedd509f7cdad3b05088a3c953b066","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":4096,"provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"46c0419e69de69aeee6a6bab40e59b1fac88b7e668e954a64be1dca8e3f918f1"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"7a89df76f972347487e8cc1ec29dd4a6bd606b27313bfbd642ff0f00c183002a","sdk_request_shape_digest":"6cb8b52a100a40f6564a7e48c97f0b7a145e630771bdaf1bc21024150b9f4850","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":2048,"provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"580a13229a6d75b4b0c9b31e5cec4b9669705b168519a995e96a2d26514f2ffe"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY runtime_profile_version), '[]'::jsonb) FROM public.ai_runtime_capability_profiles AS row_value) = '[{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-15.v1","notice_digest":"4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b","catalogue_digest":"902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5"},{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-15.v1","notice_digest":"4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b","catalogue_digest":"902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5"},{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-15.v1","notice_digest":"4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b","catalogue_digest":"902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY capability), '[]'::jsonb) FROM public.ai_provider_deployment_capabilities AS row_value) = '[{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"902c965d2ebe684bd7915a13c9c9eab9574358404652e81508bd00c6d7c80bd5"}]'::jsonb;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_runtime_catalogue_ready_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
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
) FROM PUBLIC;--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_capabilities" ENABLE TRIGGER "ai_provider_deployment_capabilities_immutable";--> statement-breakpoint
ALTER TABLE "ai_runtime_capability_profiles" ENABLE TRIGGER "ai_runtime_capability_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" ENABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_routing_policies" ENABLE TRIGGER "ai_routing_policies_immutable";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" ENABLE TRIGGER "ai_provider_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" ENABLE TRIGGER "ai_property_calendar_catalogues_immutable";--> statement-breakpoint
ALTER TABLE "ai_property_calendar_authorities" ADD CONSTRAINT "ai_property_calendar_authorities_range_valid" CHECK ("ai_property_calendar_authorities"."vector_count" = 10 AND "ai_property_calendar_authorities"."minimum_year" = 1970 AND "ai_property_calendar_authorities"."maximum_year" = 2100 AND "ai_property_calendar_authorities"."tested_postgres_major_versions" = ARRAY[16,17]::integer[] AND jsonb_typeof("ai_property_calendar_authorities"."test_vectors") = 'array' AND jsonb_array_length("ai_property_calendar_authorities"."test_vectors") = "ai_property_calendar_authorities"."vector_count");--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" ADD CONSTRAINT "ai_provider_profiles_contract_valid" CHECK (jsonb_typeof("ai_provider_deployment_profiles"."deployment_contract") = 'object'
        AND "ai_provider_deployment_profiles"."deployment_contract" = '{"tools": "empty_array","stream": false,"pricing": {"sourceUrl": "https://developers.openai.com/api/docs/pricing","unitTokens": 1000000,"catalogueId": "openai-gpt-5.6-luna-standard-2026-08-19","serviceTier": "default","outputMicros": 1200000,"modelSnapshot": "gpt-5.6-luna","retrievalDate": "2026-08-19","cachedInputMicros": 20000,"uncachedInputMicros": 200000},"runtime": {"nodeImage": "node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","icuVersion": "78.2","nodeVersion": "22.23.2","unicodeVersion": "17.0"},"endpoint": "https://api.openai.com/v1/responses","evidence": {"retrievalDate": "2026-08-19","primarySources": {"sdk": "https://github.com/openai/openai-node/tree/v7.4.0","model": "https://developers.openai.com/api/docs/models/gpt-5.6-luna","pricing": "https://developers.openai.com/api/docs/pricing","responses": "https://developers.openai.com/api/reference/resources/responses","apiOverview": "https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls": "https://developers.openai.com/api/docs/guides/your-data","promptCaching": "https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers": "https://developers.openai.com/api/docs/guides/safety-best-practices","structuredOutputs": "https://developers.openai.com/api/docs/guides/structured-outputs"},"normalizedClaimsDigest": "a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"metadata": "absent","background": false,"sdkVersion": "7.4.0","truncation": "disabled","conversation": "absent","keyInventory": {"provenance": {"activeKid": "provenance-v1","publicKeyDigest": "dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration": 1,"maximumPrivateKeysPerProcess": 1},"requestBinding": {"activeVersion": "request-v1","retainedVersions": [],"keyringGeneration": 1,"maximumConfiguredKeys": 2},"admissionSigning": {"activeKid": "admission-v1","retainedKids": [],"publicKeyDigests": {"admission-v1": "a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration": 1,"maximumConfiguredKeys": 2},"safetyIdentifier": {"activeVersion": "safety-v1","keyringGeneration": 1,"maximumConfiguredKeys": 1}},"redirectMode": "manual_no_follow","sdkMaxRetries": 0,"successStatus": 200,"promptCacheMode": "automatic_prefix_16_shards","providerFallback": "none","dispatcherVersion": "undici@8.10.0","retryAfterProfile": "delta-seconds-1-to-300-v1","previousResponseId": "absent","promptCacheOptions": "absent","requestShapeDigest": "69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","serviceDrainSeconds": 130,"promptCacheRetention": "24h","promptCacheBreakpoint": "absent","clientRequestIdProfile": "openai-client-request-id-v1","providerIdempotencyMode": "none","successMediaTypeProfile": "application-json-utf8-v1","maxHttpRequestsPerPermit": 1,"possibleDispatchBoundary": "outbound_fetch_invocation","statusDispositionProfile": "openai-status-disposition-v1","handlerDrainTimeoutMillis": 115000,"retryableCompleteStatuses": [429,500,502,503,504],"gatewayRequestTimeoutMillis": 115000}'::jsonb);--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = 'e13b058c85d3afe87c8406a17572d0bc58f15cf8f1a53cc13a79b6828be124ad' WHERE "created_at" = 1786900001000;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '2c9b2832d6dfca8f57457b8e35e6a081cc07a9879d3d05e45019f47e0bd18039' WHERE "created_at" = 1786900003000;