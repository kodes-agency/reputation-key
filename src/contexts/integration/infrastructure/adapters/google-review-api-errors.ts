import type {
  GoogleReviewApiError,
  GoogleReviewApiErrorCode,
} from '#/contexts/review/application/public-api'
import type { GoogleReviewApiFailure } from '#/contexts/review/application/ports/google-review-api.port'
import { googleRetryFloorMs } from '#/shared/google-provider-control/provider-call'
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
 * Reads the GbpApiError dispatch fields `executeGoogleProviderRaw` records. A
 * missing or unrecognised dispatch is `unknown`: only the provider plane's
 * explicit `not_sent` may later make a failure safe to retry.
 */
function executorFailure(
  error: unknown,
): Readonly<{ label: string; failure: GoogleReviewApiFailure }> {
  const executionCode =
    contentFreeCode(errorField(error, 'executionAdmissionCode')) ??
    contentFreeCode(errorField(error, 'executionCode'))
  const dispatch = errorField(error, 'dispatch')
  const status = errorField(error, 'providerStatus')
  return {
    label: executionCode ?? contentFreeCode(errorField(error, 'kind')) ?? 'unclassified',
    failure: {
      executionCode,
      dispatch: dispatch === 'not_sent' || dispatch === 'answered' ? dispatch : 'unknown',
      providerStatus:
        typeof status === 'number' && Number.isSafeInteger(status) ? status : null,
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

/**
 * Maps an authorized-executor rejection onto the review API's error vocabulary,
 * preserving the backoff hint the executor already computed
 * (`googleRetryFloorMs` over Retry-After or the admission denial). Dropping it
 * turned a rate-limited provider into a queue-speed retry loop.
 *
 * The code mapping stays coarse, but the dispatch evidence rides along: the
 * incident reply's compile refusal (no permit, no fetch) arrived here as
 * `parse_error`, left as a bare `provider_unavailable`, and was classified
 * ambiguous (reply-publication-workflow.ts classifyPublicationFailure).
 */
export function executorErrorToReviewApiError(error: unknown): GoogleReviewApiError {
  const kind = errorField(error, 'kind')
  const { label, failure } = executorFailure(error)
  // A refusal is an ANSWER, not an outage. Collapsing 401/403 into
  // `provider_unavailable` told the reply publication workflow the outcome was
  // unknown, so a permanently refused write burned every retry and never
  // reached publish_failed.
  if (kind === 'auth_failed' || kind === 'permission_denied') {
    return reviewApiError('authorization_changed', false, {
      failure,
      failureLabel: label,
    })
  }
  // Google ANSWERED that the Location or the request is not valid. Asking again
  // gets the same answer, so a retryable code only kept a run looping until its
  // 12 h expiry; the run ends and the next poll starts afresh.
  if (isPermanentProviderAnswer(kind, failure)) {
    return reviewApiError('provider_rejected', false, {
      failure,
      failureLabel: label,
    })
  }
  // A rate limit AND an upstream failure (a 5xx, a gateway that could not
  // decide) carry a real wait. Dropping the second re-ran the same step at queue
  // speed for as long as the run lasted. Other kinds (an unreadable body) carry
  // the floor `reviewApiError` gives every retried code.
  const hint = errorField(error, 'retryAfterMs')
  const rateLimited = kind === 'rate_limited'
  return reviewApiError(
    rateLimited ? 'provider_rate_limited' : 'provider_unavailable',
    true,
    {
      ...(typeof hint === 'number' && (rateLimited || kind === 'upstream_error')
        ? { retryAfterMs: hint }
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
