// Integration context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

import { createTaggedError } from '#/shared/domain/errors'

export type IntegrationErrorCode =
  | 'forbidden'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'connection_disconnected'
  | 'account_already_connected'
  | 'oauth_failed'
  | 'oauth_denied'
  // BQC-7.6: PKCE/state redeem failure — the callback maps this to the same
  // fail-closed 'invalid_state' redirect as a bad state signature.
  | 'oauth_state_invalid'
  | 'token_refresh_failed'
  | 'gbp_api_error'
  | 'gbp_api_rate_limited'
  | 'import_not_found'
  | 'invalid_visibility'
  | 'encryption_error'
  | 'invalid_cache_entry'
  | 'invalid_event'
  | 'invalid_transition'
  | 'region_unresolved'
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
): Error & IntegrationError =>
  createTaggedError(
    'IntegrationError',
    code,
    message,
    context,
    { recoverable },
    integrationError,
  )

export const isIntegrationError = (e: unknown): e is IntegrationError => {
  if (typeof e !== 'object' || e === null || !('_tag' in e)) return false
  // After '_tag' in e, e._tag is unknown; the type predicate narrows for callers.
  return e._tag === 'IntegrationError'
}
