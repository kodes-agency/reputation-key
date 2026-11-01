import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'

export function rethrowStaffAccount(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    ['StaffAccountError', 'PortalError'].includes(String(error._tag)) &&
    'code' in error &&
    'message' in error
  ) {
    throwContextError(
      'StaffAccountError',
      { code: String(error.code), message: String(error.message) },
      error.code === 'forbidden'
        ? 403
        : error.code === 'rate_limited'
          ? 429
          : error.code === 'participation_not_found'
            ? 404
            : 409,
    )
  }
  throw catchUntagged(error)
}
