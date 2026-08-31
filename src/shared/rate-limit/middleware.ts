// Rate limiting middleware — uses Redis for fixed-window counting.
// Per architecture: shared rate-limit middleware for public and API endpoints.
//
// Unavailability posture (BQC-7.6): when Redis is absent or erroring the
// limiter FAILS CLOSED in production (deny + error log — a degraded limiter
// must not become an open brute-force/abuse window) and fails open with a
// warn elsewhere (dev/test DX). Override per-instance via `failClosed`.
//
// Issue 13 fix: Uses atomic Lua script (INCR + conditional EXPIRE) to prevent
// the race condition where a process crash between INCR and EXPIRE could leave
// a key with no TTL (permanent lockout).

import type { Redis } from 'ioredis'
import { getLogger } from '#/shared/observability/logger'

export type RateLimiterOptions = Readonly<{
  /** Prefix for Redis keys, e.g. 'ratelimit:public' */
  keyPrefix: string
  /** Maximum requests allowed in the window */
  maxRequests: number
  /** Window duration in seconds */
  windowSeconds: number
  /** Deny when Redis is absent/erroring. Defaults to NODE_ENV === 'production'. */
  failClosed?: boolean
}>

export type RateLimitResult = Readonly<{
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining requests in the current window */
  remaining: number
  /** When the window resets */
  resetAt: Date
  /** Distinguishes legitimate quota exhaustion from an infrastructure denial. */
  backendStatus: 'available' | 'unavailable'
}>
export type RateLimitCheckOptions = Readonly<{
  maxRequests: number
  windowSeconds: number
}>

export type RateLimiter = Readonly<{
  /** Check if a request with the given key is allowed. */
  check(key: string, override?: RateLimitCheckOptions): Promise<RateLimitResult>
}>

// Atomic Lua script: increment the counter and ensure it has a TTL. The
// negative-TTL branch also repairs keys left behind by older implementations
// or interrupted/manual operations, avoiding a permanent denial window.
const INCR_WITH_EXPIRE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`

export function createRateLimiter(
  redis: Redis | undefined,
  opts: RateLimiterOptions,
): RateLimiter {
  // BQC-7.6: production denies guarded traffic when the limiter backend is
  // down; non-production keeps the fail-open + warn DX posture.
  const failClosed = opts.failClosed ?? process.env.NODE_ENV === 'production'

  /** Result when the backend cannot answer. */
  const degraded = (limits: RateLimitCheckOptions): RateLimitResult => {
    const base = {
      resetAt: new Date(Date.now() + limits.windowSeconds * 1000),
      backendStatus: 'unavailable' as const,
    }
    return failClosed
      ? { allowed: false, remaining: 0, ...base }
      : { allowed: true, remaining: limits.maxRequests, ...base }
  }

  return {
    async check(key: string, override?: RateLimitCheckOptions): Promise<RateLimitResult> {
      const limits = override ?? opts
      if (!redis) {
        if (failClosed) {
          getLogger().error(
            '[rate-limit] Redis unavailable — failing CLOSED (requests denied)',
          )
        } else {
          getLogger().warn(
            '[rate-limit] Redis unavailable — failing open (all requests allowed)',
          )
        }
        return degraded(limits)
      }

      try {
        const redisKey = `${opts.keyPrefix}:${key}`

        // Atomic increment + conditional expire via Lua script
        const count = (await redis.eval(
          INCR_WITH_EXPIRE_SCRIPT,
          1,
          redisKey,
          limits.windowSeconds,
        )) as number

        // Get TTL for accurate reset time
        const ttl = await redis.ttl(redisKey)
        const resetAt = new Date(Date.now() + Math.max(ttl, 0) * 1000)

        const remaining = Math.max(limits.maxRequests - count, 0)

        return {
          allowed: count <= limits.maxRequests,
          remaining,
          resetAt,
          backendStatus: 'available',
        }
      } catch {
        if (failClosed) {
          getLogger().error('[rate-limit] Redis error — failing CLOSED')
        } else {
          // Fail open on Redis errors, but log for monitoring
          getLogger().warn('[rate-limit] Redis error — failing open')
        }
        return degraded(limits)
      }
    },
  }
}
