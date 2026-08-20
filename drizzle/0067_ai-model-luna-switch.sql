-- Switch the pinned provider model from `gpt-5.4-mini-2026-03-17` to
-- `gpt-5.6-luna` at the same `low` per-route reasoning effort 0066 established.
--
-- Three things move together, and none of them can move alone.
--
-- 1. The model snapshot. It is a field of the shared request shape, so moving it
--    moves `sdk_request_shape_digest`
--    (4b45167b -> 69d4c821), which is embedded in every operation
--    profile's `artifact_attestations.sdk` and in the provider
--    `deployment_contract`. All four `artifact_attestations` blobs, their
--    digests, all four operation `profile_digest`s and the provider
--    `profile_digest` (3988c11f -> f15b8133) move with it.
--
-- 2. Prompt cache retention `in_memory` -> `24h`. This is not a preference: the
--    deployment rejects the old value outright with HTTP 400
--    "This model is compatible only with 24h extended prompt caching".
--    A retention the wire refuses must not be storable, so the contract carries
--    the value the provider will actually accept.
--
-- 3. Price. Every tier drops 3.75x -- uncached input 750000 -> 200000 micros per
--    million tokens, cached input 75000 -> 20000, output 4500000 -> 1200000 --
--    against a re-retrieved catalogue (`openai-gpt-5.4-mini-standard-2026-08-15`
--    -> `openai-gpt-5.6-luna-standard-2026-08-19`, retrieved
--    2026-08-19), which also moves the normalized evidence claims
--    digest (047243ba -> a6c41316).
--
-- `admit_ai_property_v1` hardcoded the OLD per-million micros. The web computes
-- `maximumCostMicros` from the compiled catalogue and the database recomputes it
-- independently; leaving the constants stale would make the two disagree on
-- every route and deny every operation `source_mismatch`. Reply route, worked:
-- floor(((906 + 256) * 200000 + 1024 * 1200000 + 999999) / 1000000) = 1462, which
-- is what the compiled `maximumCostMicros` now returns for that profile.
--
-- `settle_ai_execution_v1` pinned the model snapshot it wrote onto a settled
-- canary attempt as a literal, so it would have recorded a model the call did not
-- use -- a false entry in exactly the artifact an audit trusts. It now reads
-- `ai_provider_deployment_profiles.model_snapshot` for the profile version the
-- operation already names, in the same profile read that already fetches pricing:
-- no extra statement, no extra lock, and no pin site left to go stale on the next
-- model switch. The tenant path was never affected -- it records the model the
-- provider reported in its response.
--
-- Reply provenance now parses the snapshot against a known-snapshot set
-- (`OPENAI_KNOWN_MODEL_SNAPSHOTS`) rather than a single literal, so drafts already
-- persisted under `gpt-5.4-mini-2026-03-17` stay verifiable after this migration.
--
-- Fresh databases get all of this from the unshipped 0046 seed (whose file hash is
-- restamped at the end, as in 0055/0065/0066); this migration is the forward fix
-- for an already-migrated one. Same trigger-disable ceremony as
-- 0050/0055/0057/0062/0065/0066, because both catalogues are immutable by trigger.--> statement-breakpoint
-- An already-migrated database still carries `CHECK (model_snapshot =
-- 'gpt-5.4-mini-2026-03-17')` and the old deployment contract literal, either of
-- which would reject the row update below. A migrate from empty cannot surface
-- this: the edited 0046 already creates both constraints with the new literals,
-- so only the incremental path ever sees the old ones.--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" DROP CONSTRAINT IF EXISTS "ai_provider_profiles_model_valid";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" DROP CONSTRAINT IF EXISTS "ai_provider_profiles_contract_valid";--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" DISABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" DISABLE TRIGGER "ai_provider_profiles_immutable";--> statement-breakpoint
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
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"7ae4aabfc187f0c402bbb1d6e44012a0f19bcf31a89871c80d259878f82094ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"1fc168bae40d57907ffd1fa4a92f36a87db79f9f1d70e831682b3fab1082ac25","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1081,"static_token_bearing_digest":"70aea6dab74ccf1df331a42264c06120c0bedd509f7cdad3b05088a3c953b066","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"97eef38b0b6186a6dfeae9b56047574cb677c103d917e7eabb8f5104b192e04f"}')) AS source
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
       "reasoning_effort" = source."reasoning_effort",
       "provider_deadline_ms" = source."provider_deadline_ms",
       "request_deadline_ms" = source."request_deadline_ms",
       "execution_lease_ms" = source."execution_lease_ms",
       "profile_digest" = source."profile_digest"
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_template_selection_v1","output_schema_digest":"d123646236e874e901bdd6706f98a3e607fe5f27d41318190efed543d27ba0cc","prompt_digest":"3d9ff8af03d9d9289db57ca29854a6daf0d337e1414c171d7e983648b0da75ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"3ed39117b80bfd90afa9b18a30f9c7406ce99bf709f32f5edb08829001c5a509","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"5a58659a96b62a552eb8e28f19a418b4fa2a9a441739b1dbb97b790ffd8894e3","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":906,"static_token_bearing_digest":"d31a938abc533fe9459a22d2c84d9f428a2497962106a97deeb4d6594e14c7f2","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"e0a41c9ae285962255b1ace77bddf9a49bf8258e35b40e7d88888eb60f879974"}')) AS source
 WHERE target."profile_version" = 'reply-suggestion-v1';--> statement-breakpoint
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
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72"}')) AS source
 WHERE target."profile_version" = 'property-trend-v1';--> statement-breakpoint
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
  FROM (SELECT * FROM jsonb_populate_record(NULL::public.ai_operation_profiles, '{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":512,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7"}')) AS source
 WHERE target."profile_version" = 'synthetic-canary-v1';--> statement-breakpoint
