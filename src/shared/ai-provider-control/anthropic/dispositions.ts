import { z } from 'zod/v4'
import {
  parseAiProviderJsonBytes,
  type AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import {
  classifyProviderRefusalBase,
  classifyProviderStatusBase,
  type ProviderRefusalBase,
} from '../dispositions'

export type AnthropicProviderDisposition = AiSettlementRequestV1['disposition']

export type AnthropicStatusDisposition = Readonly<{
  status: number
  disposition: Extract<
    AnthropicProviderDisposition,
    | 'success'
    | 'rate_limited'
    | 'quota_exhausted'
    | 'provider_unavailable'
    | 'provider_refused'
  >
  retryable: boolean
  circuitFailure: boolean
}>

export function classifyAnthropicStatus(status: number): AnthropicStatusDisposition {
  // Anthropic documents 529. The other statuses deliberately match OpenAI's
  // zero-use retryable treatment for the same complete HTTP answers.
  return classifyProviderStatusBase(status, {
    label: 'Anthropic',
    retryableUnavailableStatuses: [500, 502, 503, 504, 529],
    quotaStatuses: [402],
  }) as AnthropicStatusDisposition
}

const anthropicErrorBodySchema = z.looseObject({
  error: z.looseObject({
    type: z.string(),
    message: z.string(),
    details: z.looseObject({ error_code: z.string().optional() }).optional(),
  }),
})

const QUOTA_MESSAGE_PREFIXES = Object.freeze([
  'you have reached your specified api usage limits',
  'you have reached your specified workspace api usage limits',
  'your credit balance is too low',
])

export function isAnthropicQuotaExhaustedBody(
  input: Readonly<{ status: number; bytes: Uint8Array | null; maxBytes: number }>,
): boolean {
  if (input.status === 402) return true
  if (input.bytes === null || input.bytes.byteLength === 0) return false
  try {
    const body = parseAiProviderJsonBytes(
      input.bytes,
      input.maxBytes,
      anthropicErrorBodySchema,
    )
    if (
      input.status === 429 &&
      body.error.details?.error_code === 'enforced_spend_limit_reached'
    ) {
      return true
    }
    if (input.status !== 400 || body.error.type !== 'invalid_request_error') {
      return false
    }
    const message = body.error.message.trim().toLowerCase()
    return QUOTA_MESSAGE_PREFIXES.some((prefix) => message.startsWith(prefix))
  } catch {
    return false
  }
}

export type AnthropicRefusal = ProviderRefusalBase

export function classifyAnthropicRefusal(
  response: Readonly<{
    completeStatus: number | null
    decodedResponseBytes: Uint8Array | null
    retryAfterSeconds: number | null
  }>,
  maxBytes: number,
): AnthropicRefusal {
  return classifyProviderRefusalBase(response, {
    incompleteMessage: 'An incomplete answer is no refusal',
    successMessage: 'A 200 is no refusal',
    classifyStatus: classifyAnthropicStatus,
    isQuota: (status, bytes) =>
      isAnthropicQuotaExhaustedBody({ status, bytes, maxBytes }),
  })
}
