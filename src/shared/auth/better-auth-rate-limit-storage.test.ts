import { describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { createBetterAuthRateLimitStorage } from './better-auth-rate-limit-storage'

function redisDouble() {
  return {
    eval: vi.fn(),
    hmget: vi.fn(),
  }
}

const STORAGE_OPTIONS = { keyHmacSecret: 'unit-test-secret' } as const

describe('Better Auth Redis rate-limit storage', () => {
  it('atomically consumes a pseudonymous, namespaced bucket', async () => {
    const redis = redisDouble()
    redis.eval.mockResolvedValue([1, 10_000])
    const storage = createBetterAuthRateLimitStorage(
      redis as unknown as Redis,
      STORAGE_OPTIONS,
    )

    await expect(
      storage.consume?.('203.0.113.42:/sign-in/email', { window: 10, max: 3 }),
    ).resolves.toEqual({ allowed: true, retryAfter: null })

    expect(redis.eval).toHaveBeenCalledOnce()
    const [, keyCount, redisKey, windowMs, max] = redis.eval.mock.calls[0] ?? []
    expect(keyCount).toBe(1)
    expect(redisKey).toMatch(/^ratelimit:better-auth:v1:[a-f0-9]{64}$/)
    expect(redisKey).not.toContain('203.0.113.42')
    expect(windowMs).toBe(10_000)
    expect(max).toBe(3)
  })

  it('rounds a denied bucket retry delay up to whole seconds', async () => {
    const redis = redisDouble()
    redis.eval.mockResolvedValue([0, 5_001])
    const storage = createBetterAuthRateLimitStorage(
      redis as unknown as Redis,
      STORAGE_OPTIONS,
    )

    await expect(storage.consume?.('bucket', { window: 10, max: 3 })).resolves.toEqual({
      allowed: false,
      retryAfter: 6,
    })
  })

  it('domain-separates stored buckets with the configured HMAC secret', async () => {
    const firstRedis = redisDouble()
    const secondRedis = redisDouble()
    firstRedis.eval.mockResolvedValue([1, 10_000])
    secondRedis.eval.mockResolvedValue([1, 10_000])
    const first = createBetterAuthRateLimitStorage(firstRedis as unknown as Redis, {
      keyHmacSecret: 'first-secret',
    })
    const second = createBetterAuthRateLimitStorage(secondRedis as unknown as Redis, {
      keyHmacSecret: 'second-secret',
    })

    await first.consume?.('same-client', { window: 10, max: 3 })
    await second.consume?.('same-client', { window: 10, max: 3 })

    expect(firstRedis.eval.mock.calls[0]?.[2]).not.toBe(
      secondRedis.eval.mock.calls[0]?.[2],
    )
  })

  it('propagates Redis failures so auth requests fail closed', async () => {
    const redis = redisDouble()
    const failure = new Error('Redis unavailable')
    redis.eval.mockRejectedValue(failure)
    const storage = createBetterAuthRateLimitStorage(
      redis as unknown as Redis,
      STORAGE_OPTIONS,
    )

    await expect(storage.consume?.('bucket', { window: 10, max: 3 })).rejects.toBe(
      failure,
    )
  })
})
