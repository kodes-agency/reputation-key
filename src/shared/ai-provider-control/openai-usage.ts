import { z } from 'zod/v4'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import type { OpenAiUsageV1, PreparedAiInvocation } from './contracts'

function inputTokenCeiling(invocation: PreparedAiInvocation): number | null {
  const operationProfileVersion =
    invocation.descriptor.subjectKind === 'property'
      ? invocation.descriptor.binding.operationProfileVersion
      : invocation.descriptor.canaryBinding.operationProfileVersion
  const profile = AI_OPERATION_PROFILES.find(
    (candidate) =>
      candidate.profileVersion === operationProfileVersion &&
      candidate.sourceRoute === invocation.descriptor.route,
  )
  if (profile === undefined) return null
  const ceiling =
    profile.staticTokenBearingBytes + invocation.descriptor.providerPayloadByteCount
  return Number.isSafeInteger(ceiling) ? ceiling : null
}

/**
 * A rejected usage block is reported for the SYNTHETIC-CANARY route only, where
 * the corpus is synthetic and the operator is holding a release gate: naming the
 * failed invariant (and its counts) is the difference between a diagnosable gate
 * and an unactionable `output_invalid`. Tenant routes stay silent.
 */
function usageRejected(
  invocation: PreparedAiInvocation,
  invariant: string,
  counts?: Readonly<Record<string, number>>,
): null {
  if (invocation.descriptor.route === 'synthetic-canary') {
    process.stderr.write(
      `${JSON.stringify({ event: 'canary_usage_rejected', invariant, ...(counts ?? {}) })}\n`,
    )
  }
  return null
}

export function parseUsage(
  value: unknown,
  invocation: PreparedAiInvocation,
): OpenAiUsageV1 | null {
  // `input_tokens_details` / `output_tokens_details` are optional in the
  // Responses payload. Requiring them classified an otherwise successful,
  // fully-accounted call as `output_invalid` with usage unknown, which failed
  // the release gate for a provider-shape difference rather than a real fault.
  // Absent sub-counters default to 0; every inequality below still holds
  // because 0 can only make the checks stricter.
  const parsed = z
    .object({
      input_tokens: z.number().int().nonnegative().safe(),
      input_tokens_details: z
        .object({ cached_tokens: z.number().int().nonnegative().safe().default(0) })
        .passthrough()
        .default({ cached_tokens: 0 }),
      output_tokens: z.number().int().nonnegative().safe(),
      output_tokens_details: z
        .object({ reasoning_tokens: z.number().int().nonnegative().safe().default(0) })
        .passthrough()
        .default({ reasoning_tokens: 0 }),
      total_tokens: z.number().int().nonnegative().safe(),
    })
    .passthrough()
    .safeParse(value)
  if (!parsed.success) return usageRejected(invocation, 'usage_shape')
  const maximumInputTokens = inputTokenCeiling(invocation)
  if (maximumInputTokens === null)
    return usageRejected(invocation, 'input_ceiling_unknown')
  const usage = parsed.data
  const violated =
    usage.input_tokens_details.cached_tokens > usage.input_tokens
      ? 'cached_above_input'
      : usage.output_tokens_details.reasoning_tokens > usage.output_tokens
        ? 'reasoning_above_output'
        : usage.total_tokens !== usage.input_tokens + usage.output_tokens
          ? 'total_mismatch'
          : usage.output_tokens > invocation.descriptor.limits.outputTokens
            ? 'output_above_limit'
            : usage.input_tokens > maximumInputTokens
              ? 'input_above_ceiling'
              : null
  if (violated !== null) {
    return usageRejected(invocation, violated, {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      reasoningTokens: usage.output_tokens_details.reasoning_tokens,
      totalTokens: usage.total_tokens,
      outputLimit: invocation.descriptor.limits.outputTokens,
      inputCeiling: maximumInputTokens,
    })
  }
  return Object.freeze({
    inputTokens: usage.input_tokens,
    cachedTokens: usage.input_tokens_details.cached_tokens,
    outputTokens: usage.output_tokens,
    reasoningTokens: usage.output_tokens_details.reasoning_tokens,
    totalTokens: usage.total_tokens,
  })
}

/**
 * The usage block of a 200 body the official SDK then failed to parse.
 *
 * The SDK parses a completed answer with the route's zod schema and throws when
 * it does not hold (a refinement JSON Schema cannot state, say). The call was
 * billed and its `usage` block was as valid as any: reading it back keeps the
 * token counts and lets the call settle at what it cost, not at the reservation
 * ceiling. Only the `usage` member is read; nothing else of the body is kept,
 * logged or returned, and a body that does not parse, or a usage block that does
 * not add up, is unknown usage as before.
 */
export function usageOfDecodedBody(
  bytes: Uint8Array | null,
  invocation: PreparedAiInvocation,
): OpenAiUsageV1 | null {
  if (bytes === null) return null
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  return parseUsage((body as Readonly<{ usage?: unknown }>).usage, invocation)
}
