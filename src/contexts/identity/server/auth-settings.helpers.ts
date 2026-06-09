// Shared error handler for auth-settings server functions.
// Extracted from auth-settings.ts to keep each file ≤150 lines.

import { throwContextError } from '#/shared/auth/server-errors'
import { getLogger } from '#/shared/observability/logger'

/** Map better-auth APIError status codes to appropriate HTTP status + domain code. */
export const handleAuthError = (
  error: unknown,
  errorName: string,
  code: string,
  fallbackMessage: string,
): never => {
  // Distinguish error types for proper HTTP status mapping
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const apiError = error as { statusCode: number; message?: string }
    const status = apiError.statusCode
    const message = apiError.message ?? fallbackMessage

    getLogger().warn({ err: error, statusCode: status }, `${errorName}: ${code}`)

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

  // Fallback for non-APIError errors
  getLogger().warn({ err: error }, `${errorName}: ${code}`)
  throwContextError(errorName, { code, message: fallbackMessage }, 400)
}
