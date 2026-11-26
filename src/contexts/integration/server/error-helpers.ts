// Integration context — shared server helpers
// Error-to-HTTP-status mapping shared across server function modules.

import { match } from 'ts-pattern'
import type { CommandErrors } from '#/shared/commands/contracts'
import { HTTP_STATUS } from '#/shared/http/status'
import type { IntegrationError, IntegrationErrorCode } from '../domain/errors'
import { isIntegrationError } from '../domain/errors'

export const integrationErrorStatus = (code: IntegrationErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('connection_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with(
      'oauth_failed',
      'oauth_state_invalid',
      'scope_not_granted',
      'token_refresh_failed',
      'gbp_api_error',
      'encryption_error',
      () => 400,
    )
    .with('gbp_api_rate_limited', () => 429)
    .with(
      'connection_disconnected',
      'connection_inactive',
      'reauthorization_required',
      'account_already_connected',
      'invalid_transition',
      () => HTTP_STATUS.CONFLICT,
    )
    .exhaustive()

export const integrationCommandErrors: CommandErrors<IntegrationError> = {
  name: 'IntegrationError',
  is: isIntegrationError,
  status: integrationErrorStatus,
}

/**
 * BQC-7.6: true when an error is the PKCE/state redeem failure. Routes
 * (which may not import the domain layer — boundaries) use this to map the
 * failure to the fail-closed 'invalid_state' redirect.
 */
export const isOAuthStateInvalidError = (e: unknown): boolean =>
  isIntegrationError(e) && e.code === 'oauth_state_invalid'
