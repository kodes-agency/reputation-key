# Model switch investigation: "5.6 Luna medium" — 2026-08-19

Research only. No source file was changed. All provider facts below come from live calls
against the `ai-egress-gateway` key (Railway `google-closed-beta`) made on 2026-08-20, or
from `developers.openai.com`, which is already the `sourceUrl` pinned in
`OPENAI_PRICE_CATALOGUE_V1`. The key was never printed.

## 1. What "5.6 Luna medium" resolves to

**`model: 'gpt-5.6-luna'` with `reasoning: { effort: 'medium' }`. Confidence: high.**

`GET /v1/models` returned 124 models. Everything matching `/5\.6|luna/i`, verbatim:

| id              | `created`  | UTC                  | `owned_by` |
| --------------- | ---------- | -------------------- | ---------- |
| `gpt-5.6-luna`  | 1782228658 | 2026-06-23T15:30:58Z | system     |
| `gpt-5.6-terra` | 1782228459 | 2026-06-23T15:27:39Z | system     |
| `gpt-5.6-sol`   | 1782228018 | 2026-06-23T15:20:18Z | system     |

Both readings of "medium" were tested:

- **(a) Is `medium` part of an id? No.** Zero of the 124 ids contain `medium`
  (case-insensitive). `GET /v1/models/gpt-5.6-luna-medium` → `404 The model
'gpt-5.6-luna-medium' does not exist`.
- **(b) Is `medium` an accepted effort? Yes**, and it is the model's _default_. Passing
  `minimal` returns the enumeration verbatim:
  `Unsupported value: 'minimal' is not supported with the 'gpt-5.6-luna' model. Supported
values are: 'none', 'low', 'medium', 'high', 'xhigh', and 'max'.`
  `https://developers.openai.com/api/docs/models/gpt-5.6-luna` states:
  `Reasoning.effort supports: none, low, medium (default), high, xhigh, and max.`
  Omitting `reasoning` entirely produced output identical to explicit `medium`
  (68 output / 37 reasoning tokens), consistent with medium being the default.

### There is no dated snapshot to pin

This repo's governance model pins a dated snapshot (`gpt-5.4-mini-2026-03-17`). **Luna has
none.** All 404: `gpt-5.6-luna-2026-06-23`, `gpt-5.6-luna-2026-06-24`,
`gpt-5.6-luna-medium`, `gpt-5.6-luna-mini`. `GET /v1/models/gpt-5.6-luna` returns
`{"id":"gpt-5.6-luna","object":"model","created":1782228658,"owned_by":"system","shutdown_date":null}`
and the model doc says `Current snapshot: gpt-5.6-luna`.

So `OPENAI_MODEL_SNAPSHOT` would hold a **floating alias**, not an immutable snapshot. The
constant name, the `ai_provider_profiles_model_valid` CHECK and the whole
attestation-digest chain all assume the string identifies fixed model behaviour. Adopting
Luna silently weakens that guarantee: OpenAI can move the alias without any digest in this
repo moving. That is a governance decision, not a code detail, and it is the single most
important consequence of this switch.

## 2. Blocking incompatibility: `prompt_cache_retention`

The **first** finding of the probe, before any effort measurement: every effort level
returned `400`.

```
none | minimal | low | medium | high | xhigh | max
  -> 400 'This model is compatible only with 24h extended prompt caching'
```

Isolated to exactly one field by changing only that field:

| `prompt_cache_retention` | `gpt-5.6-luna`                                                           | `gpt-5.4-mini-2026-03-17` |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------- |
| `'in_memory'`            | **400** `This model is compatible only with 24h extended prompt caching` | 200 `completed`           |
| `'24h'`                  | 200 `completed`                                                          | not tested                |
| field absent             | 200 `completed`                                                          | not tested                |

`ClosedOpenAiRequest.prompt_cache_retention` is the literal type `'in_memory'`
(`src/shared/ai-openai-request-contract.ts:55`, set at `:181`). **The switch is impossible
without changing that field**, and `'in_memory'` is recorded in three separate governed
places (§5). It is also a data-handling claim, not just a parameter:
`OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1.promptCacheRetention`
(`src/shared/ai-openai-provider-profile.ts:80`) sits beside `trainingPosture` and
`abuseMonitoringRetention`. Moving from in-memory to 24h extended retention changes what
this deployment asserts to merchants about provider-side prompt retention. Whether that is
acceptable under the closed-beta notice and DPA is a legal/governance call I cannot make
from an API; flagged, not resolved.