UPDATE "ai_provider_deployment_profiles"
   SET "model_snapshot" = 'gpt-5.6-luna',
       "deployment_contract" = '{"sdkVersion":"7.4.0","dispatcherVersion":"undici@8.10.0","runtime":{"nodeImage":"node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","nodeVersion":"22.23.2","icuVersion":"78.2","unicodeVersion":"17.0"},"endpoint":"https://api.openai.com/v1/responses","promptCacheRetention":"24h","promptCacheMode":"automatic_prefix_16_shards","promptCacheOptions":"absent","promptCacheBreakpoint":"absent","truncation":"disabled","tools":"empty_array","metadata":"absent","conversation":"absent","previousResponseId":"absent","stream":false,"background":false,"providerFallback":"none","providerIdempotencyMode":"none","sdkMaxRetries":0,"maxHttpRequestsPerPermit":1,"possibleDispatchBoundary":"outbound_fetch_invocation","redirectMode":"manual_no_follow","successStatus":200,"successMediaTypeProfile":"application-json-utf8-v1","clientRequestIdProfile":"openai-client-request-id-v1","retryAfterProfile":"delta-seconds-1-to-300-v1","statusDispositionProfile":"openai-status-disposition-v1","retryableCompleteStatuses":[429,500,502,503,504],"serviceDrainSeconds":130,"handlerDrainTimeoutMillis":115000,"gatewayRequestTimeoutMillis":115000,"requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","evidence":{"retrievalDate":"2026-08-19","primarySources":{"model":"https://developers.openai.com/api/docs/models/gpt-5.6-luna","structuredOutputs":"https://developers.openai.com/api/docs/guides/structured-outputs","responses":"https://developers.openai.com/api/reference/resources/responses","apiOverview":"https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls":"https://developers.openai.com/api/docs/guides/your-data","promptCaching":"https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers":"https://developers.openai.com/api/docs/guides/safety-best-practices","pricing":"https://developers.openai.com/api/docs/pricing","sdk":"https://github.com/openai/openai-node/tree/v7.4.0"},"normalizedClaimsDigest":"a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"pricing":{"catalogueId":"openai-gpt-5.6-luna-standard-2026-08-19","modelSnapshot":"gpt-5.6-luna","serviceTier":"default","unitTokens":1000000,"uncachedInputMicros":200000,"cachedInputMicros":20000,"outputMicros":1200000,"sourceUrl":"https://developers.openai.com/api/docs/pricing","retrievalDate":"2026-08-19"},"keyInventory":{"requestBinding":{"activeVersion":"request-v1","retainedVersions":[],"keyringGeneration":1,"maximumConfiguredKeys":2},"safetyIdentifier":{"activeVersion":"safety-v1","keyringGeneration":1,"maximumConfiguredKeys":1},"provenance":{"activeKid":"provenance-v1","publicKeyDigest":"dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration":1,"maximumPrivateKeysPerProcess":1},"admissionSigning":{"activeKid":"admission-v1","retainedKids":[],"publicKeyDigests":{"admission-v1":"a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration":1,"maximumConfiguredKeys":2}}}'::jsonb,
       "profile_digest" = 'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90'
 WHERE "profile_version" = 'private-beta-global-v1';--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" ENABLE TRIGGER "ai_provider_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_operation_profiles" ENABLE TRIGGER "ai_operation_profiles_immutable";--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" ADD CONSTRAINT "ai_provider_profiles_model_valid" CHECK ("ai_provider_deployment_profiles"."model_snapshot" = 'gpt-5.6-luna');--> statement-breakpoint
