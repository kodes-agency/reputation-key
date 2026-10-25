import { z } from 'zod/v4'
import {
  parseAiProviderJsonBytes,
  type AiSettlementRequestV1,
} from '#/shared/ai-internal-transport-contract'
import type { OpenAiConnectorOutcome } from './contracts'

export type OpenAiProviderDisposition = AiSettlementRequestV1['disposition']

export type OpenAiStatusDisposition = Readonly<{
  status: number
  disposition: Extract<
    OpenAiProviderDisposition,
    'success' | 'rate_limited' | 'provider_unavailable' | 'provider_refused'
  >
  retryable: boolean
  circuitFailure: boolean
}>

export function classifyOpenAiStatus(status: number): OpenAiStatusDisposition {
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new TypeError('Invalid OpenAI HTTP status')
  }
  if (status === 200) {
    return Object.freeze({
      status,
      disposition: 'success',
      retryable: false,
      circuitFailure: false,
    })
  }
  if (status === 429) {
    return Object.freeze({
      status,
      disposition: 'rate_limited',
      retryable: true,
      circuitFailure: true,
    })
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return Object.freeze({
      status,
      disposition: 'provider_unavailable',
      retryable: true,
      circuitFailure: true,
    })
  }
  if (
    status >= 400 &&
    status <= 499 &&
    status !== 401 &&
    status !== 403 &&
    status !== 404 &&
    status !== 408 &&
    status !== 409
  ) {
    return Object.freeze({
      status,
      disposition: 'provider_refused',
      retryable: false,
      circuitFailure: false,
    })
  }
  return Object.freeze({
    status,
    disposition: 'provider_unavailable',
    retryable: false,
    circuitFailure: true,
  })
}

const OPENAI_QUOTA_ERROR = 'insufficient_quota'

const openAiErrorBodySchema = z.looseObject({
  error: z.looseObject({ type: z.string().nullish(), code: z.string().nullish() }),
})

/**
 * Whether a 429 body says the account is out of credit rather than over a rate.
 * OpenAI answers both with 429; only the body's `error.type` (and, in older
 * answers, `error.code`) tells them apart. Only those two fields are read, and
 * nothing of the body is kept or logged. An unreadable body is a rate limit.
 */
export function isOpenAiQuotaExhaustedBody(
  bytes: Uint8Array | null,
  maxBytes: number,
): boolean {
  if (bytes === null || bytes.byteLength === 0) return false
  try {
    const body = parseAiProviderJsonBytes(bytes, maxBytes, openAiErrorBodySchema)
    return (
      body.error.type === OPENAI_QUOTA_ERROR || body.error.code === OPENAI_QUOTA_ERROR
    )
  } catch {
    return false
  }
}

export type OpenAiRefusal = Readonly<{
  disposition: Extract<
    OpenAiProviderDisposition,
    'rate_limited' | 'quota_exhausted' | 'provider_unavailable' | 'provider_refused'
  >
  providerRetryable: boolean
  usageKnown: boolean
  retryAfterSeconds: number | null
}>

/**
 * A complete answer other than 200, as the connector's one-shot fetch recorded
 * it: the outcome fields the connector reports for it. A 429 or a 500, 502, 503 or 504 is a
 * refusal the provider does not bill, so its usage is known: none. Reported as
 * unknown, the gateway expected the reserved maximum while the admission
 * authority charged nothing, the receipt never bound, and every such answer
 * reached the caller as `operation_ambiguous` (closed beta, 2026-10-24). Every
 * other status (a refused request, an authentication or routing fault) keeps
 * unknown usage and so stays `operation_ambiguous`: such a fault is not the
 * review's, so it must stay reopenable and spend the attempt budget.
 */
export function classifyOpenAiRefusal(
  response: Readonly<{
    completeStatus: number | null
    decodedResponseBytes: Uint8Array | null
    retryAfterSeconds: number | null
  }>,
  maxBytes: number,
): OpenAiRefusal {
  const status = response.completeStatus
  if (status === null) throw new TypeError('An incomplete answer is no refusal')
  const classified = classifyOpenAiStatus(status)
  if (classified.disposition === 'success') throw new TypeError('A 200 is no refusal')
  if (
    status === 429 &&
    isOpenAiQuotaExhaustedBody(response.decodedResponseBytes, maxBytes)
  ) {
    return Object.freeze({
      disposition: 'quota_exhausted',
      providerRetryable: false,
      usageKnown: true,
      retryAfterSeconds: null,
    })
  }
  return Object.freeze({
    disposition: classified.disposition,
    providerRetryable: classified.retryable,
    usageKnown: classified.retryable,
    retryAfterSeconds: classified.retryable ? response.retryAfterSeconds : null,
  })
}

// Normalize-then-compare rather than one regex. The regex this replaced nested
// four `[ \t]*` runs inside an optional group, which `security/detect-unsafe-regex`
// rejects on backtracking grounds — a rule that did not apply while this file sat
// under `services/`. Stripping insignificant whitespace first makes the check a
// pair of string equalities, provably linear and accepting the same inputs.
const JSON_UTF8_FORMS: readonly string[] = [
  'application/json',
  'application/json;charset=utf-8',
]

export function parseOpenAiJsonContentType(value: string | null): boolean {
  if (value === null) return false
  return JSON_UTF8_FORMS.includes(value.replace(/[ \t]/gu, '').toLowerCase())
}

export function parseOpenAiRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const match = /^([1-9][0-9]{0,2})$/.exec(value)
  if (match === null) return null
  const seconds = Number(match[1])
  return seconds <= 300 ? seconds : null
}

const ZERO_USAGE = Object.freeze({
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
})

export function enforceOutboundFetchDisposition<T>(
  outcome: OpenAiConnectorOutcome<T>,
): OpenAiConnectorOutcome<T> {
  const claimsNoDispatch = outcome.disposition === 'no_dispatch'
  if (claimsNoDispatch === !outcome.outboundFetchUsed) return outcome
  const disposition = outcome.outboundFetchUsed ? 'transport_ambiguous' : 'no_dispatch'
  // This rewrite DISCARDS the connector's original disposition, so a real provider
  // or output failure that never touched the network is reported as a bare
  // `no_dispatch`. Record what was overwritten before it is lost.
  process.stderr.write(
    `${JSON.stringify({
      event: 'gateway_disposition_rewritten',
      from: outcome.disposition,
      to: disposition,
      outboundFetchUsed: outcome.outboundFetchUsed,
      usageKnown: outcome.usageKnown,
    })}\n`,
  )
  return Object.freeze({
    disposition,
    reportedDisposition: disposition,
    result: null,
    usageKnown: false,
    providerRetryable: false,
    usage: ZERO_USAGE,
    retryAfterSeconds: null,
    outboundFetchUsed: outcome.outboundFetchUsed,
  })
}
