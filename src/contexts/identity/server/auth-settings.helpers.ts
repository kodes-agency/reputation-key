// Shared error handler for auth-settings server functions.
// Extracted from auth-settings.ts to keep each file ≤150 lines.

import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import type { LoggerPort } from '#/shared/domain/logger.port'

/**
 * Map a better-auth failure to a server-function error. A client error (4xx
 * APIError) keeps its status and the domain code the UI relies on; anything
 * else goes to the shared `catchUntagged` mapping.
 */
export const handleAuthError = (
  logger: Pick<LoggerPort, 'warn'>,
  error: unknown,
  errorName: string,
  code: string,
  fallbackMessage: string,
): never => {
  // Distinguish error types for proper HTTP status mapping
  const apiError =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode: number; message?: string })
      : null

  logger.warn(
    apiError ? { err: error, statusCode: apiError.statusCode } : { err: error },
    `${errorName}: ${code}`,
  )

  if (apiError) {
    const status = apiError.statusCode
    const message = apiError.message ?? fallbackMessage

    if (status === 401) {
      throwContextError(
        errorName,
        { code: 'unauthorized', message: 'Authentication required' },
        401,
      )
    }
    if (status === 403) {
      throwContextError(
        errorName,
        { code: 'forbidden', message: 'Insufficient permissions' },
        403,
      )
    }
    if (status === 404) {
      throwContextError(errorName, { code: 'not_found', message }, 404)
    }
    if (status === 409) {
      throwContextError(errorName, { code: 'conflict', message }, 409)
    }
    if (status === 429) {
      throwContextError(
        errorName,
        { code: 'rate_limited', message: 'Too many requests' },
        429,
      )
    }
    // Client errors (4xx) — forward with original status
    if (status >= 400 && status < 500) {
      throwContextError(errorName, { code, message }, status)
    }
  }

  // A better-auth server failure (5xx) or a non-API error is not the
  // caller's fault: the shared mapping keeps it a 5xx, so it reaches error
  // monitoring, and masks an untagged error's internals.
  catchUntagged(error)
}
