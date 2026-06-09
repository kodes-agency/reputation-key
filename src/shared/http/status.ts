// Shared error-to-HTTP-status mapping — eliminates duplicated magic numbers across contexts.
// Each context's server layer maps domain error codes to HTTP status codes via ts-pattern's match.
// This module provides named constants for the three standard mappings used by ALL contexts.
//
// Usage (context with only standard codes):
//   import { standardErrorStatus } from '#/shared/http/status'
//   export const dashboardErrorStatus = standardErrorStatus
//
// Usage (context with custom codes — keep match for exhaustiveness):
//   import { HTTP_STATUS } from '#/shared/http/status'
//   export const portalErrorStatus = (code: PortalErrorCode): number =>
//     match(code)
//       .with('forbidden', () => HTTP_STATUS.FORBIDDEN)
//       .with('portal_not_found', 'property_not_found', () => HTTP_STATUS.NOT_FOUND)
//       .with('invalid_input', () => HTTP_STATUS.BAD_REQUEST)
//       .exhaustive()

/** HTTP status codes used for domain error → HTTP mapping. */
export const HTTP_STATUS = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  MULTI_STATUS: 207,
  SERVER_ERROR: 500,
  BADGATEWAY: 502,
} as const

const STANDARD_MAP = {
  forbidden: HTTP_STATUS.FORBIDDEN,
  not_found: HTTP_STATUS.NOT_FOUND,
  invalid_input: HTTP_STATUS.BAD_REQUEST,
} as const

/**
 * For contexts whose ErrorCode union ONLY contains forbidden, not_found, invalid_input.
 * Use directly as the errorStatus function (assign, don't wrap):
 *   export const dashboardErrorStatus = standardErrorStatus
 */
export function standardErrorStatus(code: keyof typeof STANDARD_MAP): number {
  return STANDARD_MAP[code]
}
