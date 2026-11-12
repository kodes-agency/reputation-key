import {
  googleProviderFailure,
  type GoogleProviderErrorStatus,
  type GoogleProviderFailure,
} from '#/shared/domain/google-provider-failure'

const GOOGLE_CALL_ERROR_CODES = [
  'auth_failed',
  'rate_limited',
  'permission_denied',
  'upstream_error',
  'parse_error',
  'unclassified',
] as const

export type GoogleCallErrorCode = (typeof GOOGLE_CALL_ERROR_CODES)[number]

/** Provider facts only; product retry and presentation decisions belong to callers. */
export type GoogleCallError = GoogleProviderFailure &
  Readonly<{
    code: GoogleCallErrorCode
    executionCode: string | null
    retryAfterMs: number | null
  }>

export function googleCallErrorCodeForStatus(
  status: number,
): Exclude<GoogleCallErrorCode, 'unclassified'> {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  return 'upstream_error'
}

export function googleCallErrorCodeForExecution(
  failure: Readonly<{ code: string; admissionCode?: string }>,
): Exclude<GoogleCallErrorCode, 'unclassified'> {
  if (failure.code === 'admission_denied') {
    switch (failure.admissionCode) {
      case 'quota_exhausted':
      case 'in_flight_exhausted':
        return 'rate_limited'
      case 'authorization_changed':
      case 'authorization_denied':
        return 'permission_denied'
      default:
        return 'upstream_error'
    }
  }
  if (failure.code === 'response_too_large' || failure.code === 'malformed_request') {
    return 'parse_error'
  }
  return 'upstream_error'
}

function field(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null && key in error
    ? (error as Record<string, unknown>)[key]
    : undefined
}

function callCode(value: unknown): GoogleCallErrorCode | null {
  return GOOGLE_CALL_ERROR_CODES.find((code) => code === value) ?? null
}

function executionCode(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : null
}

/**
 * Normalize both the provider record and the reachable GBP error interface.
 * Missing evidence stays unknown; neither an error message nor provider bytes
 * may become diagnostics or proof that a write was never sent.
 */
export function googleCallError(error: unknown): GoogleCallError {
  const retryAfterMs = field(error, 'retryAfterMs')
  return Object.freeze({
    ...googleProviderFailure(error),
    code:
      callCode(field(error, 'code')) ?? callCode(field(error, 'kind')) ?? 'unclassified',
    executionCode:
      executionCode(field(error, 'executionAdmissionCode')) ??
      executionCode(field(error, 'executionCode')),
    retryAfterMs:
      typeof retryAfterMs === 'number' &&
      Number.isFinite(retryAfterMs) &&
      retryAfterMs >= 0
        ? retryAfterMs
        : null,
  })
}

// The thrown form keeps its Error identity, `_tag` and message ('GbpApiError',
// `GBP API <operation> failed (<kind>)`) for existing consumers: logs, queue
// failure reasons and the Review publication classifier read them. Dispatch
// evidence stays independent of the code: a write's classification alone cannot
// prove that Google never received it.

export type GoogleCallErrorKind = Exclude<GoogleCallErrorCode, 'unclassified'>

/** The provider adapter asserts this union matches the gateway at compile time. */
export type GoogleCallDispatch = GoogleCallError['dispatch']

export type GoogleCallFailure = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  code: GoogleCallErrorKind
  /** Compatibility alias of code for existing error consumers. */
  kind: GoogleCallErrorKind
  /** Content-free diagnostics. Provider response bytes are never retained. */
  providerBodyBytes: number
  retryAfterMs: number | null
  /** Content-free reason when our execution admission refused before provider I/O. */
  executionAdmissionCode: string | null
  /**
   * Whether the request could have reached Google. Defaults to `unknown`: only
   * an adapter that observed the call may claim `not_sent` or `answered`.
   */
  dispatch: GoogleCallDispatch
  /** The executor's content-free failure code, when the executor refused or failed. */
  executionCode?: string
  /** The provider's HTTP status, when Google answered. */
  providerStatus?: number
  providerErrorStatus?: GoogleProviderErrorStatus | null
  message: string
}>

const defineEnumerable = <T>(value: T): PropertyDescriptor => ({
  value,
  enumerable: true,
  writable: false,
  configurable: false,
})

const textEncoder = new TextEncoder()

export const createGoogleCallError = (
  operation: string,
  kind: GoogleCallErrorKind,
  details:
    | string
    | Readonly<{
        providerBodyBytes?: number
        retryAfterMs?: number
        executionAdmissionCode?: string
        dispatch?: GoogleCallDispatch
        executionCode?: string
        providerStatus?: number
        providerErrorStatus?: GoogleProviderErrorStatus | null
      }> = '',
): Error & GoogleCallFailure => {
  const message = `GBP API ${operation} failed (${kind})`
  // TS can't see defineProperties add the tagged props, so the intersection is asserted once here.
  const err = new Error(message) as Error & GoogleCallFailure
  Object.defineProperties(err, {
    name: defineEnumerable('GbpApiError'),
    _tag: defineEnumerable('GbpApiError'),
    operation: defineEnumerable(operation),
    code: defineEnumerable(kind),
    kind: defineEnumerable(kind),
    providerBodyBytes: defineEnumerable(
      typeof details === 'string'
        ? textEncoder.encode(details).byteLength
        : (details.providerBodyBytes ?? 0),
    ),
    retryAfterMs: defineEnumerable(
      typeof details === 'string' ? null : (details.retryAfterMs ?? null),
    ),
    executionAdmissionCode: defineEnumerable(
      typeof details === 'string' ? null : (details.executionAdmissionCode ?? null),
    ),
    dispatch: defineEnumerable(
      typeof details === 'string' ? 'unknown' : (details.dispatch ?? 'unknown'),
    ),
  })
  // Absent rather than `undefined` when unknown, so the error's own keys (and
  // anything that serializes them) only ever name evidence that exists.
  if (typeof details !== 'string' && details.executionCode !== undefined) {
    Object.defineProperty(err, 'executionCode', defineEnumerable(details.executionCode))
  }
  if (typeof details !== 'string' && details.providerStatus !== undefined) {
    Object.defineProperty(err, 'providerStatus', defineEnumerable(details.providerStatus))
  }
  if (typeof details !== 'string' && details.providerErrorStatus !== undefined) {
    Object.defineProperty(
      err,
      'providerErrorStatus',
      defineEnumerable(details.providerErrorStatus),
    )
  }
  if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(err, createGoogleCallError)
  }
  return err
}

/** Type guard for the tagged Google call error (anything else is unclassifiable). */
export const isGoogleCallError = (err: unknown): err is GoogleCallFailure => {
  if (typeof err !== 'object' || err === null || !('_tag' in err)) return false
  return err._tag === 'GbpApiError'
}
