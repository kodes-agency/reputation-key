// Rate limiting middleware — uses Redis for sliding window counting.
// Per architecture: shared rate-limit middleware for public and API endpoints.
// Fails open when Redis is unavailable (rate limiting is a nice-to-have, not critical).
//
// Issue 13 fix: Uses atomic Lua script (INCR + conditional EXPIRE) to prevent
// the race condition where a process crash between INCR and EXPIRE could leave
// a key with no TTL (permanent lockout).

import type { Redis } from 'ioredis'

// fallow-ignore-next-line unused-type
export type RateLimiterOptions = Readonly<{
  /** Prefix for Redis keys, e.g. 'ratelimit:public' */
  keyPrefix: string
  /** Maximum requests allowed in the window */
  maxRequests: number
  /** Window duration in seconds */
  windowSeconds: number
}>

// fallow-ignore-next-line unused-type
export type RateLimitResult = Readonly<{
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in the current window */
  remaining: number
  /** When the window resets */
  resetAt: Date
}>

export type RateLimiter = Readonly<{
  /** Check if a request with the given key is allowed. */
  check(key: string): Promise<RateLimitResult>
}>

// Atomic Lua script: increment counter and set TTL on first request.
// This eliminates the race condition between INCR and EXPIRE.
const INCR_WITH_EXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`

export function createRateLimiter(
  redis: Redis | undefined,
  opts: RateLimiterOptions,
): RateLimiter {
  return {
    async check(key: string): Promise<RateLimitResult> {
      // Fail open: if no Redis, allow everything
      if (!redis) {
        return {
          allowed: true,
          remaining: opts.maxRequests,
          resetAt: new Date(Date.now() + opts.windowSeconds * 1000),
        }
      }

      try {
        const redisKey = `${opts.keyPrefix}:${key}`

        // Atomic increment + conditional expire via Lua script
        const count = (await redis.eval(
          INCR_WITH_EXPIRE_SCRIPT,
          1,
          redisKey,
          opts.windowSeconds,
        )) as number

        // Get TTL for accurate reset time
        const ttl = await redis.ttl(redisKey)
        const resetAt = new Date(Date.now() + Math.max(ttl, 0) * 1000)

        const remaining = Math.max(opts.maxRequests - count, 0)

        return {
          allowed: count <= opts.maxRequests,
          remaining,
          resetAt,
        }
      } catch {
        // Fail open on Redis errors
        return {
          allowed: true,
          remaining: opts.maxRequests,
          resetAt: new Date(Date.now() + opts.windowSeconds * 1000),
        }
      }
    },
  }
}
