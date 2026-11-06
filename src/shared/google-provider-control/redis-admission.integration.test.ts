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
  createGoogleCoordinationLookup,
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

function coordinators(
  redis: GoogleCoordinationRedis,
  policyId: string,
  nowMs = () => NOW_MS,
) {
  return {
    quota: createRedisGoogleQuotaCoordinator({
      redis,
      policyId,
      policy,
      nowMs,
    }),
    inFlight: createRedisGoogleInFlightCoordinator({
      redis,
      policyId,
      policy,
      nowMs,
      leaseId: randomUUID,
    }),
  }
}

function replicas(nowMs = () => NOW_MS) {
  if (!firstLease?.redis || !secondLease?.redis) return undefined
  const policyId = `redis-admission-${randomUUID()}`
  return [
    coordinators(tracked(firstLease.redis), policyId, nowMs),
    coordinators(tracked(secondLease.redis), policyId, nowMs),
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

  it('shares quota buckets across replicas and refills only with elapsed time', async () => {
    let nowMs = NOW_MS
    const pair = replicas(() => nowMs)
    if (!pair) return
    const [first, second] = pair
    const quotaDeadline = () => nowMs + 60_000

    await expect(first.quota.acquire(quotaKey, 1, quotaDeadline())).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(second.quota.acquire(quotaKey, 1, quotaDeadline())).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 60_000,
    })
    nowMs += 60_000
    await expect(second.quota.acquire(quotaKey, 1, quotaDeadline())).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(
      first.quota.acquire(
        { ...quotaKey, connectionId: 'another-connection' },
        1,
        quotaDeadline(),
      ),
    ).resolves.toMatchObject({ ok: false, code: 'quota_exhausted' })
  })

  it('keeps quota spent when Redis replays an executed acquisition after losing its reply', async () => {
    if (!firstLease?.redis) return
    const redis = tracked(firstLease.redis)
    let replay = true
    const quota = createRedisGoogleQuotaCoordinator({
      redis: {
        eval: async (script, numberOfKeys, ...args) => {
          const reply = await redis.eval(script, numberOfKeys, ...args)
          if (replay) {
            replay = false
            return redis.eval(script, numberOfKeys, ...args)
          }
          return reply
        },
      },
      nowMs: () => NOW_MS,
      policyId: `acquire-replay-${randomUUID()}`,
      policy: {
        ...policy,
        buckets: policy.buckets.map((bucket) => ({ ...bucket, capacity: 3 })),
      },
    })
    await expect(quota.acquire(quotaKey, 1, DEADLINE_MS)).resolves.toEqual({
      ok: true,
      remaining: 1,
    })
    await expect(quota.acquire(quotaKey, 1, DEADLINE_MS)).resolves.toEqual({
      ok: true,
      remaining: 0,
    })
    await expect(quota.acquire(quotaKey, 1, DEADLINE_MS)).resolves.toMatchObject({
      ok: false,
    })
  })

  it('admits only one replica when both acquire the last token concurrently', async () => {
    if (!firstLease?.redis || !secondLease?.redis) return
    const policyId = `concurrent-quota-${randomUUID()}`
    const quotaFor = (redis: Redis) =>
      createRedisGoogleQuotaCoordinator({
        redis: tracked(redis),
        nowMs: () => NOW_MS,
        policyId,
        policy: {
          ...policy,
          buckets: policy.buckets.map((bucket) => ({ ...bucket, capacity: 3 })),
        },
      })
    const first = quotaFor(firstLease.redis)
    const second = quotaFor(secondLease.redis)
    await expect(first.acquire(quotaKey, 2, DEADLINE_MS)).resolves.toEqual({
      ok: true,
      remaining: 1,
    })
    const results = await Promise.all([
      first.acquire(quotaKey, 1, DEADLINE_MS),
      second.acquire(quotaKey, 1, DEADLINE_MS),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    await expect(first.acquire(quotaKey, 1, DEADLINE_MS)).resolves.toMatchObject({
      ok: false,
    })
    await expect(second.acquire(quotaKey, 1, DEADLINE_MS)).resolves.toMatchObject({
      ok: false,
    })
  })

  it('releases the slot but keeps every quota bucket spent when the permit refuses start', async () => {
    let nowMs = NOW_MS
    const pair = replicas(() => nowMs)
    if (!pair) return
    const [first, second] = pair
    const start = vi.fn<GoogleAdmissionPermitAuthority['start']>(async () => 'started')
    start.mockResolvedValueOnce('changed')
    const permitAuthority = authority(start)
    const service = (replica: typeof first) =>
      createGoogleExecutionAdmissionService({
        nowMs: () => nowMs,
        authority: {
          ...permitAuthority.store,
          load: async (id) => {
            const permit = await permitAuthority.store.load(id)
            return permit ? { ...permit, expiresAtMs: 200_000 } : null
          },
        },
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
    const slot = await second.inFlight.acquire(inFlightKey, DEADLINE_MS)
    expect(slot.ok).toBe(true)
    if (!slot.ok) throw new Error('expected released in-flight slot')
    await expect(second.inFlight.release(inFlightKey, slot.lease)).resolves.toBe(true)
    await expect(service(second).start(input)).resolves.toEqual({
      ok: false,
      code: 'quota_exhausted',
      retryAfterMs: 60_000,
    })
    expect(start).toHaveBeenCalledTimes(1)

    nowMs += 60_000
    const next = await service(second).start({ ...input, deadlineMs: nowMs + 10_000 })
    expect(next.ok).toBe(true)
    if (!next.ok) throw new Error('expected admission after refill')
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

  it('does not allow a fifth discovery call after refill, intervening consumption and delayed refusal', async () => {
    if (!firstLease?.redis || !secondLease?.redis) return
    let nowMs = NOW_MS
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const permitAuthority = authority(async (permit) => {
      if (permit.permitId !== 'stalled-permit') return 'started'
      entered.resolve()
      await resume.promise
      return 'changed'
    })
    const fetchProvider = vi.fn<typeof fetch>(async () => new Response('{}'))
    // Isolate the production policy's fixed keys from other suites using this Redis.
    const replica = (redis: Redis) => {
      const redisPort = tracked(redis)
      const coordination = createGoogleCoordinationLookup({
        redis: {
          eval: (script, numberOfKeys, ...args) =>
            redisPort.eval(
              script,
              numberOfKeys,
              ...args.map((arg, index) =>
                index < numberOfKeys
                  ? `burst-${permitAuthority.permit.permitId}:${arg}`
                  : arg,
              ),
            ),
        },
        nowMs: () => nowMs,
        leaseId: randomUUID,
      })
      const service = createGoogleExecutionAdmissionService({
        nowMs: () => nowMs,
        authority: {
          ...permitAuthority.store,
          load: async (permitId) => ({
            ...permitAuthority.permit,
            permitId,
          }),
        },
        ...coordination,
      })
      return createGoogleEgressGateway({
        nowMs: () => nowMs,
        bindCredential,
        admission: service,
        fetch: fetchProvider,
      })
    }
    const first = replica(firstLease.redis)
    const second = replica(secondLease.redis)
    const execute = (permitId: string) =>
      second.execute({ permitId, descriptor, deadlineMs: DEADLINE_MS })
    const stalled = first.execute({
      permitId: 'stalled-permit',
      descriptor,
      deadlineMs: DEADLINE_MS,
    })
    await entered.promise
    nowMs += 1_000
    for (let index = 0; index < 4; index++) {
      await expect(execute(`burst-permit-${index}`)).resolves.toMatchObject({ ok: true })
    }
    resume.resolve()
    await expect(stalled).resolves.toMatchObject({
      ok: false,
      admissionCode: 'authorization_changed',
      dispatch: 'not_sent',
    })
    await expect(execute('fifth-permit')).resolves.toMatchObject({
      ok: false,
      admissionCode: 'quota_exhausted',
      dispatch: 'not_sent',
      retryAfterMs: 250,
    })
    expect(fetchProvider).toHaveBeenCalledTimes(4)
    nowMs += 250
    await expect(execute('refilled-permit')).resolves.toMatchObject({ ok: true })
    expect(fetchProvider).toHaveBeenCalledTimes(5)
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
