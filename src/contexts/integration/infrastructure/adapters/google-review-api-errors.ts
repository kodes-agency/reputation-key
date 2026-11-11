import type {
  GoogleReviewApiError,
  GoogleReviewApiErrorCode,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewApiFailure } from '#/contexts/review/application/ports/google-review-api.port'
import {
  executorErrorToReviewApiError,
  isGoogleReviewApiError,
  isProviderCallFailure,
  reviewApiError,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewCursorFailureCode } from '../google-review-cursor-store'

// The review API adapter's own faults: a cursor-store fault, an authorizer
// refusal or a request it refuses before any provider call becomes the typed
// `GoogleReviewApiError`. Provider failures are translated by the Review use
// cases (`google-review-api-error.ts`).

const NOT_SENT: GoogleReviewApiFailure = Object.freeze({
  executionCode: null,
  dispatch: 'not_sent',
  providerStatus: null,
})

/** Every `invalid_request` is thrown before the executor is called. */
export function invalidRequest(): GoogleReviewApiError {
  return reviewApiError('invalid_request', false, { failure: NOT_SENT })
}

// The codes below are read from an `unknown` rejection, so they are only
// trusted as log/message material when they look like a closed-union code.
const CONTENT_FREE_CODE = /^[a-z][a-z0-9_]{0,63}$/u

function errorField(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined
}

function contentFreeCode(value: unknown): string | null {
  return typeof value === 'string' && CONTENT_FREE_CODE.test(value) ? value : null
}

/**
 * The reply authorizer refused, or could not decide, before any credential or
 * provider access, so nothing was sent. The refusal stays terminal, but its
 * closed code rides along as not-sent evidence: `stale_source` (the Property
 * is no longer active at the cycle's source epoch) is RepKey's own policy,
 * which the publish job cancels instead of reporting it as Google's answer.
 */
export function replyAuthorizationRefusal(refusal: unknown): GoogleReviewApiError {
  const executionCode = contentFreeCode(errorField(refusal, 'code'))
  return reviewApiError('authorization_changed', false, {
    failure: { ...NOT_SENT, executionCode },
    ...(executionCode === null ? {} : { failureLabel: executionCode }),
  })
}

/**
 * The review-sync authorizer refused the read RepKey makes before it publishes
 * a reply. Like the write's refusal, it sent nothing and keeps its closed code
 * as not-sent evidence; unlike the write's, an authorizer that could not decide
 * (`runtime_unavailable`: a database or token outage) or that failed without
 * any closed code is transient, so it is the retryable `provider_unavailable`,
 * not a terminal refusal. A read proves
 * nothing about what Google holds, so retrying it is always safe.
 */
export function replyPreReadAuthorizationRefusal(refusal: unknown): GoogleReviewApiError {
  const executionCode = contentFreeCode(errorField(refusal, 'code'))
  // A failure with no closed code (a connection pool or socket error from the
  // connection lookup, say) is not a refusal at all: it decided nothing.
  if (executionCode !== null && executionCode !== 'runtime_unavailable') {
    return replyAuthorizationRefusal(refusal)
  }
  return reviewApiError('provider_unavailable', true, {
    failure: { ...NOT_SENT, executionCode },
    failureLabel: executionCode ?? 'unclassified',
  })
}

/**
 * `executeGoogleProviderRaw` refuses a 200 whose content type is not JSON, but
 * for a write that refusal is about the body, not the outcome: Google answered
 * 200, so the reply was accepted. That branch is the only `parse_error` with an
 * answered 200 and no executor code (an executor failure always names its
 * code, e.g. `response_too_large`), so nothing else is read as acceptance.
 */
export function isAcceptedNonJsonWrite(error: unknown): boolean {
  return (
    errorField(error, '_tag') === 'GbpApiError' &&
    errorField(error, 'kind') === 'parse_error' &&
    errorField(error, 'dispatch') === 'answered' &&
    errorField(error, 'providerStatus') === 200 &&
    errorField(error, 'executionCode') === undefined
  )
}

/**
 * What an adapter read throws for a rejection: a provider failure travels as it
 * is for the Review use case to translate, and any other fault the adapter
 * cannot name itself is the retryable provider-unavailable error.
 */
export function readFailure(error: unknown): unknown {
  return isGoogleReviewApiError(error) || isProviderCallFailure(error)
    ? error
    : executorErrorToReviewApiError(error)
}

export function cursorFailureCode(
  code: GoogleReviewCursorFailureCode,
): GoogleReviewApiErrorCode {
  const mapping: Readonly<
    Record<GoogleReviewCursorFailureCode, GoogleReviewApiErrorCode>
  > = {
    not_found: 'cursor_not_found',
    expired: 'cursor_expired',
    binding_mismatch: 'cursor_binding_mismatch',
    exhausted: 'cursor_exhausted',
    capacity_exceeded: 'cursor_capacity_exceeded',
    conflict: 'provider_unavailable',
    unavailable: 'provider_unavailable',
  }
  return mapping[code]
}
