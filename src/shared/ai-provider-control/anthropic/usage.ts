import { z } from 'zod/v4'
import { operationProviderPairing } from '#/shared/ai-operation-provider-pairings'
import { providerUsageOfDecodedBody } from '../connector-boundary'
import type { AiProviderUsage } from '../provider-contracts'
import type { PreparedAnthropicInvocation } from './prepared-invocation'

const nonnegativeSafeInteger = z.number().int().nonnegative().safe()

const anthropicUsageSchema = z.looseObject({
  input_tokens: nonnegativeSafeInteger,
  output_tokens: nonnegativeSafeInteger,
  cache_creation_input_tokens: nonnegativeSafeInteger.nullish().default(0),
  cache_read_input_tokens: nonnegativeSafeInteger.nullish().default(0),
  output_tokens_details: z
    .looseObject({ thinking_tokens: nonnegativeSafeInteger })
    .nullish(),
})

function inputTokenCeiling(invocation: PreparedAnthropicInvocation): number | null {
  const operationProfileVersion =
    invocation.descriptor.subjectKind === 'property'
      ? invocation.descriptor.binding.operationProfileVersion
      : invocation.descriptor.canaryBinding.operationProfileVersion
  const pairing = operationProviderPairing(operationProfileVersion, 'anthropic')
  if (pairing === null) return null
  const ceiling =
    pairing.staticTokenBearing.bytes + invocation.descriptor.providerPayloadByteCount
  return Number.isSafeInteger(ceiling) ? ceiling : null
}

type AnthropicUsageInvariant =
  | 'usage_shape'
  | 'input_ceiling_unknown'
  | 'input_sum_unsafe'
  | 'total_sum_unsafe'
  | 'reasoning_above_output'
  | 'output_above_limit'
  | 'input_above_ceiling'

// Unlike OpenAI's synthetic canary, this dark adapter has no route on which
// counts may be logged. Keep the invariant names for diagnosis in code/tests,
// but emit no tenant usage values.
function anthropicUsageRejected(_invariant: AnthropicUsageInvariant): null {
  return null
}

function anthropicUsageInvariantOf(
  input: Readonly<{
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    totalTokens: number
    outputLimit: number
    inputCeiling: number
  }>,
): AnthropicUsageInvariant | null {
  if (!Number.isSafeInteger(input.inputTokens)) return 'input_sum_unsafe'
  if (!Number.isSafeInteger(input.totalTokens)) return 'total_sum_unsafe'
  if (input.reasoningTokens > input.outputTokens) return 'reasoning_above_output'
  if (input.outputTokens > input.outputLimit) return 'output_above_limit'
  if (input.inputTokens > input.inputCeiling) return 'input_above_ceiling'
  return null
}

export function parseAnthropicUsage(
  value: unknown,
  invocation: PreparedAnthropicInvocation,
): AiProviderUsage | null {
  const parsed = anthropicUsageSchema.safeParse(value)
  if (!parsed.success) return anthropicUsageRejected('usage_shape')
  const usage = parsed.data
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0
  const inputTokens = usage.input_tokens + cacheReadInputTokens + cacheCreationInputTokens
  const reasoningTokens = usage.output_tokens_details?.thinking_tokens ?? 0
  const totalTokens = inputTokens + usage.output_tokens
  const ceiling = inputTokenCeiling(invocation)
  if (ceiling === null) return anthropicUsageRejected('input_ceiling_unknown')
  const violated = anthropicUsageInvariantOf({
    inputTokens,
    outputTokens: usage.output_tokens,
    reasoningTokens,
    totalTokens,
    outputLimit: invocation.descriptor.limits.outputTokens,
    inputCeiling: ceiling,
  })
  if (violated !== null) return anthropicUsageRejected(violated)
  return Object.freeze({
    inputTokens,
    cachedTokens: cacheReadInputTokens,
    outputTokens: usage.output_tokens,
    reasoningTokens,
    totalTokens,
  })
}

export function anthropicUsageOfDecodedBody(
  bytes: Uint8Array | null,
  invocation: PreparedAnthropicInvocation,
): AiProviderUsage | null {
  return providerUsageOfDecodedBody(bytes, invocation, parseAnthropicUsage)
}
