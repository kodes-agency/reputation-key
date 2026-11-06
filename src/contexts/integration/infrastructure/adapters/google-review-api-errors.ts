import type {
  GoogleReviewApiError,
  GoogleReviewApiErrorCode,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewApiFailure } from '#/contexts/review/application/ports/google-review-api.port'
import { googleRetryFloorMs } from '#/shared/google-provider-control/provider-call'
import { googleCallError, type GoogleCallError } from '../../domain/google-call-error'
import type { GoogleReviewCursorFailureCode } from '../google-review-cursor-store'

// The review API adapter's error vocabulary: how a provider answer, a gateway
// refusal, a cursor-store fault or an authorizer refusal becomes the typed
// `GoogleReviewApiError` the review context branches on. Kept apart from the
// adapter so that the mapping reads (and is tested) in one place.

function defineEnumerable<T>(value: T): PropertyDescriptor {
  return {
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  }
}

type ReviewApiErrorDetails = Readonly<{
  retryAfterMs?: number
  /** Dispatch evidence; when present the message names it (content-free). */
  failure?: GoogleReviewApiFailure
  /** The code or kind the message leads with; defaults to the review code. */
  failureLabel?: string
  /** `cursor_not_found` only: when the cursor store started. */
  cursorStoreStartedAtMs?: number
}>

/** Reaches BullMQ's failedReason, so codes, dispatch and status only. */
function failureMessage(label: string, failure: GoogleReviewApiFailure): string {
  const status =
    failure.providerStatus === null ? '' : `; status ${failure.providerStatus}`
  return `Google review API request failed (${label}; ${failure.dispatch}${status})`
}

/** The two codes the snapshot use case retries, by code alone. */
function isRetriedCode(code: GoogleReviewApiErrorCode, recoverable: boolean): boolean {
  return (
    recoverable && (code === 'provider_unavailable' || code === 'provider_rate_limited')
  )
}

/**
 * `retryAfterMs` carries the provider's own backoff hint to the scheduler.
 *
 * Dropping it was a live amplification bug: a `quota_exhausted` admission
 * denial surfaces as `provider_rate_limited`, the snapshot use case checkpoints
 * WITHOUT advancing its cursor, and the sync job re-enqueued the continuation
 * with no delay - so a provider asking for a ~1s pause got hammered at queue
 * speed instead (observed: 3,225 denials over 344s, ~9/s, which starved every
 * other Google route sharing the quota, reply publishing included).
 *
 * The use case retries a recoverable `provider_unavailable` or
 * `provider_rate_limited` by its code alone, so every such error carries a
 * wait: the hint when there is one, otherwise the provider plane's floor. A
 * throw site that forgot the hint (a cursor store fault, a body that was not
 * JSON) re-ran at queue speed the same way.
 */
export function reviewApiError(
  code: GoogleReviewApiErrorCode,
  recoverable: boolean,
  details: ReviewApiErrorDetails = {},
): GoogleReviewApiError {
  const { failure } = details
  const retryAfterMs =
    details.retryAfterMs ??
    (isRetriedCode(code, recoverable) ? googleRetryFloorMs(null) : undefined)
  const error = new Error(
    failure === undefined
      ? 'Google review API request failed'
      : failureMessage(details.failureLabel ?? code, failure),
  ) as GoogleReviewApiError
  Object.defineProperties(error, {
    name: defineEnumerable('GoogleReviewApiError'),
    _tag: defineEnumerable('GoogleReviewApiError'),
    code: defineEnumerable(code),
    recoverable: defineEnumerable(recoverable),
    ...(retryAfterMs === undefined
      ? {}
      : { retryAfterMs: defineEnumerable(retryAfterMs) }),
    ...(failure === undefined
      ? {}
      : { failure: defineEnumerable(Object.freeze({ ...failure })) }),
    ...(details.cursorStoreStartedAtMs === undefined
      ? {}
      : { cursorStoreStartedAtMs: defineEnumerable(details.cursorStoreStartedAtMs) }),
  })
  return error
}

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
 * Preserve the normalized provider facts at the consumer-owned Review port.
 * Only explicit `not_sent` evidence may make a failed write safe to retry.
 */
function executorFailure(
  error: unknown,
  call: GoogleCallError,
): Readonly<{ label: string; failure: GoogleReviewApiFailure }> {
  return {
    label: call.executionCode ?? call.code,
    failure: {
      executionCode: call.executionCode,
      dispatch: call.dispatch,
      providerStatus: call.providerStatus,
      ...(errorField(error, 'providerErrorStatus') === undefined
        ? {}
        : { providerErrorStatus: call.providerErrorStatus }),
    },
  }
}

// Google's own statuses for "no such Location" and "this request is invalid".
// Only an answered status counts: a gateway failure that carries one (a body cut
// short after the headers) still names an execution code and stays retryable.
const PERMANENT_ANSWER_STATUSES: ReadonlySet<number> = new Set([400, 404])

function isPermanentProviderAnswer(
  kind: unknown,
  failure: GoogleReviewApiFailure,
): boolean {
  return (
    kind === 'upstream_error' &&
    failure.executionCode === null &&
    failure.dispatch === 'answered' &&
    failure.providerStatus !== null &&
    PERMANENT_ANSWER_STATUSES.has(failure.providerStatus)
  )
}

/** Map provider facts into the Review port without losing backoff or write evidence. */
export function executorErrorToReviewApiError(error: unknown): GoogleReviewApiError {
  const call = googleCallError(error)
  const { code, retryAfterMs } = call
  const { label, failure } = executorFailure(error, call)
  // An authorization refusal is terminal even when no request was dispatched.
  if (code === 'auth_failed' || code === 'permission_denied') {
    return reviewApiError('authorization_changed', false, {
      failure,
      failureLabel: label,
    })
  }
  // Repeating an answered invalid request or missing Location cannot repair it.
  if (isPermanentProviderAnswer(code, failure)) {
    return reviewApiError('provider_rejected', false, {
      failure,
      failureLabel: label,
    })
  }
  // A rate limit or upstream failure keeps its hint. Other retryable failures
  // receive the floor from reviewApiError so they cannot retry at queue speed.
  const rateLimited = code === 'rate_limited'
  return reviewApiError(
    rateLimited ? 'provider_rate_limited' : 'provider_unavailable',
    true,
    {
      ...(retryAfterMs !== null && (rateLimited || code === 'upstream_error')
        ? { retryAfterMs }
        : {}),
      failure,
      failureLabel: label,
    },
  )
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

export function isGoogleReviewApiError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    error._tag === 'GoogleReviewApiError'
  )
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
