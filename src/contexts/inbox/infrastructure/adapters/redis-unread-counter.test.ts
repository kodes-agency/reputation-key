// Inbox context — Redis unread counter adapter tests

import { describe, it, expect } from 'vitest'
import { createRedisUnreadCounter } from './redis-unread-counter'
import { organizationId } from '#/shared/domain/ids'

function createMockRedis() {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v)
    },
    incr: async (k: string) => {
      const v = parseInt(store.get(k) ?? '0', 10) + 1
      store.set(k, v.toString())
      return v
    },
    decr: async (k: string) => {
      const v = parseInt(store.get(k) ?? '0', 10) - 1
      store.set(k, v.toString())
      return v
    },
    del: async (...args: string[]) => {
      for (const k of args) store.delete(k)
      return args.length
    },
    eval: async (_script: string, _numKeys: number, ...keys: string[]) => {
      // Minimal Lua interpreter for the decrement-floor-at-0 script
      const k = keys[0]
      const current = parseInt(store.get(k) ?? '0', 10)
      if (current > 0) {
        const newVal = current - 1
        store.set(k, newVal.toString())
        return newVal
      }
      return current
    },
  } as unknown as import('ioredis').Redis
}

const orgId = organizationId('org-001')

describe('createRedisUnreadCounter', () => {
  it('returns 0 when no count is set', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    const count = await counter.getCount(orgId)
    expect(count).toBe(0)
  })

  it('sets and gets a count', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, 5)
    const count = await counter.getCount(orgId)
    expect(count).toBe(5)
  })

  it('increments from zero', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.increment(orgId)
    const count = await counter.getCount(orgId)
    expect(count).toBe(1)
  })

  it('increments from existing value', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, 3)
    await counter.increment(orgId)
    const count = await counter.getCount(orgId)
    expect(count).toBe(4)
  })

  it('decrements from existing value', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, 5)
    await counter.decrement(orgId)
    const count = await counter.getCount(orgId)
    expect(count).toBe(4)
  })

  it('decrements from zero (floors at 0)', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.decrement(orgId)
    const count = await counter.getCount(orgId)
    expect(count).toBe(0)
  })

  it('invalidates (deletes) the key', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, 10)
    await counter.invalidate(orgId)
    const count = await counter.getCount(orgId)
    expect(count).toBe(0)
  })

  it('uses separate keys per org', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    const org2 = organizationId('org-002')

    await counter.setCount(orgId, 5)
    await counter.setCount(org2, 10)

    expect(await counter.getCount(orgId)).toBe(5)
    expect(await counter.getCount(org2)).toBe(10)

    await counter.invalidate(orgId)
    expect(await counter.getCount(orgId)).toBe(0)
    expect(await counter.getCount(org2)).toBe(10)
  })
})