## 3. Measured reply-suggestion route

Exact production shape from `buildClosedOpenAiRequest`
(`src/shared/ai-openai-request-contract.ts:170-188`): developer + user message, `text.format`
`json_schema` `strict:true`, `max_output_tokens: 1024`, `safety_identifier` matching
`^rk1_[A-Za-z0-9_-]{43}$`, `prompt_cache_key: rk:reply-suggestion:reply-suggestion-prompt-v1:00`,
`service_tier: default`, `store/stream/background: false`, `tools: []`,
`truncation: disabled`. Only `prompt_cache_retention` was changed to `'24h'`, because it
must be. Developer prompt is byte-identical to `ai-operation-profiles.ts:268`.

User message (canonicalised, keys sorted), 162 input tokens:

```json
{
  "languageCode": "bg-Cyrl",
  "rating": 3,
  "reviewText": "Нов Семеен хотел. Странна архитектура и обслужване. Закуската не е лоша. Не става за инвалиди",
  "tone": "professional"
}
```

Three runs per level. Slash-separated values are the individual runs, in order.

| effort   | wall ms        | mean ms | `output_tokens` | `reasoning_tokens` | schema-valid | `incomplete_details.reason` |
| -------- | -------------- | ------- | --------------- | ------------------ | ------------ | --------------------------- |
| `none`   | 1149/1098/1532 | 1260    | 29/29/29        | 0/0/0              | 3/3          | none                        |
| `low`    | 1668/1229/2050 | 1649    | 58/29/66        | 27/0/35            | 3/3          | none                        |
| `medium` | 1637/1112/1772 | 1507    | 68/29/93        | 37/0/62            | 3/3          | none                        |
| `high`   | 1705/2063/1641 | 1803    | 82/67/101       | 51/36/70           | 3/3          | none                        |
| `xhigh`  | 4613/1761/2446 | 2940    | 118/106/140     | 87/75/109          | 3/3          | none                        |
| `max`    | 3283/1775/2324 | 2461    | 217/99/153      | 186/68/122         | 3/3          | none                        |

`minimal` → 400 (see §1). Every one of the 18 calls returned a schema-valid body, and
**not one truncated**. `input_tokens` was 162 and `cached_tokens` 0 on all 18, consistent
with the existing note that 162 tokens is below the 1024-token caching minimum.

The headline difference from `gpt-5.4-mini-2026-03-17`: **Luna has no reasoning cliff.**
The prior measurement recorded 5.4-mini at `xhigh` burning its entire 6144-token reply
budget on reasoning and returning an empty body. Luna at `max` — two rungs higher — spent
at most 186 reasoning tokens and answered correctly every time. Worst case across all 18
runs was 217/1024 output tokens, 21 % of the ceiling.

### Answer quality is identical to the current model

Every run at every effort level, and every 5.4-mini control run, returned exactly
`{"templateId":"acknowledge_concern","languageCode":"bg-Cyrl"}`. Effort buys nothing on
this route; it only changes how many reasoning tokens are billed.

### Baselines on the same payload

| model / effort                                 | wall ms        | `output_tokens` | `reasoning_tokens` | valid |
| ---------------------------------------------- | -------------- | --------------- | ------------------ | ----- |
| `gpt-5.4-mini-2026-03-17` `low` (current prod) | 1360/1162/1270 | 82/86/87        | 51/55/56           | 3/3   |
| `gpt-5.4-mini-2026-03-17` `medium`             | 1562/1609/1269 | 136/118/86      | 105/87/55          | 3/3   |

**Latency is a mild regression, not a win.** Luna `medium` mean 1507 ms vs the current
5.4-mini `low` mean 1264 ms — about 19 % slower on the reply route. With n=3 the ranges
overlap heavily, so treat this as "no better", not as a precise delta.

## 4. Review-analysis route confirmation (richest route)

