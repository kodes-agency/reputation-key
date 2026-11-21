import type { RateLimiter } from '#/shared/rate-limit/middleware'
import type { GoogleCheckRateLimitPort } from './google-check-rate-limit.port.server'

/**
 * Map the shared fixed-window limiter onto Inbox's three-answer port. A limiter
 * that throws or reports its backend unavailable is `unavailable`, not
 * `limited`: the manager is told Google could not be checked, not that they
 * asked too often.
 */
export const createGoogleCheckRateLimitAdapter = (
  limiter: RateLimiter,
): GoogleCheckRateLimitPort => ({
  consume: async (key, limit) => {
    try {
      const result = await limiter.check(key, limit)
      if (result.allowed) return 'allowed'
      return result.backendStatus === 'unavailable' ? 'unavailable' : 'limited'
    } catch {
      return 'unavailable'
    }
  },
})
