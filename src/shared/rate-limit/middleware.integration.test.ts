import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createRateLimiter } from './middleware'

describe('shared rate limiter across replicas', () => {
  let lease: RedisTestLease

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
  })

  afterAll(() => {
    lease.release()
  })

  it('atomically enforces one allowance through independent connections', async () => {
    if (!lease.available) return
    const prefix = `test:shared-rate-limit:${randomUUID()}`
    const secondConnection = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondConnection.connect()
    try {
      const options = {
        keyPrefix: prefix,
        maxRequests: 5,
        windowSeconds: 60,
        failClosed: true,
      } as const
      const firstReplica = createRateLimiter(lease.redis, options)
      const secondReplica = createRateLimiter(secondConnection, options)

      const results = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          (index % 2 === 0 ? firstReplica : secondReplica).check('shared-subject'),
        ),
      )

      expect(results.filter((result) => result.allowed)).toHaveLength(5)
      expect(results.filter((result) => !result.allowed)).toHaveLength(25)
      expect(await secondConnection.ttl(`${prefix}:shared-subject`)).toBeGreaterThan(0)
    } finally {
      await secondConnection.del(`${prefix}:shared-subject`)
      secondConnection.disconnect()
    }
  })
})