Real developer prompt from `ai-operation-profiles.ts:234`, real derived schema: `sentiment`
enum of 4, `sentimentValence` integer −100..100, `primaryCategory` enum of 10,
`urgencySignals` array `maxItems: 3` of 6 enums, `additionalProperties: false`, all four
required. Enums taken from `src/shared/openai-route-output-schemas.ts:3-28`. User payload is
the analysis provider payload from `services/ai-egress-gateway/route-preparer.ts:313`
(`reviewText`, `rating`, `languageCode`; no `tone`), 226 input tokens.
`max_output_tokens: 1024`.

Validation also enforced the two `superRefine` invariants at
`openai-route-output-schemas.ts:65-76` — `urgencySignals` uniqueness and
sentiment/valence consistency — not just the JSON Schema.

| model / effort                | wall ms        | `output_tokens` | `reasoning_tokens` | valid | `incomplete_details.reason` |
| ----------------------------- | -------------- | --------------- | ------------------ | ----- | --------------------------- |
| luna `medium`                 | 2870/2944/2982 | 164/202/172     | 127/165/136        | 3/3   | none                        |
| luna `low`                    | 1009/1535/2867 | 34/34/151       | 0/0/111            | 3/3   | none                        |
| 5.4-mini `low` (current prod) | 2417/2041/1742 | 146/181/144     | 109/144/107        | 3/3   | none                        |

**Confirmed: Luna handles the richest route at `medium`.** 3/3 schema-valid including both
refinements, no truncation, worst case 202/1024 output tokens (20 % of ceiling). Semantics
match the current model exactly: luna `medium` returned
`{"sentiment":"mixed","sentimentValence":-1,"primaryCategory":"accessibility","urgencySignals":[]}`
(valence 0 once), and 5.4-mini `low` returned the identical object all three runs.

Latency regression is larger here: luna `medium` mean 2932 ms vs 5.4-mini `low` mean
2067 ms, roughly 42 % slower. luna `low` (mean 1804 ms) is the only configuration measured
that beats today's production latency on this route.

Not probed: `property-trend` and `synthetic-canary`. `property-trend` carries the largest
ceiling (2048) and a 1–4 item array output, so it should be measured before release.

## 5. Switch cost

### Complete `file:line` inventory

82 occurrences across 39 files: `gpt-5.4-mini-2026-03-17` as a literal, or
`OPENAI_MODEL_SNAPSHOT` as an identifier, under `src/`, `services/`, `drizzle/`,
`scripts/`. **`scripts/` contains zero occurrences of either.**

**TypeScript constants (authority — edit these) — 13**

| location                                        | what                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `src/shared/ai-openai-request-contract.ts:6`    | `OPENAI_MODEL_SNAPSHOT` definition                                   |
| `src/shared/ai-openai-request-contract.ts:45`   | `ClosedOpenAiRequest.model` type                                     |
| `src/shared/ai-openai-request-contract.ts:171`  | value assigned in `buildClosedOpenAiRequest`                         |
| `src/shared/ai-openai-provider-profile.ts:13`   | `OPENAI_REQUEST_SHAPE_V1.model`                                      |
| `src/shared/ai-openai-provider-profile.ts:73`   | `OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1.modelSnapshot`                 |
| `src/shared/ai-openai-provider-profile.ts:101`  | `OPENAI_PRICE_CATALOGUE_V1.modelSnapshot`                            |
| `src/shared/ai-openai-provider-profile.ts:198`  | `AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V1.modelSnapshot`             |
| `src/shared/db/schema/ai.schema.ts:114`         | `ai_provider_profiles_model_valid` CHECK (Drizzle model)             |
| `src/shared/ai-reply-provenance.ts:6,38`        | import + `z.literal(OPENAI_MODEL_SNAPSHOT)` in the provenance schema |
| `services/ai-egress-gateway/contracts.ts:16`    | re-export                                                            |
| `services/ai-egress-gateway/provenance.ts:5,35` | import + `z.literal(...)`                                            |

Plus, forced by §2 and **not** matched by either grep pattern — the three
`promptCacheRetention: 'in_memory'` sites:
`ai-openai-request-contract.ts:55` (type) and `:181` (value),
`ai-openai-provider-profile.ts:34` (`OPENAI_REQUEST_SHAPE_V1`),
`:80` (normalized claims), `:158` (deployment contract).

