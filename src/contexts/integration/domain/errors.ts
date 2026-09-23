// Integration context — domain errors
// Per architecture: tagged error shape with _tag, code, message.
// Error codes form a closed union so ts-pattern .exhaustive() works at the server boundary.

import { createTaggedError } from '#/shared/domain/errors'
import type { GoogleConnectionStatus } from './types'

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
  // Google refuses the connection's refresh credential for good (revoked or
  // expired grant); only a fresh consent from an AccountAdmin recovers it.
  | 'reauthorization_required'
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

export const reauthorizationRequiredError = (): Error & IntegrationError =>
  integrationError(
    'reauthorization_required',
    'Google connection requires reauthorization',
  )

/**
 * The refusal for a connection whose credential may not be used. One that is
 * waiting for a fresh consent says so; every other state reads as disconnected.
 */
export const unusableConnectionError = (
  status: GoogleConnectionStatus,
  message: string,
): Error & IntegrationError =>
  status === 'reauth_required'
    ? reauthorizationRequiredError()
    : integrationError('connection_disconnected', message)

export const isIntegrationError = (e: unknown): e is IntegrationError => {
  if (typeof e !== 'object' || e === null || !('_tag' in e)) return false
  // After '_tag' in e, e._tag is unknown; the type predicate narrows for callers.
  return e._tag === 'IntegrationError'
}
