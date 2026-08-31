import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import { createRateLimiter } from '#/shared/rate-limit/middleware'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { checkLayeredGuestRateLimit, guestRateLimitKeys } from './guest-session'

describe('layered guest rate limits across app instances', () => {
  let lease: RedisTestLease

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
  })

  afterAll(() => {
    lease.release()
  })

  it('shares both the session and network-and-Portal limits', async () => {
    if (!lease.available || !lease.redis) return

    const prefix = `test:guest-layered-rate-limit:${randomUUID()}`
    const secondConnection = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondConnection.connect()

    try {
      const options = {
        keyPrefix: prefix,
        maxRequests: 100,
        windowSeconds: 60,
        failClosed: true,
      } as const
      const firstInstance = createRateLimiter(lease.redis, options)
      const secondInstance = createRateLimiter(secondConnection, options)

      const sharedSessionResults = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          checkLayeredGuestRateLimit({
            rateLimiter: index % 2 === 0 ? firstInstance : secondInstance,
            keys: guestRateLimitKeys(
              'response',
              'shared-session',
              `network-${index}`,
              'portal-1',
            ),
            sessionLimits: { maxRequests: 2, windowSeconds: 60 },
            networkPortalLimits: { maxRequests: 100, windowSeconds: 60 },
          }),
        ),
      )
      expect(sharedSessionResults.filter((result) => result.allowed)).toHaveLength(2)

      const sharedNetworkResults = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          checkLayeredGuestRateLimit({
            rateLimiter: index % 2 === 0 ? firstInstance : secondInstance,
            keys: guestRateLimitKeys(
              'scan',
              `session-${index}`,
              'shared-network',
              'portal-1',
            ),
            sessionLimits: { maxRequests: 1, windowSeconds: 60 },
            networkPortalLimits: { maxRequests: 3, windowSeconds: 60 },
          }),
        ),
      )
      expect(sharedNetworkResults.filter((result) => result.allowed)).toHaveLength(3)

      const sessionTtl = await secondConnection.ttl(`${prefix}:response:shared-session`)
      const networkTtl = await secondConnection.ttl(
        `${prefix}:scan:network:shared-network:portal:portal-1`,
      )
      expect(sessionTtl).toBeGreaterThan(0)
      expect(networkTtl).toBeGreaterThan(0)
    } finally {
      const keys = await secondConnection.keys(`${prefix}:*`)
      if (keys.length > 0) await secondConnection.del(...keys)
      secondConnection.disconnect()
    }
  })
})