Note `ai-reply-provenance.ts:38` and `provenance.ts:35` pin the model with `z.literal`
inside the reply provenance token schema. **Reply drafts already persisted under
`gpt-5.4-mini-2026-03-17` will fail to parse** once that literal changes. Verified by
reading the schema, not by executing it: `src/contexts/review/infrastructure/`
`ai-suggested-draft-store.integration.test.ts:67` stores `modelSnapshot` on the draft row,
so stored drafts carry the old value. Either widen to a known-version set (the precedent
already used for the contract CHECKs in commit series item 2) or expire existing drafts.

**Test assertions — 12**

`src/shared/ai-openai-provider-profile.test.ts:64,70`;
`src/contexts/ai/domain/catalogues/operation-profiles.test.ts:70`;
`src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.integration.test.ts:1894,2105,2182,2308`;
`src/contexts/review/infrastructure/ai-suggested-draft-store.integration.test.ts:67,230`;
`services/ai-egress-gateway/openai-connector.test.ts:762`;
`services/ai-egress-gateway/prepared-invocation.test.ts:345`;
`services/ai-egress-gateway/provenance.test.ts:32`.

`prepared-invocation.test.ts:345` is the awkward one: it hooks `Buffer.from` and matches on
the substring `"gpt-5.4-mini-2026-03-17"` to capture the serialised request, so it fails
silently-wrong (captures nothing) rather than loudly if the literal moves.

**SQL CHECK literals — 1 constraint, 4 definition sites**

`drizzle/0046:260` defines `ai_provider_profiles_model_valid`. The
`ai_provider_profiles_contract_valid` literal, which embeds the whole
`deployment_contract` including `promptCacheRetention` and the pricing block, is carried at
`drizzle/0046:266`, `0050:586`, `0055:672`, `0066:177` — four in-place edits, for the same
reason the effort change needed three: a row updated in an early migration violates a later
migration's older literal, and a fresh migrate from empty fails.

**Embedded jsonb contract blobs and whole-catalogue projections — 14**

`0046:266,541`; `0050:15,53,586`; `0055:149,187,672`; `0057:104`; `0062:195`; `0065:81`;
`0066:160,177,220`. The `jsonb_agg(to_jsonb(row_value) - 'created_at')` projections
byte-compare the entire `ai_provider_deployment_profiles` row, so each is invalidated by any
field change.

**SQL function bodies pinning the model — 8**

Seed INSERT at `0046:349`. Lifecycle-authority guards
`provider_profile.model_snapshot = 'gpt-5.4-mini-2026-03-17'` at `0048:1337`, `0050:218`,
`0055:352`, `0057:274`, `0062:461`, `0066:390`. Settlement writeback
`model_snapshot = CASE WHEN disposition_value = 'success' THEN 'gpt-5.4-mini-2026-03-17'`
at `0049:1886`.

**Drizzle meta snapshots — 34 occurrences across 17 files**

`drizzle/meta/0046_snapshot.json` through `0062_snapshot.json`, two per file (the
`ai_provider_profiles_model_valid` and `ai_provider_profiles_contract_valid` CHECK values).
`0063`–`0066` have **no** meta snapshot: those migrations are hand-written SQL. Editing
shipped migration files moves their sha256, so `check:schema-drift` also needs
`__drizzle_migrations` hash restamps — `0055:673-674` shows two such restamps already, and
the effort ceremony needed five.

### Digests that move

I reproduced the repo's digest construction (`sha256(domain ‖ RFC8785(value))`) and
validated it against three digests already committed to the migrations before computing
anything. All three reproduce byte-exactly:

| digest                                        | recomputed        | committed                                  | match |
| --------------------------------------------- | ----------------- | ------------------------------------------ | ----- |
| `OPENAI_REQUEST_SHAPE_V1_DIGEST`              | `4b45167b…c50da2` | `0066:160` `sdk_request_shape_digest`      | yes   |
| `OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1` | `047243ba…5ffb06` | contract `evidence.normalizedClaimsDigest` | yes   |
| provider `profile_digest`                     | `3988c11f…4b955f` | `0066:162,194,218,388,706`                 | yes   |

