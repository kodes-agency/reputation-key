import { randomUUID, createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import {
  createGoogleExecutionAdmissionService,
  type GoogleAdmissionPermitAuthority,
  type GoogleAdmissionPermitSnapshot,
} from './admission-service'
import { createGoogleEgressGateway } from './egress-gateway'
import {
  createRedisGoogleInFlightCoordinator,
  createRedisGoogleQuotaCoordinator,
  googleQuotaCredentialFingerprint,
  type GoogleCoordinationRedis,
  type GoogleQuotaPolicy,
} from './quota-coordinator'
import { compileGoogleProviderRequest } from './route-catalogue'

const NOW_MS = 1_000
const DEADLINE_MS = 11_000
const descriptor = {
  routeKey: 'account-management.accounts.list' as const,
  accessToken: 'access-token',
}
const bindCredential = (credential: string) =>
  createHmac('sha256', 'redis-admission-test-key').update(credential).digest('hex')
const admission = compileGoogleProviderRequest(descriptor, bindCredential).admission
const projectFingerprint = 'b'.repeat(64)
const credentialFingerprint = googleQuotaCredentialFingerprint(
  admission.credentialBinding,
  projectFingerprint,
)
if (!credentialFingerprint) throw new Error('test credential binding is invalid')
const quotaKey = {
  credentialFingerprint,
  projectFingerprint,
  endpointClass: admission.endpointClass,
  organizationId: 'redis-admission-organization',
  initiatorUserId: 'redis-admission-user',
  connectionId: 'redis-admission-connection',
  propertyId: null,
}
const inFlightKey = { ...quotaKey, requestClass: admission.requestClass }

const policy: GoogleQuotaPolicy = {
  requestClass: admission.requestClass,
  buckets: [
    {
      id: 'endpoint-minute',
      scope: 'endpoint',
      capacity: 1,
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
  inFlightScope: 'endpoint',
  maxInFlight: 1,
  leaseMs: 10_000,
  maxWaitMs: 0,
}

let firstLease: RedisTestLease | undefined
let secondLease: RedisTestLease | undefined
const touchedKeys = new Set<string>()

function tracked(redis: Redis): GoogleCoordinationRedis {
  return {
    eval: async (script, numberOfKeys, ...args) => {
      for (const key of args.slice(0, numberOfKeys)) {
        if (typeof key !== 'string') throw new Error('expected Redis key')
        touchedKeys.add(key)
      }
      return redis.eval(script, numberOfKeys, ...args)
    },
  }
}

function coordinators(redis: GoogleCoordinationRedis, policyId: string) {
  return {
    quota: createRedisGoogleQuotaCoordinator({
      redis,
      policyId,
      policy,
      nowMs: () => NOW_MS,
    }),
    inFlight: createRedisGoogleInFlightCoordinator({
      redis,
      policyId,
      policy,
      nowMs: () => NOW_MS,
      leaseId: randomUUID,
    }),
  }
}

function replicas() {
  if (!firstLease?.redis || !secondLease?.redis) return undefined
  const policyId = `redis-admission-${randomUUID()}`
  return [
    coordinators(tracked(firstLease.redis), policyId),
    coordinators(tracked(secondLease.redis), policyId),
  ] as const
}

function authority(start: GoogleAdmissionPermitAuthority['start']) {
  const permit: GoogleAdmissionPermitSnapshot = {
    permitId: randomUUID(),
    kind: 'work',
    routeKey: admission.routeKey,
    routeCatalogueVersion: admission.catalogueVersion,
    expectedAdmission: admission,
    quotaKey,
    expiresAtMs: DEADLINE_MS,
    authorityRevision: 'redis-admission-revision',
  }
  const complete = vi.fn<GoogleAdmissionPermitAuthority['complete']>(
    async () => undefined,
  )
  const store: GoogleAdmissionPermitAuthority = {
    load: async (permitId) => (permitId === permit.permitId ? permit : null),
    start,
    complete,
    failStarted: async () => undefined,
  }
  return { permit, store, complete }
}

beforeAll(async () => {
  firstLease = await acquireRedisTestLease()
  secondLease = await acquireRedisTestLease()
})

afterEach(async () => {
  if (firstLease?.redis && touchedKeys.size > 0) {
    await firstLease.redis.del(...touchedKeys)
  }
  touchedKeys.clear()
})

afterAll(() => {
  firstLease?.release()
  secondLease?.release()
})

describe('Redis Google admission across processes', () => {
  it('shares the in-flight ceiling and releases a slot for another replica', async () => {
    const pair = replicas()
    if (!pair) return
    const [first, second] = pair
    const acquired = await first.inFlight.acquire(inFlightKey, DEADLINE_MS)
    expect(acquired).toMatchObject({ ok: true })
    if (!acquired.ok) throw new Error('expected first in-flight slot')

    await expect(
      second.inFlight.acquire(inFlightKey, DEADLINE_MS),
    ).resolves.toMatchObject({
      ok: false,
      code: 'limit_exhausted',
    })
    await expect(first.inFlight.release(inFlightKey, acquired.lease)).resolves.toBe(true)
    const next = await second.inFlight.acquire(inFlightKey, DEADLINE_MS)
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('expected released slot on second replica')
    await expect(second.inFlight.release(inFlightKey, next.lease)).resolves.toBe(true)
  })

  it('shares quota buckets across replicas and refunds both scopes', async () => {
    const pair = replicas()
    if (!pair) return
    const [first, second] = pair
    const quotaDeadline = NOW_MS + 60_000

    await expect(first.quota.acquire(quotaKey, 1, quotaDeadline)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(second.quota.acquire(quotaKey, 1, quotaDeadline)).resolves.toMatchObject(
      {
        ok: false,
        code: 'quota_exhausted',
      },
    )
    await expect(first.quota.refund(quotaKey, 1)).resolves.toBe(true)
    // Each bucket has capacity one; either missed refund makes this fail.
    await expect(second.quota.acquire(quotaKey, 1, quotaDeadline)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(
      first.quota.acquire(
        { ...quotaKey, connectionId: 'another-connection' },
        1,
        quotaDeadline,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'quota_exhausted' })
  })

  it('refunds every quota bucket and the slot when the permit refuses start', async () => {
    const pair = replicas()
    if (!pair) return
    const [first, second] = pair
    const start = vi.fn<GoogleAdmissionPermitAuthority['start']>(async () => 'started')
    start.mockResolvedValueOnce('changed')
    const permitAuthority = authority(start)
    const service = (replica: typeof first) =>
      createGoogleExecutionAdmissionService({
        nowMs: () => NOW_MS,
        authority: permitAuthority.store,
        quotaForPolicy: () => replica.quota,
        inFlightForPolicy: () => replica.inFlight,
      })
    const input = {
      permitId: permitAuthority.permit.permitId,
      admission,
      deadlineMs: DEADLINE_MS,
    }

    await expect(service(first).start(input)).resolves.toEqual({
      ok: false,
      code: 'authorization_changed',
      retryAfterMs: 0,
    })
    // No time advances. A leaked slot or either spent quota bucket blocks this.
    const next = await service(second).start(input)
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('expected refunded admission on second replica')
    expect(start).toHaveBeenCalledTimes(2)
    await expect(
      next.handle.complete({ outcome: 'success', retryAfterMs: null }),
    ).resolves.toBe(true)
    expect(permitAuthority.complete).toHaveBeenCalledExactlyOnceWith(
      permitAuthority.permit.permitId,
      permitAuthority.permit.authorityRevision,
      'success',
      null,
    )
  })

  it('denies egress without fetching when its Redis connection is down', async () => {
    if (!firstLease?.redis) return
    const disconnected = firstLease.redis.duplicate({
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
    })
    disconnected.disconnect()
    const replica = coordinators(disconnected, `redis-down-${randomUUID()}`)
    const start = vi.fn<GoogleAdmissionPermitAuthority['start']>(async () => 'started')
    const permitAuthority = authority(start)
    const service = createGoogleExecutionAdmissionService({
      nowMs: () => NOW_MS,
      authority: permitAuthority.store,
      quotaForPolicy: () => replica.quota,
      inFlightForPolicy: () => replica.inFlight,
    })
    const fetchProvider = vi.fn<typeof fetch>(async () => new Response('{}'))
    const gateway = createGoogleEgressGateway({
      nowMs: () => NOW_MS,
      bindCredential,
      admission: service,
      fetch: fetchProvider,
    })

    await expect(
      gateway.execute({
        permitId: permitAuthority.permit.permitId,
        descriptor,
        deadlineMs: DEADLINE_MS,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'admission_denied',
      admissionCode: 'coordination_unavailable',
      dispatch: 'not_sent',
      retryAfterMs: 0,
    })
    expect(start).not.toHaveBeenCalled()
    expect(fetchProvider).not.toHaveBeenCalled()
  })
})
