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
})