**Moves — request shape.** `OPENAI_REQUEST_SHAPE_V1` changes twice over (`model`,
`promptCacheRetention`), so `OPENAI_REQUEST_SHAPE_V1_DIGEST` moves. This is the root of the
cascade: it is embedded in `SDK_ATTESTATION.requestShapeDigest`
(`ai-operation-profiles.ts:74`), which is in the `artifactAttestations` of **all four**
operation profiles (`:238,272,304,336`), and it is assigned to `sdkRequestShapeDigest`
at `:192`.

**Moves — provider deployment contract.** `OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1` changes
in four members: `promptCacheRetention` (`:158`), `requestShapeDigest` (`:184`),
`evidence.normalizedClaimsDigest` (`:188`) and `pricing` (`:190`). Therefore
`ai_provider_deployment_profiles.deployment_contract`, its `profile_digest`, and the
`ai_provider_profiles_contract_valid` CHECK literal all move.

**Moves — normalized evidence claims.** `modelSnapshot` and `promptCacheRetention` both
change, so `OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1` moves.

**Moves — per-route operation profile digests, all four.** Each `profile_digest` is computed
over the persisted fields, which include the changed `sdkRequestShapeDigest`,
`artifactAttestations` and `artifactAttestationsDigest`. So for
`review-analysis-v1`, `reply-suggestion-v1`, `property-trend-v1` and `synthetic-canary-v1`:
`artifact_attestations`, `artifact_attestations_digest`, `sdk_request_shape_digest` and
`profile_digest` all move — plus `reasoning_effort` if `low` → `medium`.

**Does NOT move — static token bearing.** `renderOpenAiStaticTokenBearingMaterial`
(`ai-openai-request-contract.ts:109-131`) digests only `{input:[developer, user:''],
text:{format}}`. No model, no retention. So `static_token_bearing_bytes` and
`static_token_bearing_digest` stay byte-identical, as do `output_schema_digest` and
`prompt_digest` (schemas and prompts unchanged). Verified by reading the function, not
assumed.

**Does NOT move — gateway build attestation.** `AI_GATEWAY_BUILD_ATTESTATION_V1`
(`src/shared/ai-gateway-build-attestation.ts:7-87`) covers bundle paths, Docker/tsup
config, SDK version and key inventory. It contains no model id and no request shape, so
`AI_GATEWAY_BUILD_ATTESTATION_DIGEST` and the `GATEWAY_BUILD_ATTESTATION` member of every
`artifactAttestations` are unaffected. I checked all 34 keys.

**Does NOT move — runtime capability catalogue.** `ai-runtime-capability-contract.ts:58`
carries `providerDeploymentProfileVersion: 'private-beta-global-v1'` — a version string, not
a digest — so `AI_RUNTIME_CAPABILITIES_V1_DIGEST` (`191e8eef…`) is unchanged and the
`assert_ai_runtime_catalogue_ready_v1` catalogue-digest argument keeps its value. Its
whole-row jsonb projections still change, because those compare the provider row itself.

**Worked example.** Under the stated assumptions `model='gpt-5.6-luna'`,
`promptCacheRetention='24h'`, `retrievalDate='2026-08-20'`,
`catalogueId='openai-gpt-5.6-luna-standard-2026-08-20'`, pricing micros
200000/20000/1200000:

| digest                                                                    | old                                                                | new                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `OPENAI_REQUEST_SHAPE_V1_DIGEST`                                          | `4b45167b560a5fa8fd8640127c4df6dcdde43be7693091726745e5e247c50da2` | `69d4c82156308030119f7c5a7ce31d201dbfbbc68e0bc7b568f585e4ff1d09fd` |
| `OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1`                             | `047243baef7a73dabf6a708aea2e66ae88102da3cc801d5893e91301155ffb06` | `a6c41316f725644be569c2797f20941d2d04e39996b6a0d69d835d5e93f0b2c9` |
| provider `profile_digest`                                                 | `3988c11f6f35b0f9b172b74414684b2a046b6c3dd87c4ae2ee10f58ce54b955f` | `f0ac8fe59fbf4037985c9205bcca570b0eb09327ad335b27070fc8af9dddec3d` |
| provider `profile_digest`, if a `cacheWriteMicros: 250000` field is added | same                                                               | `966979aa436a013ccf1c5c7c70770ab54e9d61f996decdf75922e4a059b70687` |

