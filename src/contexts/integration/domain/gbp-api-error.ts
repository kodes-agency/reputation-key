// Integration context — GBP API error type
// Per ADR 0005: hybrid Error + tagged record (no class — keeps the tagged-union
// convention). The factory returns a real Error so `instanceof Error` holds, stack
// traces are captured, and logs serialize correctly. The adapter classifies the HTTP
// status into `kind` at the boundary, and `kind` stays the only classification
// callers branch on for retry and UI decisions.
//
// `providerStatus` is carried alongside it as dispatch evidence, not as a second
// taxonomy: a reply write that failed must say whether Google answered, never
// received, or may have received the request, because only the first two can
// decide whether sending it again could post twice (CONTRACT-REPLY D2).

export type GbpApiErrorKind =
  'auth_failed' | 'rate_limited' | 'permission_denied' | 'upstream_error' | 'parse_error'

/**
 * Mirrors `GoogleProviderDispatch` (shared/google-provider-control/egress-gateway).
 * Declared here because the domain layer may import only `shared/domain`; the
 * provider adapter asserts both unions stay identical at compile time.
 */
export type GbpApiDispatch = 'not_sent' | 'answered' | 'unknown'

export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  /** Domain classification set at the adapter boundary from the raw HTTP status. */
  kind: GbpApiErrorKind
  /** Content-free diagnostics. Provider response bytes are never retained. */
  providerBodyBytes: number
  retryAfterMs: number | null
  /** Content-free reason when our execution admission refused before provider I/O. */
  executionAdmissionCode: string | null
  /**
   * Whether the request could have reached Google. Defaults to `unknown`: only
   * an adapter that observed the call may claim `not_sent` or `answered`.
   */
  dispatch: GbpApiDispatch
  /** The executor's content-free failure code, when the executor refused or failed. */
  executionCode?: string
  /** The provider's HTTP status, when Google answered. */
  providerStatus?: number
  message: string
}>

const defineEnumerable = <T>(value: T): PropertyDescriptor => ({
  value,
  enumerable: true,
  writable: false,
  configurable: false,
})

const textEncoder = new TextEncoder()

export const createGbpApiError = (
  operation: string,
  kind: GbpApiErrorKind,
  details:
    | string
    | Readonly<{
        providerBodyBytes?: number
        retryAfterMs?: number
        executionAdmissionCode?: string
        dispatch?: GbpApiDispatch
        executionCode?: string
        providerStatus?: number
      }> = '',
): Error & GbpApiError => {
  const message = `GBP API ${operation} failed (${kind})`
  // TS can't see defineProperties add the tagged props, so the intersection is asserted once here.
  const err = new Error(message) as Error & GbpApiError
  Object.defineProperties(err, {
    name: defineEnumerable('GbpApiError'),
    _tag: defineEnumerable('GbpApiError'),
    operation: defineEnumerable(operation),
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
  if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(err, createGbpApiError)
  }
  return err
}

/** Type guard for the tagged GBP API error (anything else is unclassifiable). */
export const isGbpApiError = (err: unknown): err is GbpApiError => {
  if (typeof err !== 'object' || err === null || !('_tag' in err)) return false
  return err._tag === 'GbpApiError'
}
