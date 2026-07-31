// Integration context — shared server helpers
// Error-to-HTTP-status mapping shared across server function modules.

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import type { IntegrationErrorCode } from '../domain/errors'
import { isIntegrationError } from '../domain/errors'

export const integrationErrorStatus = (code: IntegrationErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('connection_not_found', 'import_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with(
      'oauth_failed',
      'oauth_denied',
      'oauth_state_invalid',
      'token_refresh_failed',
      'gbp_api_error',
      'invalid_visibility',
      'encryption_error',
      'invalid_cache_entry',
      'invalid_event',
      () => 400,
    )
    .with('gbp_api_rate_limited', () => 429)
    .with(
      'connection_disconnected',
      'connection_inactive',
      'account_already_connected',
      'invalid_transition',
      'region_unresolved',
      () => HTTP_STATUS.CONFLICT,
    )
    .exhaustive()

/**
 * BQC-7.6: true when an error is the PKCE/state redeem failure. Routes
 * (which may not import the domain layer — boundaries) use this to map the
 * failure to the fail-closed 'invalid_state' redirect.
 */
export const isOAuthStateInvalidError = (e: unknown): boolean =>
  isIntegrationError(e) && e.code === 'oauth_state_invalid'
