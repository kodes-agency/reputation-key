import { describe, expect, it } from 'vitest'
import {
  GUEST_OBSERVATION_LOSS_BUCKET_MS,
  GUEST_OBSERVATION_LOSS_RETENTION_MS,
  createGuestObservationLossMonitor,
  type GuestObservationLossRedisPort,
} from './guest-observation-loss-monitor'

const NOW = new Date('2026-08-27T12:02:00.000Z')

function memoryRedis() {
  const fields = new Map<string, string>()
  const expiries = new Map<string, number>()
  const scripts: string[] = []
  const redis: GuestObservationLossRedisPort = {
    async eval(script, numberOfKeys, ...args) {
      scripts.push(script)
      expect(numberOfKeys).toBe(1)
      const aggregateKey = String(args[0])
      const isRecord = script.includes('HINCRBY')
      const observedAt = Number(args[2])
      const ttl = Number(args[3])
      const cutoff = Number(args[4])
      if (!fields.has('continuity')) fields.set('continuity', String(observedAt))
      for (const field of [...fields.keys()]) {
        const start = Number(field.split(':')[1])
        if (Number.isSafeInteger(start) && start < cutoff) fields.delete(field)
      }
      expiries.set(aggregateKey, ttl)
      if (isRecord) {
        const field = String(args[1])
        const count = Number(fields.get(field) ?? '0') + 1
        fields.set(field, String(count))
        return count
      }
      return [...fields.entries()].flat()
    },
  }
  return { redis, fields, expiries, scripts }
}

describe('createGuestObservationLossMonitor', () => {
  it('stays degraded until a complete post-reset window is observable', async () => {
    const memory = memoryRedis()
    const firstReplica = createGuestObservationLossMonitor(memory.redis)
    const secondReplica = createGuestObservationLossMonitor(memory.redis)

    const windowStart = new Date(NOW.getTime() - GUEST_OBSERVATION_LOSS_RETENTION_MS)
    await expect(firstReplica.read(windowStart)).resolves.toMatchObject({
      monitorAvailable: false,
      totalLossCount: 0,
    })

    await firstReplica.record({ kind: 'scan', occurredAt: NOW })
    await secondReplica.record({ kind: 'review_link', occurredAt: NOW })

    const keys = [...memory.expiries.keys()].sort()
    const start =
      Math.floor(NOW.getTime() / GUEST_OBSERVATION_LOSS_BUCKET_MS) *
      GUEST_OBSERVATION_LOSS_BUCKET_MS
    expect(keys).toEqual(['ops:guest-observation-loss:v1:aggregate'])
    expect(memory.scripts.some((script) => script.includes('HINCRBY'))).toBe(true)
    expect([...memory.fields.entries()].sort()).toEqual(
      [
        ['continuity', String(windowStart.getTime())],
        [`scan:${start}`, '1'],
        [`review_link:${start}`, '1'],
      ].sort(),
    )
    expect(memory.expiries.get('ops:guest-observation-loss:v1:aggregate')).toBe(
      GUEST_OBSERVATION_LOSS_RETENTION_MS + GUEST_OBSERVATION_LOSS_BUCKET_MS,
    )

    await expect(
      createGuestObservationLossMonitor(memory.redis).read(NOW),
    ).resolves.toMatchObject({
      monitorAvailable: true,
      scanLossCount: 1,
      reviewLinkLossCount: 1,
      ratingLossCount: 0,
      totalLossCount: 2,
      ratingDisposition: 'not_applicable_durable',
    })
  })

  it('does not report an empty Redis generation as a healthy zero-loss window', async () => {
    const monitor = createGuestObservationLossMonitor(memoryRedis().redis)

    await expect(monitor.read(NOW)).resolves.toMatchObject({
      monitorAvailable: false,
      totalLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    })
  })

  it('returns an explicitly unavailable aggregate when the shared read fails', async () => {
    const monitor = createGuestObservationLossMonitor({
      eval: async () => {
        throw new Error('redis down')
      },
    })

    await expect(monitor.read(NOW)).resolves.toMatchObject({
      monitorAvailable: false,
      scanLossCount: 0,
      reviewLinkLossCount: 0,
      ratingLossCount: 0,
      totalLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    })
  })

  it('fails visible rather than turning corrupted aggregate evidence into zero', async () => {
    const monitor = createGuestObservationLossMonitor({
      eval: async () => [
        'continuity',
        String(NOW.getTime() - GUEST_OBSERVATION_LOSS_RETENTION_MS),
        `scan:${NOW.getTime()}`,
        'invalid',
      ],
    })

    await expect(monitor.read(NOW)).resolves.toMatchObject({
      monitorAvailable: false,
      totalLossCount: 0,
    })
  })

  it('rejects rating as a loss class at runtime', async () => {
    const memory = memoryRedis()
    const monitor = createGuestObservationLossMonitor(memory.redis)

    await expect(
      monitor.record({ kind: 'rating' as never, occurredAt: NOW }),
    ).rejects.toThrow('guest_observation_loss_kind_not_supported')
    expect(memory.fields.size).toBe(0)
  })
})
