import type {
  GoogleReviewApiError,
  GoogleReviewApiErrorCode,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewApiFailure } from '#/contexts/review/application/ports/google-review-api.port'
import {
  executorErrorToReviewApiError,
  isGoogleReviewApiError,
  isProviderCallFailure,
  REPLY_PRE_READ_REFUSAL_OPERATION,
  reviewApiError,
} from '#/contexts/review/application/public-api'
import { createGoogleCallError } from '../../domain/google-call-error'
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
 * The refusal of the read RepKey makes before it publishes a reply, as the one
 * Google call error the write path also throws. It was raised before any
 * provider call, so it says `not_sent` and keeps the authorizer's closed code
 * as evidence; the Review use case decides whether it is the reconnect case.
 * An authorizer that could not decide (`runtime_unavailable`: a database or
 * token outage) or that failed without any closed code (a connection pool or
 * socket error from the connection lookup, say) refused nothing: it is an
 * upstream failure, which a read can always retry. A process with no authorizer
 * says nothing about dispatch.
 */
export function replyPreReadRefusal(refusal: unknown): unknown {
  const operation = REPLY_PRE_READ_REFUSAL_OPERATION
  if (isGoogleReviewApiError(refusal)) {
    if (refusal.code === 'authorization_changed') {
      return createGoogleCallError(operation, 'permission_denied', {
        dispatch: 'not_sent',
      })
    }
    if (refusal.code === 'provider_unavailable') {
      return createGoogleCallError(operation, 'upstream_error', {})
    }
    return refusal
  }
  const executionCode = contentFreeCode(errorField(refusal, 'code'))
  const evidence = {
    dispatch: 'not_sent',
    ...(executionCode === null ? {} : { executionCode }),
  } as const
  return executionCode !== null && executionCode !== 'runtime_unavailable'
    ? createGoogleCallError(operation, 'permission_denied', evidence)
    : createGoogleCallError(operation, 'upstream_error', evidence)
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
