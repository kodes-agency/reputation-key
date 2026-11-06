// The reachable GBP interface keeps its Error identity, tag and kind for existing
// consumers. GoogleCallError owns the provider vocabulary; kind mirrors its code.
// Dispatch evidence remains independent: a write's classification alone cannot
// prove that Google never received it.

import type { GoogleProviderErrorStatus } from '#/shared/domain/google-provider-failure'
import type { GoogleCallError, GoogleCallErrorCode } from './google-call-error'

export type GbpApiErrorKind = Exclude<GoogleCallErrorCode, 'unclassified'>

/** The provider adapter asserts this union matches the gateway at compile time. */
export type GbpApiDispatch = GoogleCallError['dispatch']

export type GbpApiError = Readonly<{
  _tag: 'GbpApiError'
  operation: string
  code: GbpApiErrorKind
  /** Compatibility alias of code for existing error consumers. */
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
        providerErrorStatus?: GoogleProviderErrorStatus | null
      }> = '',
): Error & GbpApiError => {
  const message = `GBP API ${operation} failed (${kind})`
  // TS can't see defineProperties add the tagged props, so the intersection is asserted once here.
  const err = new Error(message) as Error & GbpApiError
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
    Error.captureStackTrace(err, createGbpApiError)
  }
  return err
}

/** Type guard for the tagged GBP API error (anything else is unclassifiable). */
export const isGbpApiError = (err: unknown): err is GbpApiError => {
  if (typeof err !== 'object' || err === null || !('_tag' in err)) return false
  return err._tag === 'GbpApiError'
}
