// Integration context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

export type IntegrationErrorCode =
  | 'forbidden'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'connection_disconnected'
  | 'account_already_connected'
  | 'oauth_failed'
  | 'oauth_denied'
  | 'token_refresh_failed'
  | 'gbp_api_error'
  | 'gbp_api_rate_limited'
  | 'import_not_found'
  | 'invalid_visibility'
  | 'encryption_error'
  | 'invalid_cache_entry'
  | 'invalid_event'
export type IntegrationError = Readonly<{
  _tag: 'IntegrationError'
  code: IntegrationErrorCode
  message: string
  recoverable: boolean
  context?: Readonly<Record<string, unknown>>
}>

// ADR 0005: integrationError returns a real Error (with captured stack) carrying
// the tagged IntegrationError shape via Object.defineProperties. This preserves the
// tagged-union convention (no class) while making `instanceof Error` hold and fixing
// the `[object Object]` serialization in logs. _tag/code/recoverable/context are the
// domain identity; message/stack/name come from Error. Props are enumerable so log
// serializers and Object.keys see them.
const defineEnumerable = <T>(value: T): PropertyDescriptor => ({
  value,
  enumerable: true,
  writable: false,
  configurable: false,
})

export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
  recoverable = false,
  context?: Readonly<Record<string, unknown>>,
): Error & IntegrationError => {
  // Augment a real Error with the tagged shape via defineProperties (below).
  // TS can't see defineProperties add props, so the intersection is asserted once here.
  const err = new Error(message) as Error & IntegrationError
  Object.defineProperties(err, {
    name: defineEnumerable('IntegrationError'),
    _tag: defineEnumerable('IntegrationError'),
    code: defineEnumerable(code),
    recoverable: defineEnumerable(recoverable),
    ...(context ? { context: defineEnumerable(context) } : {}),
  })
  // Capture a stack trace that hides this constructor frame (Error.stackTraceLimit).
  if ('captureStackTrace' in Error && typeof Error.captureStackTrace === 'function') {
    Error.captureStackTrace(err, integrationError)
  }
  return err
}

export const isIntegrationError = (e: unknown): e is IntegrationError => {
  if (typeof e !== 'object' || e === null || !('_tag' in e)) return false
  // After '_tag' in e, e._tag is unknown; the type predicate narrows for callers.
  return e._tag === 'IntegrationError'
}
