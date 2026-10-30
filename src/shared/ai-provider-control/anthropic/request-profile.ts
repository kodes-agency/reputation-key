import type { AiReasoningEffortV1 } from '#/shared/ai-openai-request-contract'
import { digestProviderAttestationValue } from '#/shared/ai-provider-attestations'

// The provider publishes no dated snapshot id for the Claude 5.x line. The
// evaluation harness (slice 3.9) chooses the final model and activation (3.10)
// re-pins it before any real review can be sent.
export const ANTHROPIC_MODEL_SNAPSHOT = 'claude-haiku-5-5' as const
export const ANTHROPIC_API_VERSION = '2026-10-21' as const
export const ANTHROPIC_HOSTNAME = 'api.anthropic.com' as const
export const ANTHROPIC_MESSAGES_URL = `https://${ANTHROPIC_HOSTNAME}/v1/messages` as const
export const ANTHROPIC_USER_AGENT = 'repkey-ai-egress-gateway/1.0' as const
export const ANTHROPIC_SDK_VERSION = '1.3.0' as const
// Inert backstop above every provider deadline. The gateway signal governs.
export const ANTHROPIC_SDK_TIMEOUT_MILLIS = 120_000

export type AnthropicReasoningConfiguration = Readonly<{
  thinking: Readonly<{ type: 'adaptive' | 'disabled' }>
  effort: 'low' | 'medium' | 'high'
}>

export const ANTHROPIC_REASONING_EFFORT_MAPPING_V1: Readonly<
  Record<AiReasoningEffortV1, AnthropicReasoningConfiguration>
> = Object.freeze({
  none: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }), effort: 'low' }),
  low: Object.freeze({ thinking: Object.freeze({ type: 'adaptive' }), effort: 'low' }),
  medium: Object.freeze({
    thinking: Object.freeze({ type: 'adaptive' }),
    effort: 'medium',
  }),
  high: Object.freeze({
    thinking: Object.freeze({ type: 'adaptive' }),
    effort: 'high',
  }),
})

export const ANTHROPIC_STRUCTURED_OUTPUT_LIMITS = Object.freeze({
  unionParameters: 16,
  optionalParameters: 24,
})

// Provisional reservation allowance for the provider-injected structured-output
// prompt. WP0 must replace it with a measurement before activation.
export const ANTHROPIC_STRUCTURED_OUTPUT_OVERHEAD_TOKENS = 1_024

export const ANTHROPIC_REQUEST_SHAPE_V1 = Object.freeze({
  model: ANTHROPIC_MODEL_SNAPSHOT,
  max_tokens: 'route-profile-integer',
  system: 'versioned-developer-prompt',
  messages: Object.freeze([
    Object.freeze({ role: 'user', content: 'one-redacted-untrusted-data-block' }),
  ]),
  metadata: Object.freeze({ user_id: 'route-closed-rk1-v1' }),
  thinking: Object.freeze({
    selectedBy: 'route-profile-reasoning-effort',
    mapping: ANTHROPIC_REASONING_EFFORT_MAPPING_V1,
  }),
  output_config: Object.freeze({
    effort: 'selected-from-reasoning-mapping',
    format: Object.freeze({ type: 'json_schema', schema: 'anthropic-wire-schema-v1' }),
  }),
  absent: Object.freeze([
    'temperature',
    'top_p',
    'top_k',
    'stop_sequences',
    'stream',
    'tools',
    'tool_choice',
    'service_tier',
    'inference_geo',
    'container',
    'context_management',
    'cache_control',
    'betas',
    'store',
    'truncation',
    'assistant_prefill',
    'thinking.budget_tokens',
    'anthropic-beta',
  ]),
})

export const ANTHROPIC_REQUEST_SHAPE_V1_DIGEST = digestProviderAttestationValue(
  'repkey-anthropic-request-shape-v1\0',
  ANTHROPIC_REQUEST_SHAPE_V1,
)

