// Integration context — shared server helpers
// Error-to-HTTP-status mapping shared across server function modules.

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import type { IntegrationErrorCode } from '../domain/errors'

export const integrationErrorStatus = (code: IntegrationErrorCode): number =>
  match(code)
    .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('connection_not_found', 'import_not_found', () => HTTP_STATUS.NOT_FOUND)
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
    .with('connection_disconnected', 'connection_inactive', () => HTTP_STATUS.CONFLICT)
    .exhaustive()
