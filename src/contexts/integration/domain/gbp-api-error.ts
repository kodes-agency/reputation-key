// Integration context — GBP API error type
// Per ADR 0005: hybrid Error + tagged record (no class — keeps the tagged-union
// convention). The factory returns a real Error so `instanceof Error` holds, stack
// traces are captured, and logs serialize correctly. The HTTP status is NOT carried
// in the domain (cc-errors §13 BLOCKER) — the adapter classifies it into `kind` at
// the boundary so the domain sees only a domain-level classification.

export type GbpApiErrorKind =
  'auth_failed' | 'rate_limited' | 'permission_denied' | 'upstream_error' | 'parse_error'

export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  /** Domain classification set at the adapter boundary from the raw HTTP status. */
  kind: GbpApiErrorKind
  /** Content-free diagnostics. Provider response bytes are never retained. */
  providerBodyBytes: number
  retryAfterMs: number | null
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
  details: string | Readonly<{ providerBodyBytes?: number; retryAfterMs?: number }> = '',
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
  })
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
