// Integration context — domain errors

export type IntegrationErrorCode =
  | 'forbidden'
  | 'connection_not_found'
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
}>

export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
): IntegrationError => ({
  _tag: 'IntegrationError',
  code,
  message,
})

export const isIntegrationError = (e: unknown): e is IntegrationError =>
  typeof e === 'object' &&
  e !== null &&
  '_tag' in e &&
  (e as { _tag: string })._tag === 'IntegrationError'
