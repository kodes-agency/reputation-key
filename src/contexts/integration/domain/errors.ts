// Integration context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

export type IntegrationErrorCode =
  | 'forbidden'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'connection_disconnected'
  | 'oauth_failed'
  | 'oauth_denied'
  | 'token_refresh_failed'
  | 'gbp_api_error'
  | 'gbp_api_rate_limited'
  | 'import_not_found'
  | 'invalid_visibility'
  | 'encryption_error'
  | 'invalid_cache_entry'

export type IntegrationError = Readonly<{
  _tag: 'IntegrationError'
  code: IntegrationErrorCode
  message: string
  recoverable: boolean
  context?: Readonly<Record<string, unknown>>
}>

export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
  recoverable = false,
  context?: Readonly<Record<string, unknown>>,
): IntegrationError => ({
  _tag: 'IntegrationError',
  code,
  message,
  recoverable,
  ...(context ? { context } : {}),
})

export const isIntegrationError = (e: unknown): e is IntegrationError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  (e as { _tag: string })._tag === 'IntegrationError'