ALTER TABLE "ai_provider_deployment_profiles" ADD CONSTRAINT "ai_provider_profiles_contract_valid" CHECK (jsonb_typeof("ai_provider_deployment_profiles"."deployment_contract") = 'object'
        AND "ai_provider_deployment_profiles"."deployment_contract" = '{"tools": "empty_array","stream": false,"pricing": {"sourceUrl": "https://developers.openai.com/api/docs/pricing","unitTokens": 1000000,"catalogueId": "openai-gpt-5.6-luna-standard-2026-08-19","serviceTier": "default","outputMicros": 1200000,"modelSnapshot": "gpt-5.6-luna","retrievalDate": "2026-08-19","cachedInputMicros": 20000,"uncachedInputMicros": 200000},"runtime": {"nodeImage": "node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46","icuVersion": "78.2","nodeVersion": "22.23.2","unicodeVersion": "17.0"},"endpoint": "https://api.openai.com/v1/responses","evidence": {"retrievalDate": "2026-08-19","primarySources": {"sdk": "https://github.com/openai/openai-node/tree/v7.4.0","model": "https://developers.openai.com/api/docs/models/gpt-5.6-luna","pricing": "https://developers.openai.com/api/docs/pricing","responses": "https://developers.openai.com/api/reference/resources/responses","apiOverview": "https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id","dataControls": "https://developers.openai.com/api/docs/guides/your-data","promptCaching": "https://developers.openai.com/api/docs/guides/prompt-caching","safetyIdentifiers": "https://developers.openai.com/api/docs/guides/safety-best-practices","structuredOutputs": "https://developers.openai.com/api/docs/guides/structured-outputs"},"normalizedClaimsDigest": "a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9"},"metadata": "absent","background": false,"sdkVersion": "7.4.0","truncation": "disabled","conversation": "absent","keyInventory": {"provenance": {"activeKid": "provenance-v1","publicKeyDigest": "dbc930d7982f42eeae818aff4d8a8096fcc4aa7f51ed32e18cc7d8b8834e6842","keyringGeneration": 1,"maximumPrivateKeysPerProcess": 1},"requestBinding": {"activeVersion": "request-v1","retainedVersions": [],"keyringGeneration": 1,"maximumConfiguredKeys": 2},"admissionSigning": {"activeKid": "admission-v1","retainedKids": [],"publicKeyDigests": {"admission-v1": "a57e62482c9eb0e88df509cd9dddbd5f520ae85f77214d919878e3cdb531de5f"},"keyringGeneration": 1,"maximumConfiguredKeys": 2},"safetyIdentifier": {"activeVersion": "safety-v1","keyringGeneration": 1,"maximumConfiguredKeys": 1}},"redirectMode": "manual_no_follow","sdkMaxRetries": 0,"successStatus": 200,"promptCacheMode": "automatic_prefix_16_shards","providerFallback": "none","dispatcherVersion": "undici@8.10.0","retryAfterProfile": "delta-seconds-1-to-300-v1","previousResponseId": "absent","promptCacheOptions": "absent","requestShapeDigest": "69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","serviceDrainSeconds": 130,"promptCacheRetention": "24h","promptCacheBreakpoint": "absent","clientRequestIdProfile": "openai-client-request-id-v1","providerIdempotencyMode": "none","successMediaTypeProfile": "application-json-utf8-v1","maxHttpRequestsPerPermit": 1,"possibleDispatchBoundary": "outbound_fetch_invocation","statusDispositionProfile": "openai-status-disposition-v1","handlerDrainTimeoutMillis": 115000,"retryableCompleteStatuses": [429,500,502,503,504],"gatewayRequestTimeoutMillis": 115000}'::jsonb);--> statement-breakpoint
