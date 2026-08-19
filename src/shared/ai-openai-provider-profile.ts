import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { AI_GATEWAY_KEY_INVENTORY_V1 } from './ai-gateway-key-inventory'
export { AI_GATEWAY_KEY_INVENTORY_V1 }

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}
export const OPENAI_REQUEST_SHAPE_V1 = Object.freeze({
  model: 'gpt-5.4-mini-2026-03-17',
  input: Object.freeze([
    Object.freeze({ role: 'developer', content: 'versioned-developer-message' }),
    Object.freeze({
      role: 'user',
      content: 'one-redacted-or-aggregate-untrusted-data-block',
    }),
  ]),
  // Per-route, exactly like `maxOutputTokens`: these are constrained-vocabulary
  // selection tasks, and a single global `xhigh` made every real route exhaust its
  // whole output budget on reasoning and return NOTHING (`incomplete_details.reason
  // = max_output_tokens` -> empty output -> `output_invalid`). Measured against the
  // live deployment: analysis 26s/4096 truncated, trend 55s/8192 truncated, reply
  // 42s/6144 truncated, all empty; at 'low' the same inputs answer correctly in
  // 1-2s. Only the synthetic canary survived `xhigh`, which is why the release gate
  // stayed green while no tenant route had ever produced a result.
  reasoning: Object.freeze({ effort: 'route-profile-effort' }),
  text: Object.freeze({ format: 'strict-zod-text-format' }),
  maxOutputTokens: 'route-profile-integer',
  safetyIdentifier: 'route-closed-rk1-v1',
  promptCacheKey: 'rk:<route>:<promptVersion>:<00..0f>',
  promptCacheRetention: 'in_memory',
  serviceTier: 'default',
  store: false,
  stream: false,
  background: false,
  tools: Object.freeze([]),
  truncation: 'disabled',
  absent: Object.freeze([
    'metadata',
    'conversation',
    'previous_response_id',
    'prompt_cache_options',
    'prompt_cache_breakpoint',
  ]),
})

export const OPENAI_REQUEST_SHAPE_V1_DIGEST = digest(
  'repkey-openai-request-shape-v1\0',
  OPENAI_REQUEST_SHAPE_V1,
)

export const OPENAI_PROVIDER_PRIMARY_SOURCES_V1 = Object.freeze({
  model: 'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
  structuredOutputs: 'https://developers.openai.com/api/docs/guides/structured-outputs',
  responses: 'https://developers.openai.com/api/reference/resources/responses',
  apiOverview:
    'https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id',
  dataControls: 'https://developers.openai.com/api/docs/guides/your-data',
  promptCaching: 'https://developers.openai.com/api/docs/guides/prompt-caching',
  safetyIdentifiers:
    'https://developers.openai.com/api/docs/guides/safety-best-practices',
  pricing: 'https://developers.openai.com/api/docs/pricing',
  sdk: 'https://github.com/openai/openai-node/tree/v7.4.0',
})

export const OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1 = Object.freeze({
  provider: 'openai',
  api: 'responses-v1',
  endpoint: 'https://api.openai.com/v1/responses',
  modelSnapshot: 'gpt-5.4-mini-2026-03-17',
  structuredOutputs: 'strict-json-schema',
  // Delegated to the route profile. This sits among literal request parameters
  // (`serviceTier`, `store`), so a fixed value here would be a false claim about
  // what is actually sent now that each route governs its own effort.
  reasoningEffort: 'route-profile-effort',
  serviceTier: 'default',
  promptCacheRetention: 'in_memory',
  promptCacheMode: 'automatic_prefix_16_shards',
  store: false,
  trainingPosture: 'api-not-used-for-training-unless-organization-opts-in',
  abuseMonitoringRetention: 'generally-up-to-30-days-with-legal-safety-exceptions',
  providerResidencyClaim: 'none',
  zeroDataRetentionClaim: 'none',
  providerDeletionDateClaim: 'none',
  providerIdempotencyMode: 'none',
  sdkMaxRetries: 0,
  redirectMode: 'manual_no_follow',
  successStatus: 200,
})

export const OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1 = digest(
  'repkey-openai-provider-normalized-claims-v1\0',
  OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1,
)

export const OPENAI_PRICE_CATALOGUE_V1 = Object.freeze({
  catalogueId: 'openai-gpt-5.4-mini-standard-2026-08-15',
  modelSnapshot: 'gpt-5.4-mini-2026-03-17',
  serviceTier: 'default',
  unitTokens: 1_000_000,
  uncachedInputMicros: 750_000,
  cachedInputMicros: 75_000,
  outputMicros: 4_500_000,
  sourceUrl: OPENAI_PROVIDER_PRIMARY_SOURCES_V1.pricing,
  retrievalDate: '2026-08-15',
})

