// Integration context — shared server helpers
// Error-to-HTTP-status mapping shared across server function modules.

import { match } from 'ts-pattern'
import type { IntegrationErrorCode } from '../domain/errors'

export const integrationErrorStatus = (code: IntegrationErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('connection_not_found', 'import_not_found', () => 404)
    .with(
      'oauth_failed',
      'oauth_denied',
      'token_refresh_failed',
      'gbp_api_error',
      'invalid_visibility',
      'encryption_error',
      'invalid_cache_entry',
      () => 400,
    )
    .with('gbp_api_rate_limited', () => 429)
    .with('connection_disconnected', 'connection_inactive', () => 409)
    .exhaustive()
