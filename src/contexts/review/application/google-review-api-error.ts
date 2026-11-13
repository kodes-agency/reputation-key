import { googleProviderFailure } from '#/shared/domain/google-provider-failure'
import { googleRetryFloorMs } from '#/shared/google-provider-control/retry-floor'
import type {
  GoogleReviewApiError,
  GoogleReviewApiErrorCode,
  GoogleReviewApiFailure,
  GoogleReviewApiPort,
} from './ports/google-review-api.port'

// How a provider answer or a gateway refusal becomes the typed
// `GoogleReviewApiError` the Review use cases branch on. The integration
// adapter throws the provider's own failure; the use cases that call the port
// translate it here, so retry and terminal decisions are made in Review.

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

function errorField(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined
}

const PROVIDER_CALL_CODES = [
  'auth_failed',
  'rate_limited',
  'permission_denied',
  'upstream_error',
  'parse_error',
] as const
type ProviderCallCode = (typeof PROVIDER_CALL_CODES)[number] | 'unclassified'

const CONTENT_FREE_CODE = /^[a-z][a-z0-9_]{0,63}$/u

function contentFreeCode(value: unknown): string | null {
  return typeof value === 'string' && CONTENT_FREE_CODE.test(value) ? value : null
}

type ProviderCallFacts = ReturnType<typeof googleProviderFailure> &
  Readonly<{
    code: ProviderCallCode
    executionCode: string | null
    retryAfterMs: number | null
  }>

/** Read the closed provider facts off a rejection; messages and bodies are never read. */
function providerCallFacts(error: unknown): ProviderCallFacts {
  const closed = (value: unknown): ProviderCallCode | null =>
    PROVIDER_CALL_CODES.find((code) => code === value) ??
    (value === 'unclassified' ? 'unclassified' : null)
  const retryAfterMs = errorField(error, 'retryAfterMs')
  return {
    ...googleProviderFailure(error),
    code:
      closed(errorField(error, 'code')) ??
      closed(errorField(error, 'kind')) ??
      'unclassified',
    executionCode:
      contentFreeCode(errorField(error, 'executionAdmissionCode')) ??
      contentFreeCode(errorField(error, 'executionCode')),
    retryAfterMs:
      typeof retryAfterMs === 'number' &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs >= 0
        ? retryAfterMs
        : null,
  }
}

/**
 * Preserve the normalized provider facts at the consumer-owned Review port.
 * Only explicit `not_sent` evidence may make a failed write safe to retry.
 */
function executorFailure(
  error: unknown,
  call: ProviderCallFacts,
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
  const call = providerCallFacts(error)
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
 * The `operation` the integration adapter names on the refusal of the read made
 * before a reply is published, when its authorization or connection check
 * refuses it. Only that refusal can be the reconnect case; a provider answer
 * keeps its own code.
 */
export const REPLY_PRE_READ_REFUSAL_OPERATION = 'reviews.get.reply_publication'

/** A provider failure the pre-publish read raised before it called Google. */
export function isReplyPreReadRefusal(error: unknown): boolean {
  return (
    isProviderCallFailure(error) &&
    errorField(error, 'operation') === REPLY_PRE_READ_REFUSAL_OPERATION
  )
}

export function isGoogleReviewApiError(error: unknown): error is GoogleReviewApiError {
  return errorField(error, '_tag') === 'GoogleReviewApiError'
}

/** The failure of a call Google itself answered or refused, as the integration adapter throws it. */
export function isProviderCallFailure(error: unknown): boolean {
  return errorField(error, '_tag') === 'GbpApiError'
}

type TranslatedReads = 'listReviewsPage' | 'readReviewsHead' | 'getReview'

const translatedPorts = new WeakMap<object, unknown>()

/**
 * The Google review port with provider failures translated into
 * `GoogleReviewApiError`, so a use case sees one vocabulary whichever adapter
 * stands behind the port. Every other rejection (a product error, an unusable
 * connection, a refused authorizer) keeps its own code.
 */
export function translatedGoogleReviewApi<
  P extends Partial<Pick<GoogleReviewApiPort, TranslatedReads>>,
>(port: P): P {
  const known = translatedPorts.get(port)
  if (known !== undefined) return known as P
  const wrap =
    <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(...args)
      } catch (error) {
        throw isProviderCallFailure(error) ? executorErrorToReviewApiError(error) : error
      }
    }
  const translated = Object.freeze({
    ...port,
    ...(port.listReviewsPage && {
      listReviewsPage: wrap(port.listReviewsPage.bind(port)),
    }),
    ...(port.readReviewsHead && {
      readReviewsHead: wrap(port.readReviewsHead.bind(port)),
    }),
    ...(port.getReview && { getReview: wrap(port.getReview.bind(port)) }),
  }) as P
  translatedPorts.set(port, translated)
  return translated
}
