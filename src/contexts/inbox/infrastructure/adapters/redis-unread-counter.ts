// Inbox context — Redis-backed unread counter adapter
// Per architecture: factory function implementing UnreadCounterPort.
//
// Counter is scoped per orgId only (see port for design rationale).

import type { UnreadCounterPort } from '../../application/ports/unread-counter.port'
import type { OrganizationId } from '#/shared/domain/ids'
import type { Redis } from 'ioredis'

const key = (orgId: OrganizationId) => `inbox:unread:${orgId as string}`

// Lua script: decrement but floor at 0 to prevent negative counts
const DECREMENT_FLOOR_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then
    return redis.call('DECR', KEYS[1])
  end
  return current
`

export const createRedisUnreadCounter = (redis: Redis): UnreadCounterPort => ({
  getCount: async (orgId) => {
    const val = await redis.get(key(orgId))
    return val ? parseInt(val, 10) : 0
  },

  setCount: async (orgId, count) => {
    await redis.set(key(orgId), count.toString())
  },

  increment: async (orgId) => {
    await redis.incr(key(orgId))
  },

  decrement: async (orgId) => {
    await redis.eval(DECREMENT_FLOOR_SCRIPT, 1, key(orgId))
  },

  invalidate: async (orgId) => {
    await redis.del(key(orgId))
  },
})
