import { createHash } from 'node:crypto'
import type { AiReasoningEffortV1 } from '#/shared/ai-openai-request-contract'
import { assertClosedJsonAndFreeze } from '#/shared/closed-json-contract'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import {
  ANTHROPIC_MODEL_SNAPSHOT,
  ANTHROPIC_REASONING_EFFORT_MAPPING_V1,
} from './request-profile'

export type AnthropicWireSchema = Readonly<Record<string, unknown>>

export type ClosedAnthropicRequest = Readonly<{
  model: typeof ANTHROPIC_MODEL_SNAPSHOT
  max_tokens: number
  system: string
  messages: readonly [Readonly<{ role: 'user'; content: string }>]
  metadata: Readonly<{ user_id: `rk1_${string}` }>
  thinking: Readonly<{ type: 'adaptive' | 'disabled' }>
  output_config: Readonly<{
    effort: 'low' | 'medium' | 'high'
    format: Readonly<{ type: 'json_schema'; schema: AnthropicWireSchema }>
  }>
}>

export type AnthropicStaticTokenBearingMaterial = Readonly<{
  system: string
  messages: readonly [Readonly<{ role: 'user'; content: '' }>]
  output_config: Readonly<{
    format: Readonly<{ type: 'json_schema'; schema: AnthropicWireSchema }>
  }>
}>

function assertBuilderInput(
  input: Readonly<{
    developerPrompt: string
    untrustedData: string
    wireSchema: AnthropicWireSchema
    maxOutputTokens: number
    reasoningEffort: AiReasoningEffortV1
    safetyIdentifier: string
  }>,
): void {
  if (
    input.developerPrompt.length === 0 ||
    input.untrustedData.length === 0 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    !Object.hasOwn(ANTHROPIC_REASONING_EFFORT_MAPPING_V1, input.reasoningEffort) ||
    !/^rk1_[A-Za-z0-9_-]{43}$/u.test(input.safetyIdentifier) ||
    typeof input.wireSchema !== 'object' ||
    input.wireSchema === null
  ) {
    throw new TypeError('Invalid closed Anthropic request input')
  }
}

export function buildClosedAnthropicRequest(
  input: Readonly<{
    developerPrompt: string
    untrustedData: string
    wireSchema: AnthropicWireSchema
    maxOutputTokens: number
    reasoningEffort: AiReasoningEffortV1
    safetyIdentifier: `rk1_${string}`
  }>,
): ClosedAnthropicRequest {
  assertBuilderInput(input)
  const reasoning = ANTHROPIC_REASONING_EFFORT_MAPPING_V1[input.reasoningEffort]
  const request: ClosedAnthropicRequest = {
    model: ANTHROPIC_MODEL_SNAPSHOT,
    max_tokens: input.maxOutputTokens,
    system: input.developerPrompt,
    messages: [{ role: 'user', content: input.untrustedData }],
    metadata: { user_id: input.safetyIdentifier },
    thinking: reasoning.thinking,
    output_config: {
      effort: reasoning.effort,
      format: { type: 'json_schema', schema: input.wireSchema },
    },
  }
  assertClosedJsonAndFreeze(request, 'Anthropic request value')
  return request
}

export function renderAnthropicStaticTokenBearingMaterial(
  input: Readonly<{ developerPrompt: string; wireSchema: AnthropicWireSchema }>,
): Readonly<{
  material: AnthropicStaticTokenBearingMaterial
  canonicalBytes: Uint8Array
  byteLength: number
  digest: string
}> {
  if (input.developerPrompt.length === 0) {
    throw new TypeError('Anthropic developer prompt is empty')
  }
  const material: AnthropicStaticTokenBearingMaterial = {
    system: input.developerPrompt,
    messages: [{ role: 'user', content: '' }],
    output_config: {
      format: { type: 'json_schema', schema: input.wireSchema },
    },
  }
  assertClosedJsonAndFreeze(material, 'Anthropic request value')
  const canonicalBytes = Buffer.from(canonicalizeRfc8785(material), 'utf8')
  return Object.freeze({
    material,
    canonicalBytes,
    byteLength: canonicalBytes.byteLength,
    digest: createHash('sha256')
      .update('repkey-anthropic-static-token-bearing-v1\0', 'utf8')
      .update(canonicalBytes)
      .digest('hex'),
  })
}
