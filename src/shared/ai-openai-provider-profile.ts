import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { AI_GATEWAY_KEY_INVENTORY_V1 } from './ai-gateway-key-inventory'
import { OPENAI_MODEL_SNAPSHOT } from './ai-openai-request-contract'
import {
  maximumCostMicrosWith,
  settledCostMicrosWith,
  type AiMaximumCostProfileV1,
  type AiSettledUsageV1,
} from './ai-provider-pricing'
export { AI_GATEWAY_KEY_INVENTORY_V1 }
export type { AiMaximumCostProfileV1, AiSettledUsageV1 }

function digest(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}
export const OPENAI_REQUEST_SHAPE_V1 = Object.freeze({
  model: OPENAI_MODEL_SNAPSHOT,
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
  promptCacheRetention: '24h',
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
  model: `https://developers.openai.com/api/docs/models/${OPENAI_MODEL_SNAPSHOT}`,
  structuredOutputs: 'https://developers.openai.com/api/docs/guides/structured-outputs',
  responses: 'https://developers.openai.com/api/reference/resources/responses',
  apiOverview:
    'https://developers.openai.com/api/reference/overview#supplying-your-own-request-id-with-x-client-request-id',
  dataControls: 'https://developers.openai.com/api/docs/guides/your-data',
  promptCaching: 'https://developers.openai.com/api/docs/guides/prompt-caching',
  safetyIdentifiers:
    'https://developers.openai.com/api/docs/guides/safety-best-practices',
  pricing: 'https://developers.openai.com/api/docs/pricing',
  sdk: 'https://github.com/openai/openai-node/tree/v7.43.0',
})

export const OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1 = Object.freeze({
  provider: 'openai',
  api: 'responses-v1',
  endpoint: 'https://api.openai.com/v1/responses',
  modelSnapshot: OPENAI_MODEL_SNAPSHOT,
  structuredOutputs: 'strict-json-schema',
  // Delegated to the route profile. This sits among literal request parameters
  // (`serviceTier`, `store`), so a fixed value here would be a false claim about
  // what is actually sent now that each route governs its own effort.
  reasoningEffort: 'route-profile-effort',
  serviceTier: 'default',
  promptCacheRetention: '24h',
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

/**
 * The price list of the pinned model (`gpt-6-luna`, standard tier), in micro-dollars
 * per million tokens: $0.10 uncached input, $0.01 cached input, $0.50 output.
 *
 * The figures come from third-party price lists of 2026-10-30, not from OpenAI's own
 * page. OpenAI's pricing page (`OPENAI_PROVIDER_PRIMARY_SOURCES_V1.pricing`) is the
 * authority: compare it with an invoice, and if they differ change this list and the
 * deployment profile together, because the gateway and the admission authority must
 * read one list (see `settledCostMicros`).
 *
 * It replaced the list of `gpt-5.6-luna` ($0.20, $0.02, $1.20), the model every
 * operation before the switch-on ran on. Those operations are settled and carry their
 * cost in micros; nothing prices an operation by the earlier list again.
 */
export const OPENAI_PRICE_CATALOGUE_V2 = Object.freeze({
  catalogueId: 'openai-gpt-6-luna-standard-2026-10-30',
  modelSnapshot: OPENAI_MODEL_SNAPSHOT,
  serviceTier: 'default',
  unitTokens: 1_000_000,
  uncachedInputMicros: 100_000,
  cachedInputMicros: 10_000,
  outputMicros: 500_000,
  sourceUrl: OPENAI_PROVIDER_PRIMARY_SOURCES_V1.pricing,
  retrievalDate: '2026-10-30',
})

export function maximumCostMicros(
  profile: AiMaximumCostProfileV1,
  providerPayloadBytes: number,
): number {
  return maximumCostMicrosWith(OPENAI_PRICE_CATALOGUE_V2, profile, providerPayloadBytes)
}

/**
 * The one settled-cost formula. Every party that recomputes what a settlement
 * charged MUST call this.
 *
 * The egress gateway used to keep its own copy of the per-million literals in
 * three places while the admission authority derived them from
 * OPENAI_PRICE_CATALOGUE_V2. Repricing the model to gpt-5.6-luna moved the
 * catalogue and left the gateway's copies behind, so admission signed a receipt
 * the gateway then recomputed differently, `receiptMatches` failed on
 * `costMicros`, and every successfully generated reply was discarded as an
 * unverifiable receipt AFTER the provider had run and been charged. Callers saw
 * only `operation_ambiguous`.
 *
 * Ceiling division, matching the SQL settlement function: partial micros are
 * charged, never dropped. This is OpenAI's catalogue; a call settled by another
 * provider is priced by that provider's own (`settledCostMicrosWith`).
 */
export function settledCostMicros(usage: AiSettledUsageV1): bigint {
  return settledCostMicrosWith(OPENAI_PRICE_CATALOGUE_V2, usage)
}

export const AI_SERVICE_DRAIN_SECONDS_V1 = 130
export const AI_SERVICE_HANDLER_DRAIN_TIMEOUT_MILLIS_V1 = 115_000

export const OPENAI_PROVIDER_DEPLOYMENT_CONTRACT_V1 = Object.freeze({
  sdkVersion: '7.43.0',
  dispatcherVersion: 'undici@8.10.0',
  runtime: Object.freeze({
    nodeImage:
      'node:22.23.4-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f',
    nodeVersion: '22.23.4',
    icuVersion: '78.3',
    unicodeVersion: '17.0',
  }),
  endpoint: 'https://api.openai.com/v1/responses',
  promptCacheRetention: '24h',
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
    retrievalDate: '2026-08-19',
    primarySources: OPENAI_PROVIDER_PRIMARY_SOURCES_V1,
    normalizedClaimsDigest: OPENAI_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  }),
  pricing: OPENAI_PRICE_CATALOGUE_V2,
  keyInventory: AI_GATEWAY_KEY_INVENTORY_V1,
})
