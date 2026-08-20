import { describe, expect, it, vi } from 'vitest'
import {
  createRedisDistributedRefreshSingleFlight,
  createRedisGoogleRefreshBackoffCoordinator,
  type RefreshCoordinationRedis,
} from './refresh-single-flight'

class SharedRefreshRedis implements RefreshCoordinationRedis {
  readonly values = new Map<string, string>()
  readonly backoffs = new Map<
    string,
    { binding: string; failures: number; nextAllowedAtMs: number }
  >()
  fail = false
  onLockAcquired: (() => void) | undefined
  onLockContended: (() => void) | undefined

  async set(
    key: string,
    value: string,
    _expiryMode: 'PX',
    _expiryMs: number,
    _condition: 'NX',
  ): Promise<'OK' | null> {
    if (this.fail) throw new Error('redis unavailable')
    if (this.values.has(key)) {
      this.onLockContended?.()
      return null
    }
    this.values.set(key, value)
    this.onLockAcquired?.()
    return 'OK'
  }

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    if (this.fail) throw new Error('redis unavailable')
    const key = String(args[0])
    const binding = String(args[numberOfKeys])
    if (script.startsWith('-- google-refresh-lock-release-v1')) {
      const owner = binding
      if (this.values.get(key) !== owner) return 0
      this.values.delete(key)
      return 1
    }
    if (script.startsWith('-- google-refresh-backoff-check-v1')) {
      const nowMs = Number(args[numberOfKeys + 1])
      const record = this.backoffs.get(key)
      if (record && record.binding !== binding) return [-2, 0, 0]
      if (record && record.nextAllowedAtMs > nowMs) {
        return [0, record.nextAllowedAtMs - nowMs, record.failures]
      }
      return [1, 0, record?.failures ?? 0]
    }
    if (script.startsWith('-- google-refresh-backoff-fail-v1')) {
      const nowMs = Number(args[numberOfKeys + 1])
      const sample = Number(args[numberOfKeys + 2])
      const retryAfterMs = Number(args[numberOfKeys + 3])
      const current = this.backoffs.get(key)
      if (current && current.binding !== binding) return [-2, 0, 0]
      const failures = Math.min(31, (current?.failures ?? 0) + 1)
      const capMs = Math.min(300_000, 5_000 * 2 ** (failures - 1))
      const delayMs = Math.max(5_000, 1 + (sample % capMs), retryAfterMs)
      this.backoffs.set(key, {
        binding,
        failures,
        nextAllowedAtMs: nowMs + delayMs,
      })
      return [1, delayMs, failures]
    }
    if (script.startsWith('-- google-refresh-backoff-clear-v1')) {
      const current = this.backoffs.get(key)
      if (current && current.binding !== binding) return -2
      this.backoffs.delete(key)
      return 1
    }
    throw new Error('unexpected script')
  }
}

const connectionFingerprint = 'c'.repeat(64)

