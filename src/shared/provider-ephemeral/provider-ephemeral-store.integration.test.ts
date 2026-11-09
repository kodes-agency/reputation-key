// The Redis store against a real Redis, through the contract the in-memory
// fake also passes (provider-ephemeral-store.test.ts).

import { afterAll } from 'vitest'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createRedisProviderEphemeralStore } from './provider-ephemeral-store'
import { describeProviderEphemeralStoreContract } from './provider-ephemeral-store.test-contract'

let lease: RedisTestLease | undefined

afterAll(() => {
  lease?.release()
})

describeProviderEphemeralStoreContract('Redis', async () => {
  lease ??= await acquireRedisTestLease()
  if (!lease.available || !lease.redis) return undefined
  return {
    store: createRedisProviderEphemeralStore(lease.redis),
    advance: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
})
