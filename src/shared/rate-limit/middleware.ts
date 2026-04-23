// Rate limiting middleware — uses Redis for sliding window counting.
// Per architecture: shared rate-limit middleware for public and API endpoints.
// Fails open when Redis is unavailable (rate limiting is a nice-to-have, not critical).

import type { Redis } from 'ioredis'

export type RateLimiterOptions = Readonly<{
  /** Prefix for Redis keys, e.g. 'ratelimit:public' */
  keyPrefix: string
  /** Maximum requests allowed in the window */
  maxRequests: number
  /** Window duration in seconds */
  windowSeconds: number
}>

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

        // Use INCR to atomically increment and get the count
        const count = await redis.incr(redisKey)

        // Set expiry only on first request in the window
        if (count === 1) {
          await redis.expire(redisKey, opts.windowSeconds)
        }

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