DO $$
BEGIN
  IF (
    SELECT count(*) FROM public.ai_operation_profiles
     WHERE (profile_version, max_output_tokens, reasoning_effort, sdk_request_shape_digest, artifact_attestations_digest, profile_digest) IN (
       ('review-analysis-v1', 1024, 'low', '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd', '1fc168bae40d57907ffd1fa4a92f36a87db79f9f1d70e831682b3fab1082ac25', '97eef38b0b6186a6dfeae9b56047574cb677c103d917e7eabb8f5104b192e04f'),
       ('reply-suggestion-v1', 1024, 'low', '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd', '5a58659a96b62a552eb8e28f19a418b4fa2a9a441739b1dbb97b790ffd8894e3', 'e0a41c9ae285962255b1ace77bddf9a49bf8258e35b40e7d88888eb60f879974'),
       ('property-trend-v1', 2048, 'low', '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd', '93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078', '501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72'),
       ('synthetic-canary-v1', 512, 'low', '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd', 'e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097', '71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7')
     )
  ) <> 4 THEN
    RAISE EXCEPTION 'AI operation profiles did not reach the gpt-5.6-luna re-pin';
  END IF;
  IF (
    SELECT count(*) FROM public.ai_provider_deployment_profiles
     WHERE profile_version = 'private-beta-global-v1'
       AND model_snapshot = 'gpt-5.6-luna'
       AND profile_digest = 'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90'
       AND deployment_contract ->> 'requestShapeDigest' = '69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd'
       AND deployment_contract ->> 'promptCacheRetention' = '24h'
       AND (deployment_contract #>> '{pricing,uncachedInputMicros}')::bigint = 200000
       AND (deployment_contract #>> '{pricing,outputMicros}')::bigint = 1200000
  ) <> 1 THEN
    RAISE EXCEPTION 'provider deployment profile did not reach the gpt-5.6-luna re-pin';
  END IF;
END $$;--> statement-breakpoint
-- `admit_ai_property_v1` recomputes the maximum admissible cost from per-million
-- micros held as literals. Same body as 0064 with only those two constants moved
-- to the re-retrieved catalogue price; leaving them would deny every operation
-- `source_mismatch` against the web`s independently computed ceiling.
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
    OR p_descriptor->'binding' IS DISTINCT FROM jsonb_build_object(
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
-- `settle_ai_execution_v1` wrote the settled canary attempt`s model snapshot from
-- a literal. Same body as 0049 with the literal replaced by
-- `ai_provider_deployment_profiles.model_snapshot`, read in the profile lookup the
-- function already performs for pricing -- the attempt now records the model the
-- catalogue actually pins instead of one a past migration happened to name.
CREATE OR REPLACE FUNCTION "settle_ai_execution_v1"(
  p_request jsonb,
  p_receipt_kid varchar
)
RETURNS TABLE (
  status text,
  code text,
  grant_kid text,
  request_binding_hmac text,
  disposition text,
  usage_known boolean,
  provider_retryable boolean,
  input_tokens integer,
  cached_input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  cost_micros bigint,
  settled_at_epoch_millis bigint,
  settlement_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  permit_row ai_execution_permits%ROWTYPE;
  reservation_row ai_admission_cost_reservations%ROWTYPE;
  existing_row ai_execution_permit_settlements%ROWTYPE;
  operation_row ai_operations%ROWTYPE;
  circuit_row ai_provider_circuit_states%ROWTYPE;
  permit_id_value uuid;
  operation_id_value uuid;
  attempt_value integer;
  input_value integer;
  cached_input_value integer;
  output_value integer;
  reasoning_value integer;
  usage_known_value boolean;
  cost_value bigint;
  disposition_value text;
  reported_disposition_value text;
  provider_retryable_value boolean;
  price_unit_tokens bigint;
  uncached_input_price_micros bigint;
  cached_input_price_micros bigint;
  output_price_micros bigint;
  model_snapshot_value text;
  state_value text;
  expected_cost bigint;
  now_value timestamp with time zone := clock_timestamp();
  now_millis bigint;
BEGIN
  IF p_receipt_kid !~ '^[a-z][a-z0-9_-]{0,31}$' THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  BEGIN
    permit_id_value := (p_request->>'permitId')::uuid;
    operation_id_value := (p_request->>'operationId')::uuid;
    attempt_value := (p_request->>'attemptNumber')::integer;
    input_value := (p_request->>'inputTokens')::integer;
    cached_input_value := (p_request->>'cachedInputTokens')::integer;
    output_value := (p_request->>'outputTokens')::integer;
    reasoning_value := (p_request->>'reasoningTokens')::integer;
    IF jsonb_typeof(p_request->'usageKnown') <> 'boolean' THEN
      RAISE EXCEPTION 'usageKnown must be boolean';
    END IF;
    usage_known_value := (p_request->>'usageKnown')::boolean;
    disposition_value := p_request->>'disposition';
    reported_disposition_value := p_request->>'reportedDisposition';
    IF jsonb_typeof(p_request->'providerRetryable') <> 'boolean' THEN
      RAISE EXCEPTION 'providerRetryable must be boolean';
    END IF;
    provider_retryable_value := (p_request->>'providerRetryable')::boolean;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END;
  BEGIN
    SELECT
      (profile.deployment_contract #>> '{pricing,unitTokens}')::bigint,
      (profile.deployment_contract #>> '{pricing,uncachedInputMicros}')::bigint,
      (profile.deployment_contract #>> '{pricing,cachedInputMicros}')::bigint,
      (profile.deployment_contract #>> '{pricing,outputMicros}')::bigint,
      profile.model_snapshot::text
    INTO STRICT
      price_unit_tokens,
      uncached_input_price_micros,
      cached_input_price_micros,
      output_price_micros,
      model_snapshot_value
    FROM ai_operations AS operation
    JOIN ai_provider_deployment_profiles AS profile
      ON profile.profile_version =
        operation.provider_deployment_profile_version
    WHERE operation.id = operation_id_value;
  EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END;
  IF price_unit_tokens <= 0
    OR uncached_input_price_micros < 0
    OR cached_input_price_micros < 0
    OR output_price_micros < 0
  THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  state_value := CASE
    WHEN disposition_value IN ('no_dispatch', 'source_stale', 'policy_denied')
      THEN 'released'
    WHEN disposition_value = 'transport_ambiguous' THEN 'ambiguous'
    ELSE 'settled'
  END;
  expected_cost := (
    ((input_value - cached_input_value)::bigint * uncached_input_price_micros)
    + (cached_input_value::bigint * cached_input_price_micros)
    + (output_value::bigint * output_price_micros)
    + price_unit_tokens - 1
  ) / price_unit_tokens;
  IF attempt_value NOT BETWEEN 1 AND 4
    OR input_value < 0
    OR cached_input_value NOT BETWEEN 0 AND input_value
    OR output_value < 0
    OR reasoning_value NOT BETWEEN 0 AND output_value
    OR (
      NOT usage_known_value
      AND (
        input_value <> 0 OR cached_input_value <> 0 OR output_value <> 0
        OR reasoning_value <> 0
      )
    )
    OR (disposition_value = 'success' AND NOT usage_known_value)
    OR (state_value = 'released' AND usage_known_value)
  THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('05:permit:' || permit_id_value::text, 0)
  );
  SELECT * INTO permit_row
  FROM ai_execution_permits
  WHERE id = permit_id_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied', 'permit_unknown', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF permit_row.operation_id <> operation_id_value
    OR permit_row.execution_attempt <> attempt_value
    OR permit_row.nonce <> p_request->>'nonce'
  THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF permit_row.grant_kid <> p_receipt_kid THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  cost_value := CASE
    WHEN state_value = 'released' THEN 0
    WHEN usage_known_value THEN expected_cost
    ELSE permit_row.maximum_cost_micros
  END;

  SELECT * INTO existing_row
  FROM ai_execution_permit_settlements
  WHERE permit_id = permit_id_value;
  IF FOUND THEN
    IF existing_row.disposition <> disposition_value
      OR existing_row.reported_disposition <> reported_disposition_value
      OR existing_row.provider_retryable <> provider_retryable_value
      OR existing_row.usage_known <> usage_known_value
      OR existing_row.input_tokens <> input_value
      OR existing_row.cached_input_tokens <> cached_input_value
      OR existing_row.output_tokens <> output_value
      OR existing_row.reasoning_tokens <> reasoning_value
      OR existing_row.cost_micros <> cost_value
      OR existing_row.retry_after_seconds IS DISTINCT FROM
        NULLIF(p_request->>'retryAfterSeconds', '')::integer
    THEN
      RETURN QUERY SELECT 'denied', 'settlement_conflict', NULL::text, NULL::text,
        NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
        NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'settled', NULL::text, existing_row.grant_kid::text,
      existing_row.request_binding_hmac::text, existing_row.disposition::text,
      existing_row.usage_known, existing_row.provider_retryable,
      existing_row.input_tokens, existing_row.cached_input_tokens,
      existing_row.output_tokens, existing_row.reasoning_tokens,
      existing_row.cost_micros,
      floor(extract(epoch FROM existing_row.settled_at) * 1000)::bigint,
      existing_row.settlement_state::text;
    RETURN;
  END IF;

  IF permit_row.state <> 'consumed' THEN
    RETURN QUERY SELECT 'denied', 'permit_not_consumed', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;
  IF cost_value > permit_row.maximum_cost_micros THEN
    RETURN QUERY SELECT 'denied', 'permit_mismatch', NULL::text, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::integer,
      NULL::integer, NULL::integer, NULL::bigint, NULL::bigint, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO STRICT reservation_row
  FROM ai_admission_cost_reservations
  WHERE permit_id = permit_id_value
  FOR UPDATE;
  SELECT * INTO STRICT operation_row
  FROM ai_operations
  WHERE id = permit_row.operation_id
  FOR UPDATE;
  SELECT * INTO STRICT circuit_row
  FROM ai_provider_circuit_states
  WHERE provider_deployment_profile_version =
    operation_row.provider_deployment_profile_version
  FOR UPDATE;
  now_millis := floor(extract(epoch FROM now_value) * 1000)::bigint;

  INSERT INTO ai_execution_permit_settlements (
    permit_id, terminal_state, settled_at, grant_kid,
    request_binding_hmac, nonce, disposition, reported_disposition,
    usage_known, provider_retryable, input_tokens, cached_input_tokens,
    output_tokens, reasoning_tokens, retry_after_seconds, cost_micros,
    settlement_state
  ) VALUES (
    permit_row.id,
    CASE
      WHEN disposition_value = 'success' THEN 'completed'
      WHEN disposition_value = 'caller_aborted' THEN 'cancelled'
      ELSE 'failed'
    END,
    now_value, permit_row.grant_kid, permit_row.request_binding_hmac,
    permit_row.nonce, disposition_value, reported_disposition_value,
    usage_known_value, provider_retryable_value, input_value,
    cached_input_value, output_value, reasoning_value,
    NULLIF(p_request->>'retryAfterSeconds', '')::integer,
    cost_value, state_value
  );
  UPDATE ai_execution_permits
  SET state = state_value
  WHERE id = permit_row.id AND state = 'consumed';
  UPDATE ai_admission_cost_reservations
  SET state = CASE WHEN state_value = 'released' THEN 'released' ELSE 'charged' END,
    actual_cost_micros = cost_value,
    settled_at = now_value
  WHERE permit_id = permit_row.id AND state = 'reserved';
  IF disposition_value = 'success' AND circuit_row.state <> 'open' THEN
    UPDATE ai_provider_circuit_states
    SET state = 'closed',
      consecutive_failures = 0,
      opened_until = NULL,
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version;
  ELSIF reported_disposition_value IN (
    'provider_unavailable', 'deadline_exceeded', 'transport_ambiguous'
  ) THEN
    UPDATE ai_provider_circuit_states
    SET state = CASE
        WHEN circuit_row.state IN ('open', 'half_open')
          OR circuit_row.consecutive_failures + 1 >= 5
        THEN 'open'
        ELSE 'closed'
      END,
      consecutive_failures = LEAST(circuit_row.consecutive_failures + 1, 1000000),
      opened_until = CASE
        WHEN circuit_row.state IN ('open', 'half_open')
          OR circuit_row.consecutive_failures + 1 >= 5
        THEN now_value + interval '60 seconds'
        ELSE NULL
      END,
      updated_at = now_value
    WHERE provider_deployment_profile_version =
      operation_row.provider_deployment_profile_version;
  END IF;

  IF reservation_row.property_id IS NOT NULL THEN
    UPDATE ai_property_quota_windows
    SET reserved_cost_micros =
          reserved_cost_micros - reservation_row.maximum_cost_micros,
      settled_cost_micros = settled_cost_micros + cost_value,
      updated_at = now_value
    WHERE property_id = reservation_row.property_id
      AND generation = reservation_row.property_window_generation;
    UPDATE ai_organization_cost_windows
    SET reserved_cost_micros =
          reserved_cost_micros - reservation_row.maximum_cost_micros,
      settled_cost_micros = settled_cost_micros + cost_value,
      updated_at = now_value
    WHERE organization_id = reservation_row.organization_id
      AND utc_date = reservation_row.organization_utc_date;
  ELSE
    UPDATE ai_canary_authorizations
    SET state = CASE
        WHEN disposition_value = 'success' THEN 'passed'
        WHEN state_value = 'released' THEN 'released_no_dispatch'
        ELSE 'terminal_failed'
      END,
      settled_at = now_value
    WHERE id = operation_row.canary_authorization_id
      AND state = 'consumed';
    UPDATE ai_operation_attempts
    SET state = CASE WHEN disposition_value = 'success' THEN 'completed' ELSE 'failed' END,
      model_snapshot = CASE
        WHEN disposition_value = 'success' THEN model_snapshot_value
        ELSE NULL
      END,
      input_tokens = CASE WHEN disposition_value = 'success' THEN input_value ELSE NULL END,
      output_tokens = CASE WHEN disposition_value = 'success' THEN output_value ELSE NULL END,
      failure_code = CASE
        WHEN disposition_value = 'success' THEN NULL
        WHEN state_value = 'released' THEN 'provider_no_dispatch'
        ELSE 'operation_ambiguous'
      END,
      settled_at = now_value
    WHERE operation_id = operation_row.id
      AND attempt = operation_row.execution_attempt
      AND state = 'executing';
    UPDATE ai_operations
    SET state = CASE WHEN disposition_value = 'success' THEN 'succeeded' ELSE 'failed' END,
      failure_code = CASE
        WHEN disposition_value = 'success' THEN NULL
        WHEN state_value = 'released' THEN 'provider_no_dispatch'
        ELSE 'operation_ambiguous'
      END,
      next_attempt_at = NULL,
      updated_at = now_value
    WHERE id = operation_row.id AND state = 'executing';
    UPDATE ai_canary_authorization_heads
    SET transition_generation = transition_generation + 1,
      state = CASE
        WHEN disposition_value = 'success' THEN 'passed'
        WHEN state_value = 'released' THEN 'eligible'
        ELSE 'terminal_failed'
      END,
      current_authorization_id = CASE
        WHEN state_value = 'released' THEN NULL
        ELSE current_authorization_id
      END,
      current_operation_id = CASE
        WHEN state_value = 'released' THEN NULL
        ELSE current_operation_id
      END,
      current_permit_id = CASE
        WHEN state_value = 'released' THEN NULL
        ELSE current_permit_id
      END,
      updated_at = now_value
    WHERE release_sha = operation_row.release_sha
      AND canary_profile_version = operation_row.canary_profile_version
      AND current_permit_id = permit_row.id;
  END IF;

  RETURN QUERY SELECT 'settled', NULL::text, permit_row.grant_kid::text,
    permit_row.request_binding_hmac::text, disposition_value::text,
    usage_known_value, provider_retryable_value, input_value,
    cached_input_value, output_value, reasoning_value, cost_value, now_millis,
    state_value::text;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "settle_ai_execution_v1"(jsonb, varchar) FROM PUBLIC;--> statement-breakpoint
-- The readiness assertion byte-compares the exact catalogue projection, so
-- re-pinning the rows above without re-pinning the assertion makes every caller
-- read "catalogue not ready" and the whole AI plane fails closed. Same body as
-- 0066 with the provider digest, the provider model snapshot, the provider
-- deployment contract and the four operation-profile projections moved.
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
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version), '[]'::jsonb) FROM public.ai_operation_profiles AS row_value) = '[{"profile_version":"property-trend-v1","command":"trend","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","caller_role":"worker","capability_runtime_profile_version":"property-trends-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"property_trend_v1","output_schema_digest":"f7aed9fe4af94b7db080ecb4320075295833d9a3e4b997f810732b838ef86776","prompt_digest":"30916252f5dd6860f4ce6f2bf50aba6345af4f39684ccb19aee728aa9fee7f64","artifact_attestations":{"trend":{"trendContractVersion":"property-trend-v1","trendContractDigest":"7ddab704d4bad00b0590098713434c7f95504e81a201922c35b52b4ae19c64bf","trendRenderVersion":"trend-render-v1","trendRenderDigest":"ff80090244e5780cb330ea5407d0414503259030f7e6d39a5d5c6cccc14f8498","arithmetic":"safe-integer-input-bigint-cross-products"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"93630d49bd89904dbf4da13888efc2066c83ec64233c1b1a6e22727c28020078","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":890,"static_token_bearing_digest":"980717fd62333da90ffeaf862ac25665ef049b2d18d92b629040b30ea799c601","source_byte_limit":65536,"provider_payload_byte_limit":65536,"prepared_request_byte_limit":131072,"response_byte_limit":131072,"max_output_tokens":2048,"reasoning_effort":"low","provider_deadline_ms":90000,"request_deadline_ms":100000,"execution_lease_ms":150000,"profile_digest":"501e0c9635ecfee0a94fcf45bd291db053d5f2a1bb03024b80444cde03aeec72"},{"profile_version":"reply-suggestion-v1","command":"reply","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","caller_role":"web","capability_runtime_profile_version":"reply-drafting-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"reply_template_selection_v1","output_schema_digest":"d123646236e874e901bdd6706f98a3e607fe5f27d41318190efed543d27ba0cc","prompt_digest":"3d9ff8af03d9d9289db57ca29854a6daf0d337e1414c171d7e983648b0da75ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5","replyLanguageVerifierVersion":"reply-language-verifier-v1","replyLanguageVerifierDigest":"3ed39117b80bfd90afa9b18a30f9c7406ce99bf709f32f5edb08829001c5a509","languageScriptConsistencyVersion":"language-script-consistency-v1","languageScriptConsistencyDigest":"16be4d6ec7e2bf13a4f059bc6249de7972fcb543e7989543b18903791fcb65fa","zhOrthographyVerifierVersion":"zh-orthography-verifier-v1","zhOrthographyVerifierDigest":"e9f945b7c0b8e6982de737a63819640263e14aad9c97e837056f5e1a952b729d","replyTemplateCatalogueVersion":"gbp-reply-template-catalogue-v1","replyTemplateCatalogueDigest":"ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f","outputLeakageProfileVersion":"gbp-reply-output-leakage-v1","outputLeakageProfileDigest":"f25affbb40db8b68b4b5c4711f3eeddf41a2822c33c5c4f9b61faaec60533673"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"5a58659a96b62a552eb8e28f19a418b4fa2a9a441739b1dbb97b790ffd8894e3","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":906,"static_token_bearing_digest":"d31a938abc533fe9459a22d2c84d9f428a2497962106a97deeb4d6594e14c7f2","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"e0a41c9ae285962255b1ace77bddf9a49bf8258e35b40e7d88888eb60f879974"},{"profile_version":"review-analysis-v1","command":"analysis","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","caller_role":"worker","capability_runtime_profile_version":"review-analysis-runtime-v1","provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"review_analysis_v1","output_schema_digest":"6dfcc7c4415d1f011335fdda6f63fbe8ed4fbf9b4780f1fbfac3570e922df45a","prompt_digest":"7ae4aabfc187f0c402bbb1d6e44012a0f19bcf31a89871c80d259878f82094ca","artifact_attestations":{"source":{"sourcePolicyId":"google-business-profile-source-policy-v1","sourceCanonicalizerDigest":"df0c9ea9ea7efebe0fe270bb86f644a8dfffc411f58538bd6fc0634d295fcac5","redactionProfileVersion":"gbp-review-global-v1","redactionProfileDigest":"46f4024e09f1196f719f6120208b80ff13482bd3cbb57a5bf9ac9f0ed02eeab3","structuredMarkerDetectorVersion":"structured-marker-detectors-v1","structuredMarkerDetectorDigest":"fca2955d506787aa1aa4777cf55bb5020b571bc0e87c07c169c544f83a593e2a","languageCatalogueVersion":"ai-review-language-catalogue-v1","languageCatalogueDigest":"2229287cf869db0a5dbf64efc4f823e5a0f23f6da34a24b581585b06462bf1a5"},"calendar":{"profileVersion":"property-calendar-v1","epochMillisFunction":"ai_epoch_millis_v1","localCalendarFunction":"resolve_ai_property_local_date_v1","localMidnightFunction":"ai_property_local_midnight_v1","databaseImageDigest":"33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20","testedPostgresMajorVersions":[16]},"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"},"attentionFormulaVersion":"review-attention-v1"},"artifact_attestations_digest":"1fc168bae40d57907ffd1fa4a92f36a87db79f9f1d70e831682b3fab1082ac25","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":1081,"static_token_bearing_digest":"70aea6dab74ccf1df331a42264c06120c0bedd509f7cdad3b05088a3c953b066","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":1024,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"97eef38b0b6186a6dfeae9b56047574cb677c103d917e7eabb8f5104b192e04f"},{"profile_version":"synthetic-canary-v1","command":"synthetic_canary","capability":null,"purpose":"ai.synthetic_canary","source_route":"synthetic-canary","gateway_path":"internal:synthetic-canary","caller_role":"release_canary","capability_runtime_profile_version":null,"provider_deployment_profile_version":"private-beta-global-v1","output_schema_name":"synthetic_canary_v1","output_schema_digest":"9e4530ad830cf3635b0ee2b636141193524cf7db1a9de0d5d4f1530c16fe9bc7","prompt_digest":"28f90dbd3fe4ed23ae32379e62fc9f6fdbfd25489a4eed63164e734ee94a3d8a","artifact_attestations":{"canaryProfileVersion":"synthetic-canary-v1","safetyIdentifierProfileVersion":"synthetic-canary-safety-v1","promptCacheShard":0,"sdk":{"requestShapeVersion":"openai-responses-request-shape-v1","requestShapeDigest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","providerTransportProfile":"openai-provider-transport-v1"},"gatewayBuild":{"version":"ai-egress-gateway-build-v1","digest":"9690cdf513d912f64b436c25270da811a45bc7f6f0f8652ca78178fd794b3fcd"}},"artifact_attestations_digest":"e2d8c35c61914ff3bd41e24fa9744de58f57d4e551afebfcf999bb0367e10097","sdk_request_shape_digest":"69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd","static_token_bearing_bytes":419,"static_token_bearing_digest":"11c7e44c309c144fa7ef7904710350bfeea1c829e36fa0b51ae736b9bdf02cf4","source_byte_limit":16384,"provider_payload_byte_limit":16384,"prepared_request_byte_limit":65536,"response_byte_limit":131072,"max_output_tokens":512,"reasoning_effort":"low","provider_deadline_ms":60000,"request_deadline_ms":70000,"execution_lease_ms":120000,"profile_digest":"71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY runtime_profile_version), '[]'::jsonb) FROM public.ai_runtime_capability_profiles AS row_value) = '[{"runtime_profile_version":"property-trends-runtime-v1","capability":"property_trends","purpose":"ai.detect_trends","source_route":"property-trend","gateway_path":"/v1/property-trend","gateway_profile_version":"property-trend-gateway-v1","caller":"worker","operation_profile_version":"property-trend-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"reply-drafting-runtime-v1","capability":"reply_drafting","purpose":"ai.generate_reply","source_route":"reply-suggestion","gateway_path":"/v1/reply-suggestion","gateway_profile_version":"reply-suggestion-gateway-v1","caller":"web","operation_profile_version":"reply-suggestion-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"runtime_profile_version":"review-analysis-runtime-v1","capability":"review_analysis","purpose":"ai.analyze","source_route":"review-analysis","gateway_path":"/v1/review-analysis","gateway_profile_version":"review-analysis-gateway-v1","caller":"worker","operation_profile_version":"review-analysis-v1","provider_deployment_profile_version":"private-beta-global-v1","notice_version":"merchant-ai-notice-2026-08-19.v1","notice_digest":"f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb
    AND (SELECT coalesce(jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY capability), '[]'::jsonb) FROM public.ai_provider_deployment_capabilities AS row_value) = '[{"provider_deployment_profile_version":"private-beta-global-v1","capability":"property_trends","runtime_profile_version":"property-trends-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"reply_drafting","runtime_profile_version":"reply-drafting-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"},{"provider_deployment_profile_version":"private-beta-global-v1","capability":"review_analysis","runtime_profile_version":"review-analysis-runtime-v1","catalogue_digest":"191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298"}]'::jsonb;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_ai_runtime_catalogue_ready_v1"(text, text, text) FROM PUBLIC;--> statement-breakpoint
-- `issue_ai_canary_authorization_v1` pins the provider profile digest, the
-- provider model snapshot and the synthetic-canary operation profile digest, so
-- re-pinning the rows above without re-pinning this guard makes every canary issue
-- return "not eligible" and no release can pass its gate. Same body as 0066 with
-- those three values moved.
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
        'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90'
      AND provider_profile.provider = 'openai'
      AND provider_profile.model_snapshot = 'gpt-5.6-luna'
  )
    OR NOT EXISTS (
      SELECT 1
      FROM public.ai_operation_profiles AS operation_profile
      WHERE operation_profile.profile_version = p_canary_profile_version
        AND operation_profile.profile_digest =
          '71dc3424939af39918ea93b07e39c379a852258895f61a97c39047d92a810bd7'
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
) FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF NOT public.assert_ai_runtime_catalogue_ready_v1(
    'private-beta-global-v1',
    'f15b81337b7f1571b3c7f3b00383296f089aad48bab1dc415baf935bb70ded90',
    '191e8eefcc948892f489aca27c32df422edbeb067508068f28b2004ac71f9298'
  ) THEN
    RAISE EXCEPTION 'AI runtime catalogue readiness did not converge on the gpt-5.6-luna contract';
  END IF;
END $$;
--> statement-breakpoint
-- 0046 is unshipped and was edited in place so a database migrated from empty
-- seeds the gpt-5.6-luna catalogue directly. Five shipped files had to move with
-- it: 0050 and 0055 each re-assert `ai_provider_profiles_contract_valid` with the
-- deployment contract as a literal AND re-write the provider row, so the model,
-- the retention and the pricing had to move there or a migrate from empty would
-- fail its own CHECK mid-history; 0062 and 0065 each CALL
-- `assert_ai_runtime_catalogue_ready_v1` in a DO block, byte-comparing
-- `to_jsonb(row) - 'created_at'` for the whole catalogue, so their embedded
-- provider projections had to move or a migrate from empty would abort there; and
-- 0049 owns `settle_ai_execution_v1`, whose pinned model literal is replaced by a
-- lookup here and in place, so both paths converge on one function body. 0066 is
-- corrected in place for the same reason 0050/0055 were: it re-asserts the
-- contract CHECK, re-writes both catalogues and calls the readiness assertion.
-- Superseded function bodies and superseded readiness projections (0048, 0050:53,
-- 0055:187, 0057, 0062:461) keep their historical literals, exactly as 0066 left
-- them -- nothing calls them at the point they exist. Editing a file moves its
-- sha256, which the schema-drift comparator compares against the hash recorded
-- when it ran, so an already-migrated database needs the recorded hashes corrected
-- here. Same ledger-restamp as 0055/0065/0066. On a fresh database the recorded
-- hashes already equal these values and the statements are no-ops.
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '83c940282bcfcfc3c0e0007692b1af58db7da87e7c70570d0459d7c29131340c' WHERE "created_at" = 1786900001000;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '23a3c75e777971477b7f9411ac092fdf2cea9f80e155f60c4396ad0013886302' WHERE "created_at" = 1786900004000;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '0dfba4cc8a374ea795955aa38c3e070a611fb919482eb7b723fa210153db3ecc' WHERE "created_at" = 1786959866167;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '404ac4f06a46f19ab7e3964f3609ce8a2cf5000bed7d11ad77bf61d8a6ab04b2' WHERE "created_at" = 1787070323258;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '94f4614ca123fff130cbc40ebf18d1cdf69b9e6e7ce937ca4f0e691341887c29' WHERE "created_at" = 1787148931221;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = '1ef068466ed882a8f41ecee0f6c1164a24f7bf9ee1c2a585e861c3fed11975ec' WHERE "created_at" = 1787160893298;--> statement-breakpoint
UPDATE "drizzle"."__drizzle_migrations" SET "hash" = 'f634557ad9a2d344e7daf219f5c7464de3d1c295cb08594f35a8e1557bf3b3cc' WHERE "created_at" = 1787166059207;