// Inbox context — Redis-backed unread counter adapter
// Per architecture: factory function implementing UnreadCounterPort.

import type { UnreadCounterPort } from '../../application/ports/unread-counter.port'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { Redis } from 'ioredis'

const key = (orgId: OrganizationId, userId: UserId) =>
  `inbox:unread:${orgId as string}:${userId as string}`

export const createRedisUnreadCounter = (redis: Redis): UnreadCounterPort => ({
  getCount: async (orgId, userId) => {
    const val = await redis.get(key(orgId, userId))
    return val ? parseInt(val, 10) : 0
  },

  setCount: async (orgId, userId, count) => {
    await redis.set(key(orgId, userId), count.toString())
  },

  increment: async (orgId, userId) => {
    await redis.incr(key(orgId, userId))
  },

  decrement: async (orgId, userId) => {
    await redis.decr(key(orgId, userId))
  },

  invalidate: async (orgId, userId) => {
    await redis.del(key(orgId, userId))
  },
})
