import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'
import {
  GUEST_OBSERVATION_LOSS_BUCKET_MS,
  GUEST_OBSERVATION_LOSS_RETENTION_MS,
  createGuestObservationLossMonitor,
} from './guest-observation-loss-monitor'

describe('Guest observation-loss monitor across replicas', () => {
  let lease: RedisTestLease

  beforeAll(async () => {
    lease = await acquireRedisTestLease()
  })

  afterAll(() => {
    lease.release()
  })

  it('shares content-free bounded counters across independent clients and restarts', async () => {
    if (!lease.available) return
    const now = new Date()
    const prefix = `test:guest-observation-loss:${randomUUID()}`
    const secondConnection = (lease.redis as Redis).duplicate({ lazyConnect: true })
    await secondConnection.connect()
    const first = createGuestObservationLossMonitor(lease.redis, {
      testKeyPrefix: prefix,
    })
    const second = createGuestObservationLossMonitor(secondConnection, {
      testKeyPrefix: prefix,
    })

    try {
      await Promise.all([
        first.record({ kind: 'scan', occurredAt: now }),
        second.record({ kind: 'scan', occurredAt: now }),
        first.record({ kind: 'review_link', occurredAt: now }),
      ])

      // A newly constructed adapter has no process-local state: this read is
      // the replica/restart proof.
      const afterRestart = createGuestObservationLossMonitor(secondConnection, {
        testKeyPrefix: prefix,
      })
      await expect(afterRestart.read(now)).resolves.toMatchObject({
        monitorAvailable: false,
        totalLossCount: 0,
        ratingDisposition: 'not_applicable_durable',
      })

      // Once this Redis generation spans a complete retained window, a
      // newly constructed adapter can make a complete cross-replica claim.
      await expect(
        afterRestart.read(new Date(now.getTime() + GUEST_OBSERVATION_LOSS_RETENTION_MS)),
      ).resolves.toEqual({
        monitorAvailable: true,
        windowMs: GUEST_OBSERVATION_LOSS_RETENTION_MS,
        precisionMs: GUEST_OBSERVATION_LOSS_BUCKET_MS,
        scanLossCount: 2,
        reviewLinkLossCount: 1,
        ratingLossCount: 0,
        totalLossCount: 3,
        ratingDisposition: 'not_applicable_durable',
      })

      const keys = await secondConnection.keys(`${prefix}:*`)
      expect(keys).toEqual([`${prefix}:aggregate`])
      const fields = await secondConnection.hkeys(`${prefix}:aggregate`)
      expect(fields).toContain('continuity')
      expect(fields.filter((field) => /^review_link:\d+$/u.test(field))).toHaveLength(1)
      expect(fields.filter((field) => /^scan:\d+$/u.test(field))).toHaveLength(1)
      for (const key of keys) {
        const ttl = await secondConnection.pttl(key)
        expect(ttl).toBeGreaterThan(0)
        expect(ttl).toBeLessThanOrEqual(
          GUEST_OBSERVATION_LOSS_RETENTION_MS + GUEST_OBSERVATION_LOSS_BUCKET_MS,
        )
      }
    } finally {
      const keys = await secondConnection.keys(`${prefix}:*`)
      if (keys.length > 0) await secondConnection.del(...keys)
      secondConnection.disconnect()
    }
  })

  it('is explicitly unavailable without a monitor store and never invents zero evidence', async () => {
    const monitor = createGuestObservationLossMonitor(undefined)
    const now = new Date()

    await expect(monitor.read(now)).resolves.toEqual({
      monitorAvailable: false,
      windowMs: GUEST_OBSERVATION_LOSS_RETENTION_MS,
      precisionMs: GUEST_OBSERVATION_LOSS_BUCKET_MS,
      scanLossCount: 0,
      reviewLinkLossCount: 0,
      ratingLossCount: 0,
      totalLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    })
    await expect(monitor.record({ kind: 'scan', occurredAt: now })).rejects.toThrow(
      'guest_observation_loss_monitor_unavailable',
    )
    await expect(
      monitor.record({ kind: 'rating' as never, occurredAt: now }),
    ).rejects.toThrow('guest_observation_loss_kind_not_supported')
  })
})
