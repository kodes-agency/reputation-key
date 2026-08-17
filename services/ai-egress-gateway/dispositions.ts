import type { AiSettlementRequestV1 } from '../../src/shared/ai-internal-transport-contract'
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

const JSON_UTF8 = /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*utf-8)?$/i

export function parseOpenAiJsonContentType(value: string | null): boolean {
  return value !== null && JSON_UTF8.test(value)
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