These new values are only valid for exactly those editorial choices; `catalogueId` and
`retrievalDate` feed the hash. The invariant that matters is which digests move, not these
particular hex strings. I did **not** compute the four per-route operation profile digests:
that requires executing the compiled catalogue, and the repo already has
`check:ai-contract-attestations` and `check:schema-drift` for it.

### Migration and env rotation

A new migration (`0067`) in the shape of `0066`, plus in-place corrections to shipped
migrations. Concretely: update the provider row's `model_snapshot`, `deployment_contract`
and `profile_digest`; update all four operation rows' `artifact_attestations`,
`artifact_attestations_digest`, `sdk_request_shape_digest`, `profile_digest` (and
`reasoning_effort` if it changes); redefine `ai_provider_profiles_model_valid`; redefine
`ai_provider_profiles_contract_valid` in place at `0046:266`, `0050:586`, `0055:672`,
`0066:177`; update the seven lifecycle guards and the `0049:1886` settlement writeback;
update every embedded whole-catalogue projection (`0046:541`, `0050:53`, `0055:187`,
`0057:104`, `0062:195`, `0065:81`, `0066:220`) including the two called inside DO blocks at
`0062:204` and `0065:90`; re-pin both digests inside `issue_ai_canary_authorization_v1`
(`0066:388`, `0066:706` carry the provider digest); restamp the affected
`__drizzle_migrations` hashes; and edit the 17 `drizzle/meta/*_snapshot.json` files.

**Env rotation — exactly one variable, on exactly two services.**
`AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST` is asserted byte-equal to the compiled
`AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest` at gateway boot
(`services/ai-egress-gateway/environment.ts:259-261`) and again for the canary at
`:311-312`. Queried live in `google-closed-beta`:

| service                  | `AI_PROVIDER_DEPLOYMENT_PROFILE_DIGEST` | action          |
| ------------------------ | --------------------------------------- | --------------- |
| `ai-egress-gateway`      | `3988c11f…4b955f`                       | **must rotate** |
| `ai-execution-admission` | `3988c11f…4b955f`                       | **must rotate** |
| `web`                    | absent                                  | none            |
| `worker`                 | absent                                  | none            |

Not rotated: `AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION` (`private-beta-global-v1`, unchanged),
`AI_RUNTIME_CAPABILITY_CATALOGUE_DIGEST` (`191e8eef…`, unchanged),
`AI_GATEWAY_BUILD_ATTESTATION_DIGEST` (`9690cdf5…`, unchanged — see above). No
`OPENAI_MODEL*` variable exists in the gateway environment; the model is compile-time only.
Both digest-carrying services must be redeployed together with the migration, and admission
before gateway, per the existing runbook.

## 6. Pricing

**Verified from the primary source**, `https://developers.openai.com/api/docs/pricing` —
already the pinned `sourceUrl` — and the model page. Prices per 1M tokens, Standard tier,
short context.

|              | `gpt-5.4-mini` (current) | `gpt-5.6-luna` | ratio         |
| ------------ | ------------------------ | -------------- | ------------- |
| input        | $0.75                    | $0.20          | 3.75× cheaper |
| cached input | $0.075                   | $0.02          | 3.75× cheaper |
| cache writes | not offered              | **$0.25**      | new           |
| output       | $4.50                    | $1.20          | 3.75× cheaper |

`OPENAI_PRICE_CATALOGUE_V1` (`ai-openai-provider-profile.ts:99-109`) would need:

| field                 | current                                   | new                              |
| --------------------- | ----------------------------------------- | -------------------------------- |
| `catalogueId`         | `openai-gpt-5.4-mini-standard-2026-08-15` | new id                           |
| `modelSnapshot`       | `gpt-5.4-mini-2026-03-17`                 | `gpt-5.6-luna`                   |
| `uncachedInputMicros` | `750_000`                                 | `200_000`                        |
| `cachedInputMicros`   | `75_000`                                  | `20_000`                         |
| `outputMicros`        | `4_500_000`                               | `1_200_000`                      |
| `retrievalDate`       | `2026-08-15`                              | switch date                      |
| `cacheWriteMicros`    | —                                         | `250_000` (field does not exist) |