export const ANTHROPIC_PROVIDER_PRIMARY_SOURCES_V1 = Object.freeze({
  models: 'https://platform.claude.com/docs/en/about-claude/models/overview',
  messages: 'https://platform.claude.com/docs/en/api/messages',
  structuredOutputs:
    'https://platform.claude.com/docs/en/build-with-claude/structured-outputs',
  errors: 'https://platform.claude.com/docs/en/api/errors',
  rateLimits: 'https://platform.claude.com/docs/en/api/rate-limits',
  dataUsage: 'https://privacy.claude.com/en/articles/7996868',
  pricing: 'https://platform.claude.com/docs/en/about-claude/pricing',
  sdk: 'https://github.com/anthropics/anthropic-sdk-typescript/tree/v1.3.0',
})

export const ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_V1 = Object.freeze({
  provider: 'anthropic',
  api: 'messages-v1',
  endpoint: ANTHROPIC_MESSAGES_URL,
  modelSnapshot: ANTHROPIC_MODEL_SNAPSHOT,
  structuredOutputs: 'json-schema-grammar',
  apiVersion: ANTHROPIC_API_VERSION,
  store: false,
  apiInputOutputRetention: 'deleted-within-30-days',
  flaggedContentRetention: 'up-to-2-years',
  trustSafetyScoreRetention: 'up-to-7-years',
  trainingPosture: 'commercial-terms-no-training-on-customer-content',
  zeroDataRetentionClaim: 'none-unless-agreed',
  providerResidencyClaim: 'none',
  providerIdempotencyMode: 'none',
  sdkMaxRetries: 0,
  redirectMode: 'manual_no_follow',
  successStatus: 200,
})

// The posture claims above are provisional evidence from the 2026-10-29
// provider analysis. Slice 3.10 confirms them with counsel before a notice names
// Anthropic or activation can process real reviews.
export const ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1 =
  digestProviderAttestationValue(
    'repkey-anthropic-provider-normalized-claims-v1\0',
    ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_V1,
  )

export const ANTHROPIC_PRICE_CATALOGUE_V1 = Object.freeze({
  catalogueId: 'anthropic-claude-haiku-5-5-standard-2026-10-30',
  modelSnapshot: ANTHROPIC_MODEL_SNAPSHOT,
  serviceTier: 'standard',
  unitTokens: 1_000_000,
  uncachedInputMicros: 100_000,
  cachedInputMicros: 10_000,
  outputMicros: 500_000,
  sourceUrl: ANTHROPIC_PROVIDER_PRIMARY_SOURCES_V1.pricing,
  retrievalDate: '2026-10-30',
})

export const ANTHROPIC_PROVIDER_DEPLOYMENT_CONTRACT_V1 = Object.freeze({
  sdkVersion: ANTHROPIC_SDK_VERSION,
  dispatcherVersion: 'undici@8.12.3',
  endpoint: ANTHROPIC_MESSAGES_URL,
  apiVersion: ANTHROPIC_API_VERSION,
  providerFallback: 'none',
  sdkMaxRetries: 0,
  maxHttpRequestsPerPermit: 1,
  possibleDispatchBoundary: 'outbound_fetch_invocation',
  redirectMode: 'manual_no_follow',
  successStatus: 200,
  successMediaTypeProfile: 'application-json-utf8-v1',
  clientRequestIdProfile: 'none',
  retryAfterProfile: 'delta-seconds-1-to-300-v1',
  statusDispositionProfile: 'anthropic-status-disposition-v1',
  // Anthropic documents 529. The 500/502/503/504 rows intentionally follow the
  // existing OpenAI zero-use treatment for identical complete statuses.
  retryableCompleteStatuses: Object.freeze([429, 500, 502, 503, 504, 529] as const),
  evidence: Object.freeze({
    retrievalDate: '2026-10-30',
    primarySources: ANTHROPIC_PROVIDER_PRIMARY_SOURCES_V1,
    normalizedClaimsDigest: ANTHROPIC_NORMALIZED_EVIDENCE_CLAIMS_DIGEST_V1,
  }),
  // The higher >100k-token tier is unreachable: route request caps are far below it.
  pricing: ANTHROPIC_PRICE_CATALOGUE_V1,
})
