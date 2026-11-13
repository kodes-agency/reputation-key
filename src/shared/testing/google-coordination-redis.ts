// Real-Redis access for tests of the Google quota and in-flight coordinators
// (`GoogleCoordinationRedis`).
//
// Each created handle prefixes every key it touches with its own namespace, so
// suites sharing one Redis cannot see each other's buckets, and every key a
// test wrote is removed afterwards. The coordinators' own Lua scripts run
// unchanged; only time (the coordinators' `nowMs`) is the test's.

import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import type { Redis } from 'ioredis'
import type { GoogleCoordinationRedis } from '#/shared/google-provider-control/quota-coordinator'
import { acquireRedisTestLease, type RedisTestLease } from './redis-test-lease'

export type GoogleCoordinationTestRedis = GoogleCoordinationRedis & {
  /** Every call rejects while true, as an unreachable Redis would. */
  fail: boolean
  /** Stored quota buckets, scaled as the coordinator stores them. */
  quotaBuckets(): Promise<Array<{ key: string; binding: string; tokens: number }>>
  /** Overwrite the binding stored on the quota bucket at this position (keys sorted). */
  rebindBucket(index: number, binding: string): Promise<void>
  /** Count of in-flight binding keys and lease sets currently stored. */
  inFlightKeyCount(): Promise<number>
}

/**
 * Registers the Redis lease hooks for the calling suite and returns a factory
 * for namespaced handles. Tests skip when no local Redis answers, unless
 * REQUIRE_TEST_REDIS=1, which makes the lease throw instead.
 */
export function useGoogleCoordinationRedis(): {
  create: () => GoogleCoordinationTestRedis
} {
  let lease: RedisTestLease | undefined
  const namespaces: string[] = []

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
  })
  beforeEach((context) => {
    if (!lease?.available) context.skip()
  })
  afterEach(async () => {
    const redis = lease?.redis
    if (!redis) return
    for (const namespace of namespaces.splice(0)) {
      const keys = await redis.keys(`${namespace}:*`)
      if (keys.length > 0) await redis.del(...keys)
    }
  })
  afterAll(() => lease?.release())

  return {
    create() {
      const redis = lease?.redis
      if (!redis) throw new Error('Redis test lease is not available')
      const namespace = `google-coordination-test:${randomUUID()}`
      namespaces.push(namespace)
      return createHandle(redis, namespace)
    },
  }
}

function createHandle(redis: Redis, namespace: string): GoogleCoordinationTestRedis {
  const scoped = async (type: string) => {
    const keys = (await redis.keys(`${namespace}:*`)).sort()
    const typed: string[] = []
    for (const key of keys) if ((await redis.type(key)) === type) typed.push(key)
    return typed
  }
  const handle: GoogleCoordinationTestRedis = {
    fail: false,
    eval: async (script, numberOfKeys, ...args) => {
      if (handle.fail) throw new Error('redis unavailable')
      const keys = args.slice(0, numberOfKeys).map((key) => `${namespace}:${String(key)}`)
      return redis.eval(script, numberOfKeys, ...keys, ...args.slice(numberOfKeys))
    },
    async quotaBuckets() {
      const buckets = []
      for (const key of await scoped('hash')) {
        const fields = await redis.hgetall(key)
        buckets.push({
          key,
          binding: fields.binding ?? '',
          tokens: Number(fields.tokens),
        })
      }
      return buckets
    },
    async rebindBucket(index, binding) {
      const key = (await scoped('hash'))[index]
      if (!key) throw new Error(`no quota bucket at index ${index}`)
      await redis.hset(key, 'binding', binding)
    },
    async inFlightKeyCount() {
      return (await scoped('string')).length + (await scoped('zset')).length
    },
  }
  return handle
}