`OPENAI_PROVIDER_PRIMARY_SOURCES_V1.model` (`:56`) also needs repointing from
`…/models/gpt-5.4-mini` to `…/models/gpt-5.6-luna`.

Two genuinely new pricing dimensions:

- **Cache writes.** The model page states `Cache writes are billed at 1.25x the uncached
input token rate` — $0.25/1M, matching the table. `maximumCostMicros`
  (`:116-142`) has no term for this, so a cost _ceiling_ computed after the switch would be
  an underestimate if cache writes ever occur. Since `prompt_cache_retention: '24h'` becomes
  mandatory (§2), this stops being hypothetical. See the caveat below.
- **Long-context tier.** `Prompts with >272K input tokens are priced at 2x input and 1.5x
output for the full request.` Not reachable here: the largest route source budget is
  `sourceByteLimit: 65_536` (`ai-operation-profiles.ts:307`, property-trend), with analysis
  and reply at 16_384, all far below 272K tokens. So short-context rates always apply and
  `maximumCostMicros` stays sound on that axis. Worth an assertion if any byte limit is ever
  raised.

Illustrative unit economics at measured `medium` usage, 1000 reply calls, 162 input tokens:
**$0.11 on Luna vs $0.63 on 5.4-mini**, ignoring cache writes. Cost is the real argument for
this switch; latency is not (§3, §4).

Also on the model page: Luna `roughly corresponds to the nano model tier used in earlier
GPT-5 families`. Today's model is the _mini_ tier. In tier terms this is a downgrade in a
newer generation. My measurements show no quality loss on these two routes — 24/24
schema-valid, answers identical to the current model — but two routes on one Bulgarian
review is thin evidence for a capability claim.

## 7. Recommendation

`gpt-5.6-luna` at `reasoning: { effort: 'medium' }` is technically viable and 3.75× cheaper
per token, with these conditions:

1. `prompt_cache_retention` **must** become `'24h'` (or be dropped). Non-negotiable, and it
   changes a merchant-facing data-retention claim. Get that signed off first.
2. Accept that `OPENAI_MODEL_SNAPSHOT` becomes a floating alias with no pinnable snapshot.
   This is the biggest governance regression and deserves an explicit decision.
3. `medium` has ample headroom — worst case 202/1024 output tokens on the richest route, no
   truncation in 24 calls — so the ceilings set by the effort ceremony (1024/1024/2048/512)
   do not need resizing. On this evidence `low` would be cheaper and faster with identical
   answers; `medium` is the safe default the model itself uses.
4. Expect a latency regression, not an improvement: roughly +19 % reply, +42 % analysis
   versus today's 5.4-mini at `low`.
5. Handle the `z.literal(OPENAI_MODEL_SNAPSHOT)` in reply provenance before deploy, or
   already-persisted drafts stop parsing.
6. Measure `property-trend` and `synthetic-canary` before release.

## 8. Not verified

- **Actual billed cost.** `GET /v1/organization/costs` and
  `/v1/organization/usage/completions` both returned `403 … Missing scopes:
api.usage.read`; `/v1/dashboard/billing/subscription` returned `403 … must be made with a
session key`. All prices here are from published documentation, not from this account's
  invoice.
- **Whether cache writes are actually billed for these requests.** `cached_tokens` was 0 on
  all 24 calls and inputs are 162–226 tokens, below the documented 1024-token caching
  minimum, so I expect no cache-write charge — but with billing endpoints inaccessible I
  cannot confirm it, and `'24h'` retention is now mandatory. Verify against a real invoice
  line before relying on `maximumCostMicros` as a ceiling.
- **Whether 24h extended prompt caching is acceptable** under the closed-beta merchant
  notice and DPA. An API cannot answer this.
- **The four per-route operation profile digests**, and whether any merchant notice digest
  depends on `promptCacheRetention`. Both need the compiled catalogue.
- **No test, typecheck, lint, build, migration or deploy was run**, per the constraints. The
  digest arithmetic in §5 was validated by reproducing three already-committed digests, not
  by executing repo code.
- `property-trend` and `synthetic-canary` were not probed against Luna.
- Single review, single language (`bg-Cyrl`), n=3 per cell. Latency means overlap; treat
  directions as real and magnitudes as provisional.
