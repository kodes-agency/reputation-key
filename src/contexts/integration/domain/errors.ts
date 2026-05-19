// Integration context — domain errors
// Hybrid tagged union grafted onto Error via Object.defineProperties.
// Same pattern as GbpApiError — pino serializes Error instances properly (message + stack),
// and the _tag field enables isIntegrationError() type guards.

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

export type IntegrationError = Readonly<{
  _tag: 'IntegrationError'
  code: IntegrationErrorCode
  message: string
  recoverable: boolean
}>

export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
  recoverable = false,
): Error & IntegrationError => {
  const error = new Error(message)
  const tagged = error as Error & IntegrationError
  Object.defineProperties(tagged, {
    _tag: { value: 'IntegrationError', enumerable: true },
    code: { value: code, enumerable: true },
    message: { value: message, enumerable: true },
    recoverable: { value: recoverable, enumerable: true },
  })
  return tagged
}

export const isIntegrationError = (e: unknown): e is IntegrationError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  (e as { _tag: string })._tag === 'IntegrationError'
