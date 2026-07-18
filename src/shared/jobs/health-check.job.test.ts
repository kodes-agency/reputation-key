// Tests for health-check background job
import { describe, it, expect, vi } from 'vitest'
import {
  createHealthCheckHandler,
  OLDEST_UNPUBLISHED_WARN_MS,
  OLDEST_QUARANTINED_WARN_MS,
  type HealthCheckDeps,
} from './health-check.job'
import pino from 'pino'

function createMockDeps(
  overrides: { dbHealthy?: boolean; redisHealthy?: boolean } = {},
): HealthCheckDeps {
  return {
    dbHealthy: vi.fn(async () => overrides.dbHealthy ?? true),
    redisHealthy: vi.fn(async () => overrides.redisHealthy ?? true),
    logger: pino({ level: 'silent' }),
    clock: () => new Date(),
  }
}

function createThrowingDeps(throwDb: boolean, throwRedis: boolean): HealthCheckDeps {
  return {
    dbHealthy: throwDb
      ? vi.fn(async () => {
          throw new Error('connection refused')
        })
      : vi.fn(async () => true),
    redisHealthy: throwRedis
      ? vi.fn(async () => {
          throw new Error('connection refused')
        })
      : vi.fn(async () => true),
    logger: pino({ level: 'silent' }),
    clock: () => new Date(),
  }
}

describe('createHealthCheckHandler', () => {
  it('returns healthy when both DB and Redis are healthy', async () => {
    const deps = createMockDeps({ dbHealthy: true, redisHealthy: true })
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(true)
    expect(result.redis).toBe(true)
    expect(result.timestamp).toBeTruthy()
  })

  it('reports DB unhealthy correctly', async () => {
    const deps = createMockDeps({ dbHealthy: false, redisHealthy: true })
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(false)
    expect(result.redis).toBe(true)
  })

  it('reports Redis unhealthy correctly', async () => {
    const deps = createMockDeps({ dbHealthy: true, redisHealthy: false })
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(true)
    expect(result.redis).toBe(false)
  })

  it('reports both unhealthy correctly', async () => {
    const deps = createMockDeps({ dbHealthy: false, redisHealthy: false })
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(false)
    expect(result.redis).toBe(false)
  })

  it('handles DB check throwing an error', async () => {
    const deps = createThrowingDeps(true, false)
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(false)
  })

  it('handles Redis check throwing an error', async () => {
    const deps = createThrowingDeps(false, true)
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.redis).toBe(false)
  })

  it('is idempotent — running twice produces same result', async () => {
    const deps = createMockDeps({ dbHealthy: true, redisHealthy: true })
    const handler = createHealthCheckHandler(deps)
    const result1 = await handler({ id: '1', data: {} } as never)
    const result2 = await handler({ id: '2', data: {} } as never)

    expect(result1.db).toBe(result2.db)
    expect(result1.redis).toBe(result2.redis)
  })

  it('records worker heartbeat when provided (BQR-6.2)', async () => {
    const recordHeartbeat = vi.fn().mockResolvedValue(undefined)
    const deps = { ...createMockDeps(), recordHeartbeat }
    const handler = createHealthCheckHandler(deps)
    await handler({ id: '1', data: {} } as never)
    expect(recordHeartbeat).toHaveBeenCalledOnce()
  })

  it('continues when heartbeat write fails', async () => {
    const recordHeartbeat = vi.fn().mockRejectedValue(new Error('redis down'))
    const deps = { ...createMockDeps(), recordHeartbeat }
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)
    expect(result.db).toBe(true)
    expect(result.redis).toBe(true)
  })
})

describe('health-check ops thresholds (BQC-3.7)', () => {
  it('declares the alert thresholds as named constants', () => {
    // Relay polls every 5s — 15min unpublished means relay down or backlog.
    expect(OLDEST_UNPUBLISHED_WARN_MS).toBe(15 * 60 * 1000)
    // Operator redrive SLA for the dead-letter quarantine.
    expect(OLDEST_QUARANTINED_WARN_MS).toBe(24 * 60 * 60 * 1000)
  })

  function depsWithSample(sample: {
    oldestUnpublishedAgeMs: number | null
    stalledLeaseCount: number
    quarantineCount: number
    oldestQuarantinedAgeMs: number | null
  }) {
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    const deps: HealthCheckDeps = {
      ...createMockDeps(),
      logger,
      sampleOpsMetrics: vi.fn(async () => sample),
    }
    return { deps, warn }
  }

  it('warns when every threshold is breached', async () => {
    const { deps, warn } = depsWithSample({
      oldestUnpublishedAgeMs: 16 * 60 * 1000,
      stalledLeaseCount: 2,
      quarantineCount: 1,
      oldestQuarantinedAgeMs: 25 * 60 * 60 * 1000,
    })
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    const metrics = warn.mock.calls.map((c) => (c[0] as { metric?: string }).metric)
    expect(metrics).toEqual(
      expect.arrayContaining([
        'oldestUnpublishedAgeMs',
        'stalledLeaseCount',
        'quarantineCount',
        'oldestQuarantinedAgeMs',
      ]),
    )
    expect(result.opsMetrics).toBeDefined()
  })

  it('stays quiet when all metrics are under threshold', async () => {
    const { deps, warn } = depsWithSample({
      oldestUnpublishedAgeMs: 60 * 1000,
      stalledLeaseCount: 0,
      quarantineCount: 0,
      oldestQuarantinedAgeMs: null,
    })
    const handler = createHealthCheckHandler(deps)
    await handler({ id: '1', data: {} } as never)

    expect(warn).not.toHaveBeenCalled()
  })

  it('warns only for the breached threshold (boundary inclusive of null ages)', async () => {
    const { deps, warn } = depsWithSample({
      oldestUnpublishedAgeMs: null, // nothing unpublished — no age warning
      stalledLeaseCount: 1,
      quarantineCount: 0,
      oldestQuarantinedAgeMs: 60 * 1000,
    })
    const handler = createHealthCheckHandler(deps)
    await handler({ id: '1', data: {} } as never)

    const metrics = warn.mock.calls.map((c) => (c[0] as { metric?: string }).metric)
    expect(metrics).toEqual(['stalledLeaseCount'])
  })

  it('survives a sampling failure (warns, still reports healthy)', async () => {
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    const deps: HealthCheckDeps = {
      ...createMockDeps(),
      logger,
      sampleOpsMetrics: vi.fn(async () => {
        throw new Error('db read failed')
      }),
    }
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![1]).toMatch(/ops metrics/i)
  })

  it('logs queue depths when the reader is wired (domain-events + quarantine included)', async () => {
    const logger = pino({ level: 'silent' })
    const info = vi.spyOn(logger, 'info')
    const deps: HealthCheckDeps = {
      ...createMockDeps(),
      logger,
      readQueueDepths: vi.fn(async () => [
        { name: 'default', waiting: 1, active: 0, delayed: 0, failed: 0, paused: 0 },
        {
          name: 'domain-events',
          waiting: 2,
          active: 0,
          delayed: 0,
          failed: 0,
          paused: 0,
        },
        { name: 'quarantine', waiting: 3, active: 0, delayed: 0, failed: 0, paused: 0 },
      ]),
    }
    const handler = createHealthCheckHandler(deps)
    await handler({ id: '1', data: {} } as never)

    const depthLog = info.mock.calls.find((c) => String(c[1]).match(/queue depths/i))
    expect(depthLog).toBeDefined()
    const names = (depthLog![0] as { queues: Array<{ name: string }> }).queues.map(
      (q) => q.name,
    )
    expect(names).toContain('domain-events')
    expect(names).toContain('quarantine')
  })
})
