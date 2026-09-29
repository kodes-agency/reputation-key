import { describe, expect, it } from 'vitest'
import type { GoogleQuotaPolicy } from './quota-coordinator'
import {
  GOOGLE_QUOTA_POLICIES,
  createRedisGoogleInFlightCoordinator,
  createRedisGoogleQuotaCoordinator,
} from './quota-coordinator'
import { createFakeGoogleCoordinationRedis } from '#/shared/testing/fake-google-coordination-redis'

const fingerprint = (character: string) => character.repeat(64)
const quotaKey = {
  credentialFingerprint: fingerprint('a'),
  projectFingerprint: fingerprint('b'),
  endpointClass: 'account-management' as const,
  organizationId: 'organization-1',
  initiatorUserId: 'user-1',
  connectionId: 'connection-1',
  propertyId: null,
}

const discoveryPolicy: GoogleQuotaPolicy = {
  requestClass: 'discovery',
  buckets: [
    {
      id: 'endpoint-second',
      scope: 'endpoint',
      capacity: 2,
      refillTokens: 60,
      refillIntervalMs: 60_000,
    },
  ],
  inFlightScope: 'endpoint',
  maxInFlight: 1,
  leaseMs: 1_000,
  maxWaitMs: 0,
}

describe('Redis Google provider coordination', () => {
  it('paces quota globally across coordinator instances sharing one Redis port', async () => {
    let nowMs = 1_000
    const redis = createFakeGoogleCoordinationRedis()
    const create = () =>
      createRedisGoogleQuotaCoordinator({
        redis,
        nowMs: () => nowMs,
        policyId: 'google-discovery-read-v1',
        policy: discoveryPolicy,
      })
    const firstReplica = create()
    const secondReplica = create()

    await expect(firstReplica.acquire(quotaKey, 2, 5_000)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(secondReplica.acquire(quotaKey, 1, 5_000)).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 1_000,
    })
    nowMs = 2_000
    await expect(secondReplica.acquire(quotaKey, 1, 5_000)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
  })

  it('acquires every policy bucket atomically and preserves global tokens on denial', async () => {
    const redis = createFakeGoogleCoordinationRedis()
    const policy: GoogleQuotaPolicy = {
      ...discoveryPolicy,
      buckets: [
        {
          id: 'endpoint-second',
          scope: 'endpoint',
          capacity: 10,
          refillTokens: 1,
          refillIntervalMs: 60_000,
        },
        {
          id: 'connection-minute',
          scope: 'connection',
          capacity: 1,
          refillTokens: 1,
          refillIntervalMs: 60_000,
        },
      ],
    }
    const quota = createRedisGoogleQuotaCoordinator({
      redis,
      nowMs: () => 1_000,
      policyId: 'atomic-test-v1',
      policy,
    })

    await expect(quota.acquire(quotaKey, 1, 10_000)).resolves.toMatchObject({
      ok: true,
    })
    await expect(quota.acquire(quotaKey, 1, 10_000)).resolves.toMatchObject({
      ok: false,
      code: 'deadline_exceeded',
    })
    const endpointBucket = [...redis.quotas.values()].find(({ binding }) =>
      binding.includes('endpoint'),
    )
    expect(endpointBucket?.tokens).toBe(9_000_000)
  })

  it('requires the tenant dimensions named by the frozen policy', async () => {
    const quota = createRedisGoogleQuotaCoordinator({
      redis: createFakeGoogleCoordinationRedis(),
      nowMs: () => 1_000,
      policyId: 'google-discovery-read-v1',
      policy: GOOGLE_QUOTA_POLICIES['google-discovery-read-v1'],
    })

    await expect(
      quota.acquire({ ...quotaKey, initiatorUserId: null }, 1, 10_000),
    ).resolves.toEqual({
      ok: false,
      code: 'invalid_request',
      retryAfterMs: 0,
    })
  })

  it('expires semaphore leases and allows another replica to proceed', async () => {
    let nowMs = 1_000
    let sequence = 0
    const redis = createFakeGoogleCoordinationRedis()
    const create = () =>
      createRedisGoogleInFlightCoordinator({
        redis,
        nowMs: () => nowMs,
        leaseId: () => `lease-id-${String(++sequence).padStart(8, '0')}`,
        policyId: 'google-discovery-read-v1',
        policy: discoveryPolicy,
      })
    const key = { ...quotaKey, requestClass: 'discovery' as const }
    const firstReplica = create()
    const secondReplica = create()
    const first = await firstReplica.acquire(key, 5_000)
    expect(first.ok).toBe(true)
    await expect(secondReplica.acquire(key, 5_000)).resolves.toEqual({
      ok: false,
      code: 'limit_exhausted',
      retryAfterMs: 1_000,
    })
    nowMs = 2_001
    const second = await secondReplica.acquire(key, 5_000)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('expected leases')
    await expect(firstReplica.release(key, first.lease)).resolves.toBe(false)
    await expect(secondReplica.release(key, second.lease)).resolves.toBe(true)
  })

  it('waits at most two seconds for an expiring provider semaphore lease', async () => {
    let nowMs = 1_000
    let sequence = 0
    const redis = createFakeGoogleCoordinationRedis()
    const policy = { ...discoveryPolicy, maxWaitMs: 2_000 }
    const create = () =>
      createRedisGoogleInFlightCoordinator({
        redis,
        nowMs: () => nowMs,
        leaseId: () => `lease-id-${String(++sequence).padStart(8, '0')}`,
        policyId: 'google-discovery-read-v1',
        policy,
        sleep: async (delayMs) => {
          nowMs += delayMs
        },
      })
    const key = { ...quotaKey, requestClass: 'discovery' as const }
    const first = await create().acquire(key, 5_000)
    const second = await create().acquire(key, 5_000)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(nowMs).toBe(2_000)
  })

  it('reserves cleanup quota independently from refresh quota', async () => {
    const redis = createFakeGoogleCoordinationRedis()
    const policy = {
      ...discoveryPolicy,
      buckets: [{ ...discoveryPolicy.buckets[0]!, capacity: 1 }],
    }
    const refresh = createRedisGoogleQuotaCoordinator({
      redis,
      nowMs: () => 1_000,
      policyId: 'google-credential-refresh-v1',
      policy: { ...policy, requestClass: 'credential_refresh' },
    })
    const cleanup = createRedisGoogleQuotaCoordinator({
      redis,
      nowMs: () => 1_000,
      policyId: 'google-credential-cleanup-v1',
      policy: { ...policy, requestClass: 'credential_cleanup' },
    })

    await expect(refresh.acquire(quotaKey, 1, 10_000)).resolves.toMatchObject({
      ok: true,
    })
    await expect(refresh.acquire(quotaKey, 1, 10_000)).resolves.toMatchObject({
      ok: false,
      code: 'quota_exhausted',
    })
    await expect(cleanup.acquire(quotaKey, 1, 10_000)).resolves.toMatchObject({
      ok: true,
    })
  })

  it('fails closed without exposing Redis errors', async () => {
    const redis = createFakeGoogleCoordinationRedis()
    redis.fail = true
    const quota = createRedisGoogleQuotaCoordinator({
      redis,
      nowMs: () => 1_000,
      policyId: 'google-discovery-read-v1',
      policy: discoveryPolicy,
    })
    await expect(quota.acquire(quotaKey, 1, 5_000)).resolves.toEqual({
      ok: false,
      code: 'coordination_unavailable',
      retryAfterMs: 0,
    })
  })
})
