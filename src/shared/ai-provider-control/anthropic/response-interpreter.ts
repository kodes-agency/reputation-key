import { z } from 'zod/v4'
import { parseAiProviderJsonBytes } from '#/shared/ai-internal-transport-contract'
import type { AiProviderOutcome } from '../provider-contracts'
import { PROVIDER_ZERO_USAGE, providerConnectorOutcome } from '../connector-boundary'
import type { PreparedAnthropicInvocation } from './prepared-invocation'
import { parseAnthropicUsage } from './usage'

// Every field but the usage is read leniently: the provider adds stop reasons and
// refusal categories over time, and a billed answer must never lose its usage
// because a word in it is new. What is not understood is refused, not misread.
const messageSchema = z.looseObject({
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  stop_details: z
    .looseObject({ category: z.string().nullable().optional() })
    .nullable()
    .optional(),
})

const REFUSAL_CATEGORIES: ReadonlySet<string> = new Set([
  'cyber',
  'bio',
  'frontier_llm',
  'reasoning_extraction',
  'general_harms',
])

// A closed vocabulary only: the provider's own words never reach a log line.
function refusalCategoryOf(category: string | null | undefined): string | null {
  if (category === null || category === undefined) return null
  return REFUSAL_CATEGORIES.has(category) ? category : 'unlisted'
}

function invalidOutcome(
  reportedDisposition: 'success' | 'provider_refused',
  usage: ReturnType<typeof parseAnthropicUsage>,
): AiProviderOutcome<unknown> {
  return providerConnectorOutcome({
    disposition: 'output_invalid',
    reportedDisposition,
    result: null,
    usageKnown: usage !== null,
    providerRetryable: false,
    usage: usage ?? PROVIDER_ZERO_USAGE,
    retryAfterSeconds: null,
    outboundFetchUsed: true,
  })
}

export function interpretAnthropicMessage(
  value: unknown,
  invocation: PreparedAnthropicInvocation,
  maxResponseBytes: number,
): AiProviderOutcome<unknown> {
  const usage = parseAnthropicUsage(
    typeof value === 'object' && value !== null
      ? (value as Readonly<{ usage?: unknown }>).usage
      : undefined,
    invocation,
  )
  const parsed = messageSchema.safeParse(value)
  if (!parsed.success) return invalidOutcome('success', usage)
  const message = parsed.data
  const reportedRefusal = message.stop_reason === 'refusal'
  if (usage === null) {
    return invalidOutcome(reportedRefusal ? 'provider_refused' : 'success', null)
  }
  if (reportedRefusal) {
    process.stderr.write(
      `${JSON.stringify({
        event: 'anthropic_refusal',
        route: invocation.descriptor.route,
        category: refusalCategoryOf(message.stop_details?.category),
      })}\n`,
    )
    return providerConnectorOutcome({
      disposition: 'provider_refused',
      result: null,
      usageKnown: true,
      providerRetryable: false,
      usage,
      retryAfterSeconds: null,
      outboundFetchUsed: true,
    })
  }
  if (
    message.stop_reason === 'max_tokens' ||
    message.stop_reason === 'model_context_window_exceeded'
  ) {
    process.stderr.write(
      `${JSON.stringify({
        event: 'anthropic_output_truncated',
        route: invocation.descriptor.route,
        stopReason: message.stop_reason,
        outputTokens: usage.outputTokens,
        thinkingTokens: usage.reasoningTokens,
        maxOutputTokens: invocation.sdkRequest.max_tokens,
      })}\n`,
    )
    return providerConnectorOutcome({
      disposition: 'output_truncated',
      reportedDisposition: 'success',
      result: null,
      usageKnown: true,
      providerRetryable: false,
      usage,
      retryAfterSeconds: null,
      outboundFetchUsed: true,
    })
  }
  if (message.stop_reason !== 'end_turn') return invalidOutcome('success', usage)
  const textBlocks = message.content.filter((block) => block.type === 'text')
  const onlyPermittedBlocks = message.content.every((block) =>
    ['text', 'thinking', 'redacted_thinking'].includes(block.type),
  )
  const text = textBlocks[0]?.text
  if (!onlyPermittedBlocks || textBlocks.length !== 1 || text === undefined) {
    return invalidOutcome('success', usage)
  }
  let result: Record<string, unknown>
  try {
    result = parseAiProviderJsonBytes(
      new TextEncoder().encode(text),
      maxResponseBytes,
      z.record(z.string(), z.unknown()),
    )
  } catch {
    return invalidOutcome('success', usage)
  }
  // Anthropic enforces only part of the route schema on the wire. A billed
  // answer that is merely out of range is returned unchanged and repaired by
  // `acceptProviderResult`, the v3 normalizer and single acceptance point.
  return providerConnectorOutcome({
    disposition: 'success',
    result,
    usageKnown: true,
    providerRetryable: false,
    usage,
    retryAfterSeconds: null,
    outboundFetchUsed: true,
  })
}
