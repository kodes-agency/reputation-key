import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createBetterAuthRateLimitStorage } from './better-auth-rate-limit-storage'

describe('Better Auth rate limiting across replicas', () => {
  let lease: RedisTestLease

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
  })

  afterAll(() => {
    lease.release()
  })

  it('admits no more than the shared maximum under concurrent consumers', async () => {
    if (!lease.available) return
    const prefix = `test:better-auth:${randomUUID()}`
    const secondConnection = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondConnection.connect()
    try {
      const options = { keyPrefix: prefix, keyHmacSecret: 'integration-test-secret' }
      const firstReplica = createBetterAuthRateLimitStorage(lease.redis as Redis, options)
      const secondReplica = createBetterAuthRateLimitStorage(secondConnection, options)

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          (index % 2 === 0 ? firstReplica : secondReplica).consume?.('same-client', {
            window: 2,
            max: 3,
          }),
        ),
      )

      expect(outcomes.filter((outcome) => outcome?.allowed)).toHaveLength(3)
      expect(outcomes.filter((outcome) => !outcome?.allowed)).toHaveLength(17)
      for (const denied of outcomes.filter((outcome) => !outcome?.allowed)) {
        expect(denied?.retryAfter).toBeGreaterThan(0)
        expect(denied?.retryAfter).toBeLessThanOrEqual(2)
      }
    } finally {
      secondConnection.disconnect()
    }
  })
})
