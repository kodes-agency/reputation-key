// Tests for Redis cache implementation
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRedisCache } from './redis-cache'
import type { Redis } from 'ioredis'

function createMockRedis(): Redis & {
  _store: Map<string, { value: string; expiresAt?: number }>
} {
  const store = new Map<string, { value: string; expiresAt?: number }>()

  return {
    _store: store,
    get: vi.fn(async (key: string) => {
      const entry = store.get(key)
      if (!entry) return null
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key)
        return null
      }
      return entry.value
    }),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      // Parse EX option: set(key, value, 'EX', seconds)
      let expiresAt: number | undefined
      if (args[0] === 'EX' && typeof args[1] === 'number') {
        expiresAt = Date.now() + args[1] * 1000
      }
      store.set(key, { value, expiresAt })
      return 'OK'
    }),
    del: vi.fn(async (key: string) => {
      const existed = store.has(key)
      store.delete(key)
      return existed ? 1 : 0
    }),
    exists: vi.fn(async (key: string) => {
      const entry = store.get(key)
      if (!entry) return 0
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key)
        return 0
      }
      return 1
    }),
  } as unknown as Redis & { _store: Map<string, { value: string; expiresAt?: number }> }
}

describe('createRedisCache', () => {
  let mockRedis: ReturnType<typeof createMockRedis>

  beforeEach(() => {
    mockRedis = createMockRedis()
  })

  describe('get', () => {
    it('returns null for missing key', async () => {
      const cache = createRedisCache(mockRedis)
      const result = await cache.get<string>('missing')
      expect(result).toBeNull()
    })

    it('returns deserialized value for existing key', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('test-key', { name: 'test' })
      const result = await cache.get<{ name: string }>('test-key')
      expect(result).toEqual({ name: 'test' })
    })

    it('returns null when Redis throws', async () => {
      const brokenRedis = createMockRedis()
      ;(brokenRedis.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection refused'),
      )
      const cache = createRedisCache(brokenRedis)
      const result = await cache.get<string>('any-key')
      expect(result).toBeNull()
    })
  })

  describe('set', () => {
    it('stores a value without TTL', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('key', 'value')
      const stored = mockRedis._store.get('key')
      expect(stored).toBeDefined()
      expect(JSON.parse(stored!.value)).toBe('value')
      expect(stored!.expiresAt).toBeUndefined()
    })

    it('stores a value with TTL', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('key', 'value', 60)
      const stored = mockRedis._store.get('key')
      expect(stored).toBeDefined()
      expect(stored!.expiresAt).toBeDefined()
      expect(stored!.expiresAt! - Date.now()).toBeGreaterThan(59000)
    })

    it('does not throw when Redis fails', async () => {
      const brokenRedis = createMockRedis()
      ;(brokenRedis.set as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection refused'),
      )
      const cache = createRedisCache(brokenRedis)
      await expect(cache.set('key', 'value')).resolves.toBeUndefined()
    })
  })

  describe('delete', () => {
    it('removes an existing key', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('key', 'value')
      await cache.delete('key')
      const result = await cache.get('key')
      expect(result).toBeNull()
    })

    it('does not throw when deleting a non-existent key', async () => {
      const cache = createRedisCache(mockRedis)
      await expect(cache.delete('non-existent')).resolves.toBeUndefined()
    })

    it('does not throw when Redis fails', async () => {
      const brokenRedis = createMockRedis()
      ;(brokenRedis.del as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection refused'),
      )
      const cache = createRedisCache(brokenRedis)
      await expect(cache.delete('key')).resolves.toBeUndefined()
    })
  })

  describe('exists', () => {
    it('returns true for existing key', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('key', 'value')
      expect(await cache.exists('key')).toBe(true)
    })

    it('returns false for missing key', async () => {
      const cache = createRedisCache(mockRedis)
      expect(await cache.exists('missing')).toBe(false)
    })

    it('returns false when Redis throws', async () => {
      const brokenRedis = createMockRedis()
      ;(brokenRedis.exists as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('connection refused'),
      )
      const cache = createRedisCache(brokenRedis)
      expect(await cache.exists('any-key')).toBe(false)
    })
  })

  describe('TTL expiration', () => {
    it('returns null for expired key', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('key', 'value', 0.001) // 1ms TTL
      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10))
      const result = await cache.get('key')
      expect(result).toBeNull()
    })

    it('exists returns false for expired key', async () => {
      const cache = createRedisCache(mockRedis)
      await cache.set('key', 'value', 0.001)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(await cache.exists('key')).toBe(false)
    })
  })
})
