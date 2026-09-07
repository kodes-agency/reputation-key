import { createHash } from 'node:crypto'
import type { AiAdmissionDescriptorV1 } from './ai-internal-transport-contract'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { assertClosedJsonAndFreeze } from './closed-json-contract'

// `gpt-5.6-luna` has no dated snapshot: the provider publishes only this floating
// alias (`gpt-5.6-luna-2026-06-23`, `-medium` and `-mini` all 404). Accepted
// deliberately — see docs/operations/model-switch-5-6-luna-2026-08-19.md. The
// consequence is that provider-side behaviour can change without any digest in this
// repo moving, so the release canary is the only detector.
export const OPENAI_MODEL_SNAPSHOT = 'gpt-5.6-luna' as const

// This model REJECTS `in_memory` with 400 "This model is compatible only with 24h
// extended prompt caching". It is also a merchant-facing retention claim, mirrored in
// OPENAI_NORMALIZED_EVIDENCE_CLAIMS_V1 and the deployment contract.
//
// Safe against the cost ceiling: caching requires >=1024 input tokens and every route
// here sends 162-226, so no cache write can be billed. `maximumCostMicros` therefore
// needs no cache-write term. Add one if any source byte limit is ever raised.
export const OPENAI_PROMPT_CACHE_RETENTION = '24h' as const

/**
 * Every model snapshot whose provenance this deployment can still VERIFY, newest
 * first. `OPENAI_MODEL_SNAPSHOT` is what new requests are sent with; this set is what
 * already-persisted reply provenance is parsed against.
 *
 * Provenance is append-only evidence: a draft signed under an earlier model stays
 * valid at the snapshot it was signed under. Pinning `z.literal(OPENAI_MODEL_SNAPSHOT)`
 * instead would make every stored draft unparseable the moment the model moves — the
 * same failure the consent notice hit when its CHECK pinned a single version.
 * Never remove an entry that could still appear in a stored row.
 */
export const OPENAI_KNOWN_MODEL_SNAPSHOTS = Object.freeze([
  'gpt-5.6-luna',
  'gpt-5.4-mini-2026-03-17',
] as const)
export const OPENAI_PROMPT_VERSIONS = Object.freeze({
  'review-analysis': 'review-analysis-prompt-v1',
  'reply-suggestion': 'reply-suggestion-prompt-v1',
  'property-trend': 'property-trend-prompt-v1',
  'synthetic-canary': 'synthetic-canary-prompt-v1',
} as const)

/**
 * The reasoning ladder this deployment governs. Mirrored EXACTLY by the
 * frozen operation profiles, so widening this set requires regenerating those profiles.
 *
 * Excluded on purpose:
 * - `minimal`: the pinned model snapshot rejects it with 400 `Unsupported value`.
 * - `xhigh` / `max`: measured against the live deployment, these exhaust the whole
 *   output budget on reasoning and return an EMPTY body on every non-trivial route
 *   (analysis 4096, trend 8192, reply 6144 tokens, all `max_output_tokens`
 *   truncated). Re-admitting either requires new measurements, not a type edit.
 */
export const AI_REASONING_EFFORTS_V1 = Object.freeze([
  'none',
  'low',
  'medium',
  'high',
] as const)

export type AiReasoningEffortV1 = (typeof AI_REASONING_EFFORTS_V1)[number]

export type AiGatewayRoute = AiAdmissionDescriptorV1['route']

export type ClosedJsonSchemaFormat = Readonly<{
  type: 'json_schema'
  name: string
  strict: true
  schema: Readonly<Record<string, unknown>>
}>

export type ClosedOpenAiRequest = Readonly<{
  model: typeof OPENAI_MODEL_SNAPSHOT
  input: readonly [
    Readonly<{ role: 'developer'; content: string }>,
    Readonly<{ role: 'user'; content: string }>,
  ]
  reasoning: Readonly<{ effort: AiReasoningEffortV1 }>
  text: Readonly<{ format: ClosedJsonSchemaFormat }>
  max_output_tokens: number
  safety_identifier: `rk1_${string}`
  prompt_cache_key: string
  prompt_cache_retention: typeof OPENAI_PROMPT_CACHE_RETENTION
  service_tier: 'default'
  store: false
  stream: false
  background: false
  tools: readonly []
  truncation: 'disabled'
}>

export type OpenAiStaticTokenBearingMaterial = Readonly<{
  input: readonly [
    Readonly<{ role: 'developer'; content: string }>,
    Readonly<{ role: 'user'; content: '' }>,
  ]
  text: Readonly<{ format: ClosedJsonSchemaFormat }>
}>

