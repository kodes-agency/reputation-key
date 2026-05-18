// Inbox context — Redis unread counter adapter tests

import { describe, it, expect } from 'vitest'
import { createRedisUnreadCounter } from './redis-unread-counter'
import { organizationId, userId } from '#/shared/domain/ids'

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
  } as unknown as import('ioredis').Redis
}

const orgId = organizationId('org-001')
const uid = userId('user-001')

describe('createRedisUnreadCounter', () => {
  it('returns 0 when no count is set', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(0)
  })

  it('sets and gets a count', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, uid, 5)
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(5)
  })

  it('increments from zero', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.increment(orgId, uid)
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(1)
  })

  it('increments from existing value', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, uid, 3)
    await counter.increment(orgId, uid)
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(4)
  })

  it('decrements from existing value', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, uid, 5)
    await counter.decrement(orgId, uid)
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(4)
  })

  it('decrements from zero (goes negative)', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.decrement(orgId, uid)
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(-1)
  })

  it('invalidates (deletes) the key', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    await counter.setCount(orgId, uid, 10)
    await counter.invalidate(orgId, uid)
    const count = await counter.getCount(orgId, uid)
    expect(count).toBe(0)
  })

  it('uses separate keys per org/user', async () => {
    const counter = createRedisUnreadCounter(createMockRedis())
    const org2 = organizationId('org-002')
    const user2 = userId('user-002')

    await counter.setCount(orgId, uid, 5)
    await counter.setCount(org2, user2, 10)

    expect(await counter.getCount(orgId, uid)).toBe(5)
    expect(await counter.getCount(org2, user2)).toBe(10)

    await counter.invalidate(orgId, uid)
    expect(await counter.getCount(orgId, uid)).toBe(0)
    expect(await counter.getCount(org2, user2)).toBe(10)
  })
})