export type AiMaximumCostProfileV1 = Readonly<{
  staticTokenBearingBytes: number
  maxOutputTokens: number
}>

export function maximumCostMicros(
  profile: AiMaximumCostProfileV1,
  providerPayloadBytes: number,
): number {
  if (
    !Number.isSafeInteger(profile.staticTokenBearingBytes) ||
    profile.staticTokenBearingBytes < 0 ||
    !Number.isSafeInteger(profile.maxOutputTokens) ||
    profile.maxOutputTokens < 0 ||
    !Number.isSafeInteger(providerPayloadBytes) ||
    providerPayloadBytes < 0
  ) {
    throw new RangeError('AI maximum cost inputs must be nonnegative safe integers')
  }

  const unitTokens = BigInt(OPENAI_PRICE_CATALOGUE_V1.unitTokens)
  const inputTokens =
    BigInt(profile.staticTokenBearingBytes) + BigInt(providerPayloadBytes)
  const numerator =
    inputTokens * BigInt(OPENAI_PRICE_CATALOGUE_V1.uncachedInputMicros) +
    BigInt(profile.maxOutputTokens) * BigInt(OPENAI_PRICE_CATALOGUE_V1.outputMicros)
  const result = (numerator + unitTokens - 1n) / unitTokens
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('AI maximum cost exceeds the safe integer range')
  }
  return Number(result)
}

export const AI_SERVICE_DRAIN_SECONDS_V1 = 130
export const AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1 = 115_000

export const OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1 = Object.freeze({
  sdkVersion: '7.4.0',
  dispatcherVersion: 'undici@8.10.0',
  runtime: Object.freeze({
    nodeImage:
      'node:22-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46',
    nodeVersion: '22.23.2',
    icuVersion: '78.2',
    unicodeVersion: '17.0',
  }),
  endpoint: 'https://api.openai.com/v1/responses',
  promptCacheRetention: 'in_memory',
  promptCacheMode: 'automatic_prefix_16_shards',
  promptCacheOptions: 'absent',
  promptCacheBreakpoint: 'absent',
  truncation: 'disabled',
  tools: 'empty_array',
  metadata: 'absent',
  conversation: 'absent',
  previousResponseId: 'absent',
  stream: false,
  background: false,
  providerFallback: 'none',
  providerIdempotencyMode: 'none',
  sdkMaxRetries: 0,
  maxHttpRequestsPerPermit: 1,
  possibleDispatchBoundary: 'outbound_fetch_invocation',
  redirectMode: 'manual_no_follow',
  successStatus: 200,
  successMediaTypeProfile: 'application-json-utf8-v1',
  clientRequestIdProfile: 'openai-client-request-id-v1',
  retryAfterProfile: 'delta-seconds-1-to-300-v1',
  statusDispositionProfile: 'openai-status-disposition-v1',
  retryableCompleteStatuses: Object.freeze([429, 500, 502, 503, 504] as const),
  serviceDrainSeconds: AI_SERVICE_DRAIN_SECONDS_V1,
  handlerDrainTimeoutMillis: AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1,
  gatewayRequestTimeoutMillis: 115_000,
  requestShapeDigest: OPENAI_REQUEST_SHAPE_V1_DIGEST,
  evidence: Object.freeze({
    retrievalDate: '2026-08-15',
    primarySources: OPENAI_PROVIDER_PRIMARY_SOURCES_V1,
    normalizedClaimsDigest: OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  }),
  pricing: OPENAI_PRICE_CATALOGUE_V1,
  keyInventory: AI_GATEWAY_KEY_INVENTORY_V1,
})

const AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V1 = Object.freeze({
  profileVersion: 'private-beta-global-v1',
  region: 'global',
  provider: 'openai',
  modelSnapshot: 'gpt-5.4-mini-2026-03-17',
  reasoningEffort: 'route-profile-effort',
  serviceTier: 'default',
  store: false,
  responseApiVersion: 'responses-v1',
  deploymentContract: OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1,
})

export const AI_PROVIDER_DEPLOYMENT_PROFILE_V1 = Object.freeze({
  ...AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V1,
  profileDigest: digest(
    'repkey-ai-provider-deployment-profile-v1\0',
    AI_PROVIDER_DEPLOYMENT_PROFILE_FIELDS_V1,
  ),
})
