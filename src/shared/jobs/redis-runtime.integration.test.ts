import { describe, expect, it } from 'vitest'
import { Redis } from 'ioredis'
import { assertJobRedisRuntime } from './redis-runtime'

const REDIS_URL = process.env.REDIS_URL
if (!REDIS_URL) throw new Error('REDIS_URL is required for Redis integration tests')

describe('BullMQ Redis runtime integration', () => {
  it('proves the configured test Redis satisfies the boot contract', async () => {
    const redis = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
    try {
      await redis.connect()
      await expect(assertJobRedisRuntime(redis)).resolves.toMatchObject({
        ok: true,
        maxmemoryPolicy: 'noeviction',
        getdelAvailable: true,
      })
    } finally {
      redis.disconnect()
    }
  })
})
