// A Redis connection for one server-function test file: every key it writes
// carries the file's own prefix, so its rate-limit counters never meet another
// file's on the shared local Redis, and clearing them touches nothing else.

import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import { acquireRedisTestLease } from './redis-test-lease'

export type HarnessRedis = Readonly<{
  /** The prefixed client, or undefined when no local Redis answered. */
  client: Redis | undefined
  /** Delete every key this file wrote. */
  clear: () => Promise<void>
  release: () => void
}>

export async function acquireHarnessRedis(): Promise<HarnessRedis> {
  const lease = await acquireRedisTestLease()
  const base = lease.redis
  if (!base) return { client: undefined, clear: async () => {}, release: lease.release }
  const prefix = `harness:${randomUUID()}:`
  const client = base.duplicate({ keyPrefix: prefix })
  client.on('error', () => {})
  return {
    client,
    clear: async () => {
      let cursor = '0'
      do {
        const [next, keys] = await base.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200)
        cursor = next
        if (keys.length > 0) await base.del(...keys)
      } while (cursor !== '0')
    },
    release: () => {
      client.disconnect()
      lease.release()
    },
  }
}
