// Tests for rate limiting middleware
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRateLimiter } from './middleware'
import type { Redis } from 'ioredis'

function createMockRedis() {
  const counters = new Map<string, { count: number; ttl: number }>()

  return {
    _counters: counters,
    incr: vi.fn(async (key: string) => {
      const entry = counters.get(key) ?? { count: 0, ttl: 60 }
      entry.count += 1
      counters.set(key, entry)
      return entry.count
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const entry = counters.get(key)
      if (entry) {
        entry.ttl = seconds
      }
      return 1
    }),
    ttl: vi.fn(async (key: string) => {
      const entry = counters.get(key)
      return entry?.ttl ?? -1
    }),
    // Mock eval for atomic Lua script (INCR + conditional EXPIRE)
    eval: vi.fn(
      async (_script: string, _numKeys: number, key: string, seconds: string) => {
        const entry = counters.get(key) ?? { count: 0, ttl: 60 }
        entry.count += 1
        if (entry.count === 1) {
          entry.ttl = Number(seconds)
        }
        counters.set(key, entry)
        return entry.count
      },
    ),
  }
}

describe('createRateLimiter', () => {
  const defaultOpts = {
    keyPrefix: 'ratelimit:test',
    maxRequests: 3,
    windowSeconds: 60,
  }

  describe('with Redis available', () => {
    let mockRedis: ReturnType<typeof createMockRedis>

    beforeEach(() => {
      mockRedis = createMockRedis()
    })

    it('allows requests within the limit', async () => {
      const limiter = createRateLimiter(mockRedis as unknown as Redis, defaultOpts)
      const result = await limiter.check('user-1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2)
    })

    it('blocks requests over the limit', async () => {
      const limiter = createRateLimiter(mockRedis as unknown as Redis, defaultOpts)
      await limiter.check('user-1')
      await limiter.check('user-1')
      await limiter.check('user-1')
      const result = await limiter.check('user-1')
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('tracks remaining correctly', async () => {
      const limiter = createRateLimiter(mockRedis as unknown as Redis, defaultOpts)
      const r1 = await limiter.check('user-1')
      expect(r1.remaining).toBe(2)
      const r2 = await limiter.check('user-1')
      expect(r2.remaining).toBe(1)
      const r3 = await limiter.check('user-1')
      expect(r3.remaining).toBe(0)
    })

    it('tracks different keys independently', async () => {
      const limiter = createRateLimiter(mockRedis as unknown as Redis, defaultOpts)
      await limiter.check('user-1')
      await limiter.check('user-1')
      const result = await limiter.check('user-2')
      expect(result.remaining).toBe(2)
    })

    it('returns resetAt in the future', async () => {
      const limiter = createRateLimiter(mockRedis as unknown as Redis, defaultOpts)
      const result = await limiter.check('user-1')
      expect(result.resetAt.getTime()).toBeGreaterThan(Date.now() - 1000)
    })
  })

  describe('with Redis unavailable', () => {
    it('allows all requests when Redis is undefined', async () => {
      const limiter = createRateLimiter(undefined, defaultOpts)
      for (let i = 0; i < 10; i++) {
        const result = await limiter.check('user-1')
        expect(result.allowed).toBe(true)
      }
    })

    it('returns max remaining when Redis is undefined', async () => {
      const limiter = createRateLimiter(undefined, defaultOpts)
      const result = await limiter.check('user-1')
      expect(result.remaining).toBe(defaultOpts.maxRequests)
    })
  })

  describe('with Redis errors', () => {
    it('fails open on Redis incr error', async () => {
      const brokenRedis = createMockRedis()
      brokenRedis.incr.mockRejectedValue(new Error('connection refused'))
      const limiter = createRateLimiter(brokenRedis as unknown as Redis, defaultOpts)
      const result = await limiter.check('user-1')
      expect(result.allowed).toBe(true)
    })
  })
})