const TOKEN = /^[a-z0-9][a-z0-9._-]*$/
const STATIC_TOKEN_DOMAIN = 'repkey-ai-static-token-bearing-v1\0'

function assertClosedFormat(format: ClosedJsonSchemaFormat): void {
  if (
    format.type !== 'json_schema' ||
    format.strict !== true ||
    !TOKEN.test(format.name) ||
    Object.keys(format).length !== 4 ||
    typeof format.schema !== 'object' ||
    format.schema === null
  ) {
    throw new TypeError('Invalid closed OpenAI structured-output format')
  }
}

function tokenBearingMaterial(
  input: Readonly<{
    developerMessage: string
    format: ClosedJsonSchemaFormat
  }>,
): OpenAiStaticTokenBearingMaterial {
  if (input.developerMessage.length === 0) {
    throw new TypeError('OpenAI developer message is empty')
  }
  assertClosedFormat(input.format)
  const material: OpenAiStaticTokenBearingMaterial = {
    input: [
      { role: 'developer', content: input.developerMessage },
      { role: 'user', content: '' },
    ],
    text: { format: input.format },
  }
  assertClosedJsonAndFreeze(material, 'OpenAI request value')
  return material
}

export function renderOpenAiStaticTokenBearingMaterial(
  input: Readonly<{
    developerMessage: string
    format: ClosedJsonSchemaFormat
  }>,
): Readonly<{
  material: OpenAiStaticTokenBearingMaterial
  canonicalBytes: Uint8Array
  byteLength: number
  digest: string
}> {
  const material = tokenBearingMaterial(input)
  const canonicalBytes = Buffer.from(canonicalizeRfc8785(material), 'utf8')
  return Object.freeze({
    material,
    canonicalBytes,
    byteLength: canonicalBytes.byteLength,
    digest: createHash('sha256')
      .update(STATIC_TOKEN_DOMAIN, 'utf8')
      .update(canonicalBytes)
      .digest('hex'),
  })
}

export function buildClosedOpenAiRequest(
  input: Readonly<{
    route: AiGatewayRoute
    promptVersion: string
    promptCacheShard: number
    developerMessage: string
    untrustedData: string
    format: ClosedJsonSchemaFormat
    maxOutputTokens: number
    reasoningEffort: AiReasoningEffortV1
    safetyIdentifier: `rk1_${string}`
  }>,
): ClosedOpenAiRequest {
  if (
    !TOKEN.test(input.route) ||
    input.promptVersion !== OPENAI_PROMPT_VERSIONS[input.route] ||
    !Number.isSafeInteger(input.promptCacheShard) ||
    input.promptCacheShard < 0 ||
    input.promptCacheShard > 15 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    !AI_REASONING_EFFORTS_V1.includes(input.reasoningEffort) ||
    !/^rk1_[A-Za-z0-9_-]{43}$/.test(input.safetyIdentifier) ||
    input.developerMessage.length === 0 ||
    input.untrustedData.length === 0
  ) {
    throw new TypeError('Invalid closed OpenAI request input')
  }
  assertClosedFormat(input.format)
  if (input.route === 'synthetic-canary' && input.promptCacheShard !== 0) {
    throw new TypeError('Synthetic canary cache shard must be zero')
  }
  const shard = input.promptCacheShard.toString(16).padStart(2, '0')
  const promptCacheKey = `rk:${input.route}:${input.promptVersion}:${shard}`
  if (Buffer.byteLength(promptCacheKey, 'utf8') > 64) {
    throw new TypeError('OpenAI prompt cache key exceeds 64 bytes')
  }
  const request: ClosedOpenAiRequest = {
    model: OPENAI_MODEL_SNAPSHOT,
    input: [
      { role: 'developer', content: input.developerMessage },
      { role: 'user', content: input.untrustedData },
    ],
    reasoning: { effort: input.reasoningEffort },
    text: { format: input.format },
    max_output_tokens: input.maxOutputTokens,
    safety_identifier: input.safetyIdentifier,
    prompt_cache_key: promptCacheKey,
    prompt_cache_retention: OPENAI_PROMPT_CACHE_RETENTION,
    service_tier: 'default',
    store: false,
    stream: false,
    background: false,
    tools: [],
    truncation: 'disabled',
  }
  assertClosedJsonAndFreeze(request, 'OpenAI request value')
  return request
}
