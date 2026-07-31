// Tests for health-check background job
import { describe, it, expect, vi } from 'vitest'
import { createHealthCheckHandler, type HealthCheckDeps } from './health-check.job'
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

  it('skips alert evaluation when the 7.4 wiring is only partially present', async () => {
    // All four 7.4 deps are required; a partial wiring must not evaluate.
    const logger = pino({ level: 'silent' })
    const warn = vi.spyOn(logger, 'warn')
    const deps: HealthCheckDeps = {
      ...createMockDeps(),
      logger,
      readOperationsSnapshot: vi.fn(async () => {
        throw new Error('must not be called')
      }),
    }
    const handler = createHealthCheckHandler(deps)
    const result = await handler({ id: '1', data: {} } as never)

    expect(result.db).toBe(true)
    expect(result.alerts).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})