describe('distributed Google refresh single-flight', () => {
  it('coalesces refresh leadership across two replicas and returns committed state', async () => {
    const redis = new SharedRefreshRedis()
    let committed: string | null = null
    const blocked = Promise.withResolvers<void>()
    const leaderReady = Promise.withResolvers<void>()
    const followerPoll = Promise.withResolvers<void>()
    const followerWaiting = Promise.withResolvers<void>()
    redis.onLockAcquired = leaderReady.resolve
    redis.onLockContended = followerWaiting.resolve
    const refresh = vi.fn(async () => {
      await blocked.promise
      committed = 'token-v2'
      return committed
    })
    let ownerSequence = 0
    const create = (sleep: () => Promise<void>) =>
      createRedisDistributedRefreshSingleFlight({
        redis,
        nowMs: () => 1_000,
        sleep,
        ownerId: () => `refresh-owner-${String(++ownerSequence).padStart(8, '0')}`,
      })
    const input = {
      connectionFingerprint,
      deadlineMs: 5_000,
      loadLatest: async () => committed,
      refresh,
    }
    const first = create(async () => undefined).run(input)
    await leaderReady.promise
    redis.onLockAcquired = undefined
    const second = create(() => followerPoll.promise).run(input)
    await followerWaiting.promise
    blocked.resolve()
    await expect(first).resolves.toBe('token-v2')
    followerPoll.resolve()
    await expect(second).resolves.toBe('token-v2')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('rechecks committed state after winning a released refresh lock', async () => {
    const redis = new SharedRefreshRedis()
    let committed: string | null = null
    let loadCount = 0
    const refresh = vi.fn(async () => 'should-not-run')
    const singleFlight = createRedisDistributedRefreshSingleFlight({
      redis,
      nowMs: () => 1_000,
      sleep: async () => undefined,
      ownerId: () => 'refresh-owner-00000001',
    })

    await expect(
      singleFlight.run({
        connectionFingerprint,
        deadlineMs: 2_000,
        loadLatest: async () => {
          loadCount += 1
          if (loadCount === 2) committed = 'token-v2'
          return committed
        },
        refresh,
      }),
    ).resolves.toBe('token-v2')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('shares 5–300 second refresh backoff across replicas and clears it on success', async () => {
    const redis = new SharedRefreshRedis()
    let nowMs = 10_000
    const create = () =>
      createRedisGoogleRefreshBackoffCoordinator({
        redis,
        nowMs: () => nowMs,
        jitterSample: () => 1_234,
      })
    const leader = create()
    const follower = create()

    await expect(leader.check(connectionFingerprint)).resolves.toEqual({
      ok: true,
      consecutiveFailures: 0,
    })
    await expect(leader.fail(connectionFingerprint, null)).resolves.toEqual({
      ok: false,
      code: 'backoff_active',
      retryAfterMs: 5_000,
    })
    await expect(follower.check(connectionFingerprint)).resolves.toEqual({
      ok: false,
      code: 'backoff_active',
      retryAfterMs: 5_000,
    })
    nowMs += 5_000
    await expect(follower.fail(connectionFingerprint, 8_000)).resolves.toEqual({
      ok: false,
      code: 'backoff_active',
      retryAfterMs: 8_000,
    })
    await expect(leader.succeed(connectionFingerprint)).resolves.toBe(true)
    await expect(follower.check(connectionFingerprint)).resolves.toEqual({
      ok: true,
      consecutiveFailures: 0,
    })
  })

  it('caps refresh backoff and detects digest-key binding collisions', async () => {
    const redis = new SharedRefreshRedis()
    const coordinator = createRedisGoogleRefreshBackoffCoordinator({
      redis,
      nowMs: () => 10_000,
      jitterSample: () => 299_999,
    })
    let result
    for (let failure = 1; failure <= 7; failure += 1) {
      result = await coordinator.fail(connectionFingerprint, null)
    }
    expect(result).toEqual({
      ok: false,
      code: 'backoff_active',
      retryAfterMs: 300_000,
    })
    const record = [...redis.backoffs.values()][0]
    if (!record) throw new Error('expected shared backoff record')
    record.binding = 'd'.repeat(64)
    await expect(coordinator.check(connectionFingerprint)).resolves.toEqual({
      ok: false,
      code: 'key_collision',
      retryAfterMs: 0,
    })
    await expect(coordinator.fail(connectionFingerprint, null)).resolves.toEqual({
      ok: false,
      code: 'key_collision',
      retryAfterMs: 0,
    })
  })

  it('fails closed with a code-only coordination error', async () => {
    const redis = new SharedRefreshRedis()
    redis.fail = true
    const singleFlight = createRedisDistributedRefreshSingleFlight({
      redis,
      nowMs: () => 1_000,
      sleep: async () => undefined,
      ownerId: () => 'refresh-owner-00000001',
    })
    await expect(
      singleFlight.run({
        connectionFingerprint,
        deadlineMs: 2_000,
        loadLatest: async () => null,
        refresh: async () => 'unreachable',
      }),
    ).rejects.toThrow('refresh coordination unavailable')
    const backoff = createRedisGoogleRefreshBackoffCoordinator({
      redis,
      nowMs: () => 1_000,
      jitterSample: () => 0,
    })
    await expect(backoff.check(connectionFingerprint)).resolves.toEqual({
      ok: false,
      code: 'coordination_unavailable',
      retryAfterMs: 0,
    })
  })
})
