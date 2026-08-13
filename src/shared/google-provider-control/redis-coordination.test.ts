import { describe, expect, it } from 'vitest'
import type { GoogleCoordinationRedis, GoogleQuotaPolicy } from './quota-coordinator'
import {
  GOOGLE_QUOTA_POLICIES,
  createRedisGoogleInFlightCoordinator,
  createRedisGoogleQuotaCoordinator,
} from './quota-coordinator'

class SharedFakeCoordinationRedis implements GoogleCoordinationRedis {
  readonly quotas = new Map<
    string,
    { binding: string; tokens: number; updatedAtMs: number }
  >()
  readonly bindings = new Map<string, string>()
  readonly leases = new Map<string, Map<string, number>>()
  fail = false

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    if (this.fail) throw new Error('redis unavailable')
    const keys = args.slice(0, numberOfKeys).map(String)
    const values = args.slice(numberOfKeys)
    if (script.startsWith('-- google-quota-v2')) {
      const nowMs = Number(values[0])
      const states: Array<{
        key: string
        binding: string
        tokens: number
        bucketCost: number
      }> = []
      let allowed = true
      let retryAfterMs = 0
      for (const [index, key] of keys.entries()) {
        const offset = 2 + index * 5
        const binding = String(values[offset])
        const capacity = Number(values[offset + 1])
        const refillPerMs = Number(values[offset + 2])
        const bucketCost = Number(values[offset + 4])
        const current = this.quotas.get(key) ?? {
          binding,
          tokens: capacity,
          updatedAtMs: nowMs,
        }
        if (current.binding !== binding) return [-2, 0]
        current.tokens = Math.min(
          capacity,
          current.tokens + Math.max(0, nowMs - current.updatedAtMs) * refillPerMs,
        )
        current.updatedAtMs = nowMs
        if (current.tokens < bucketCost) {
          allowed = false
          retryAfterMs = Math.max(
            retryAfterMs,
            Math.ceil((bucketCost - current.tokens) / refillPerMs),
          )
        }
        states.push({ key, binding, tokens: current.tokens, bucketCost })
      }
      let remaining = Number.POSITIVE_INFINITY
      for (const state of states) {
        if (allowed) state.tokens -= state.bucketCost
        this.quotas.set(state.key, {
          binding: state.binding,
          tokens: state.tokens,
          updatedAtMs: nowMs,
        })
        remaining = Math.min(remaining, state.tokens)
      }
      return allowed ? [1, Math.floor(remaining)] : [0, retryAfterMs]
    }
    if (script.startsWith('-- google-inflight-acquire-v1')) {
      const [binding, nowRaw, limitRaw, leaseMsRaw, leaseId] = values
      const bindingValue = String(binding)
      const currentBinding = this.bindings.get(keys[0]!)
      if (currentBinding && currentBinding !== bindingValue) return [-2, 0]
      const nowMs = Number(nowRaw)
      const limit = Number(limitRaw)
      const leaseMs = Number(leaseMsRaw)
      const current = this.leases.get(keys[1]!) ?? new Map<string, number>()
      for (const [id, expiry] of current) {
        if (expiry <= nowMs) current.delete(id)
      }
      if (current.size >= limit) {
        const oldest = Math.min(...current.values())
        return [0, Math.max(1, oldest - nowMs)]
      }
      this.bindings.set(keys[0]!, bindingValue)
      const expiresAtMs = nowMs + leaseMs
      current.set(String(leaseId), expiresAtMs)
      this.leases.set(keys[1]!, current)
      return [1, expiresAtMs]
    }
    if (script.startsWith('-- google-inflight-release-v1')) {
      const [binding, leaseId] = values
      if (this.bindings.get(keys[0]!) !== String(binding)) return -2
      return this.leases.get(keys[1]!)?.delete(String(leaseId)) ? 1 : 0
    }
    throw new Error('unexpected script')
  }
}

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
    const redis = new SharedFakeCoordinationRedis()
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
    const redis = new SharedFakeCoordinationRedis()
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
      redis: new SharedFakeCoordinationRedis(),
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
    const redis = new SharedFakeCoordinationRedis()
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
    const redis = new SharedFakeCoordinationRedis()
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
    const redis = new SharedFakeCoordinationRedis()
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
    const redis = new SharedFakeCoordinationRedis()
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
