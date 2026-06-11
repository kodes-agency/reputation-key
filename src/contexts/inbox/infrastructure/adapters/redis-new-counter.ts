// Inbox context — Redis-backed new counter adapter
// Per architecture: factory function implementing NewCounterPort.
//
// Counter is scoped per orgId only (see port for design rationale).

import type { NewCounterPort } from '../../application/ports/new-counter.port'
import type { OrganizationId } from '#/shared/domain/ids'
import type { Redis } from 'ioredis'
import { getLogger } from '#/shared/observability/logger'

const key = (orgId: OrganizationId) => `inbox:new:${orgId as string}`

// Lua script: decrement but floor at 0 to prevent negative counts
const DECREMENT_FLOOR_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then
    return redis.call('DECR', KEYS[1])
  end
  return current
`

// Lua script: decrement by N but floor at 0
const DECREMENT_BY_FLOOR_SCRIPT = `
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  local delta = tonumber(ARGV[1])
  if current <= 0 then return 0 end
  if current >= delta then
    return redis.call('DECRBY', KEYS[1], delta)
  end
  redis.call('SET', KEYS[1], '0')
  return 0
`

export const createRedisNewCounter = (redis: Redis): NewCounterPort => ({
  getCount: async (orgId) => {
    try {
      const val = await redis.get(key(orgId))
      if (!val) return 0
      const n = parseInt(val, 10)
      return Number.isNaN(n) ? 0 : n // INF-011 NaN guard
    } catch (e) {
      getLogger().warn({ err: e, orgId }, 'Redis getCount failed — serving 0')
      return 0
    }
  },

  setCount: async (orgId, count) => {
    try {
      await redis.set(key(orgId), count.toString(), 'EX', 86400) // INF-009: 24h TTL
    } catch (e) {
      getLogger().warn({ err: e, orgId, count }, 'Redis setCount failed')
    }
  },

  increment: async (orgId) => {
    try {
      const k = key(orgId)
      await redis.incr(k)
      // F113 FIX: Refresh TTL on increment so the key doesn't expire silently
      // while still being actively incremented
      await redis.expire(k, 86400)
    } catch (e) {
      getLogger().warn({ err: e, orgId }, 'Redis increment failed')
    }
  },

  decrement: async (orgId) => {
    try {
      await redis.eval(DECREMENT_FLOOR_SCRIPT, 1, key(orgId))
    } catch (e) {
      getLogger().warn({ err: e, orgId }, 'Redis decrement failed')
    }
  },

  decrementBy: async (orgId, count) => {
    try {
      await redis.eval(DECREMENT_BY_FLOOR_SCRIPT, 1, key(orgId), count.toString())
    } catch (e) {
      getLogger().warn({ err: e, orgId, count }, 'Redis decrementBy failed')
    }
  },

  invalidate: async (orgId) => {
    try {
      await redis.del(key(orgId))
    } catch (e) {
      getLogger().warn({ err: e, orgId }, 'Redis invalidate failed')
    }
  },
})
