import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import { organizationId, googleConnectionId } from '#/shared/domain/ids'
import { createVersionedHmacKeyring } from '#/shared/security/versioned-hmac-keyring'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import { createRedisGoogleRefreshCoordination } from './google-refresh-coordination.adapter'

const keys = createVersionedHmacKeyring(`test:${'a'.repeat(64)}`)

describe('Google credential refresh coordination on real Redis', () => {
  let lease: RedisTestLease

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
  })

  afterAll(() => {
    lease.release()
  })

  it('renews leadership across the lease window and returns the committed generation to another replica', async () => {
    if (!lease.available || !lease.redis) return
    const secondRedis = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondRedis.connect()
    try {
      const orgId = organizationId(`org-refresh-${randomUUID()}`)
      const connectionId = googleConnectionId(randomUUID())
      let committed: string | null = null
      const leaderEntered = Promise.withResolvers<void>()
      const releaseProvider = Promise.withResolvers<void>()
      const providerRefresh = vi.fn(async (assertLeadership: () => Promise<void>) => {
        leaderEntered.resolve()
        await releaseProvider.promise
        await assertLeadership()
        committed = 'credential-generation-2'
        return committed
      })
      const build = (redis: Redis) =>
        createRedisGoogleRefreshCoordination({
          redis,
          connectionKeys: keys,
          nowMs: Date.now,
          sleep: (durationMs) =>
            new Promise<void>((resolve) => setTimeout(resolve, durationMs)),
          ownerId: randomUUID,
          jitterSample: () => 0,
          leaseMs: 1_000,
          pollMs: 10,
        })
      const input = {
        organizationId: orgId,
        connectionId,
        expectedCredentialGeneration: 1,
        deadlineMs: Date.now() + 5_000,
        loadLatest: async () => committed,
        refresh: providerRefresh,
      }

      const leader = build(lease.redis as Redis).run(input)
      await leaderEntered.promise
      // Wait beyond the original one-second lease. Without renewal the second
      // replica would become a second provider leader here.
      await new Promise((resolve) => setTimeout(resolve, 1_200))
      const follower = build(secondRedis).run(input)
      releaseProvider.resolve()

      await expect(Promise.all([leader, follower])).resolves.toEqual([
        { ok: true, value: 'credential-generation-2' },
        { ok: true, value: 'credential-generation-2' },
      ])
      expect(providerRefresh).toHaveBeenCalledOnce()
    } finally {
      secondRedis.disconnect()
    }
  })

  it('persists provider-failure backoff for another replica with the real Lua script', async () => {
    if (!lease.available || !lease.redis) return
    const secondRedis = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondRedis.connect()
    try {
      const orgId = organizationId(`org-refresh-${randomUUID()}`)
      const connectionId = googleConnectionId(randomUUID())
      const build = (redis: Redis) =>
        createRedisGoogleRefreshCoordination({
          redis,
          connectionKeys: keys,
          nowMs: Date.now,
          sleep: (durationMs) =>
            new Promise<void>((resolve) => setTimeout(resolve, durationMs)),
          ownerId: randomUUID,
          jitterSample: () => 0,
          leaseMs: 1_000,
          pollMs: 10,
        })
      const providerFailure = new Error('provider refresh failed')
      const base = {
        organizationId: orgId,
        connectionId,
        expectedCredentialGeneration: 1,
        deadlineMs: Date.now() + 5_000,
        loadLatest: async () => null,
      }

      await expect(
        build(lease.redis as Redis).run({
          ...base,
          refresh: async () => Promise.reject(providerFailure),
        }),
      ).rejects.toBe(providerFailure)
      await expect(
        build(secondRedis).run({
          ...base,
          deadlineMs: Date.now() + 5_000,
          refresh: async () => 'must-not-run',
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'backoff_active',
        retryAfterMs: expect.any(Number),
      })
    } finally {
      secondRedis.disconnect()
    }
  })

  it('rechecks shared backoff after a waiting follower becomes leader', async () => {
    if (!lease.available || !lease.redis) return
    const secondRedis = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondRedis.connect()
    try {
      const orgId = organizationId(`org-refresh-${randomUUID()}`)
      const connectionId = googleConnectionId(randomUUID())
      const leaderEntered = Promise.withResolvers<void>()
      const releaseProvider = Promise.withResolvers<void>()
      const providerFailure = new Error('provider refresh failed')
      const providerRefresh = vi.fn(async () => {
        leaderEntered.resolve()
        await releaseProvider.promise
        throw providerFailure
      })
      const build = (redis: Redis) =>
        createRedisGoogleRefreshCoordination({
          redis,
          connectionKeys: keys,
          nowMs: Date.now,
          sleep: (durationMs) =>
            new Promise<void>((resolve) => setTimeout(resolve, durationMs)),
          ownerId: randomUUID,
          jitterSample: () => 0,
          leaseMs: 1_000,
          pollMs: 10,
        })
      const input = {
        organizationId: orgId,
        connectionId,
        expectedCredentialGeneration: 1,
        deadlineMs: Date.now() + 5_000,
        loadLatest: async () => null,
        refresh: providerRefresh,
      }

      const leader = build(lease.redis as Redis).run(input)
      const leaderAssertion = expect(leader).rejects.toBe(providerFailure)
      await leaderEntered.promise
      const follower = build(secondRedis).run(input)
      releaseProvider.resolve()

      await leaderAssertion
      await expect(follower).resolves.toMatchObject({
        ok: false,
        code: 'backoff_active',
      })
      expect(providerRefresh).toHaveBeenCalledOnce()
    } finally {
      secondRedis.disconnect()
    }
  })
})
