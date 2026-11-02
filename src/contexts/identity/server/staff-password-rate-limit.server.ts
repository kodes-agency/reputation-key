import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
export const STAFF_PASSWORD_FAILURE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 3600,
} as const
export function staffPasswordFailureKey(userId: string) {
  return `staff:password:failed:${userId}`
}
export async function assertStaffPasswordBudget(
  rateLimiter: RateLimiter,
  userId: string,
) {
  const remaining = await rateLimiter.remaining?.(
    staffPasswordFailureKey(userId),
    STAFF_PASSWORD_FAILURE_LIMIT,
  )
  if (remaining === undefined || remaining <= 0)
    throwContextError(
      'AuthError',
      {
        code: 'rate_limited',
        message: 'Please wait before trying to change your password again.',
      },
      429,
    )
}
