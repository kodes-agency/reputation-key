import { createHash } from 'node:crypto'
import type { AiAdmissionDescriptorV1 } from './ai-internal-transport-contract'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { assertClosedJsonAndFreeze } from './closed-json-contract'

export const OPENAI_MODEL_SNAPSHOT = 'gpt-5.4-mini-2026-03-17' as const
export const OPENAI_PROMPT_VERSIONS = Object.freeze({
  'review-analysis': 'review-analysis-prompt-v1',
  'reply-suggestion': 'reply-suggestion-prompt-v1',
  'property-trend': 'property-trend-prompt-v1',
  'synthetic-canary': 'synthetic-canary-prompt-v1',
} as const)

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
  reasoning: Readonly<{ effort: 'xhigh' }>
  text: Readonly<{ format: ClosedJsonSchemaFormat }>
  max_output_tokens: number
  safety_identifier: `rk1_${string}`
  prompt_cache_key: string
  prompt_cache_retention: 'in_memory'
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
    reasoning: { effort: 'xhigh' },
    text: { format: input.format },
    max_output_tokens: input.maxOutputTokens,
    safety_identifier: input.safetyIdentifier,
    prompt_cache_key: promptCacheKey,
    prompt_cache_retention: 'in_memory',
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
