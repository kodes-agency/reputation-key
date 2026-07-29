import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveProbe, readyProbe, startupProbe, probeHttpStatus } from './probes'

const fixedNow = () => new Date('2026-07-16T12:00:00.000Z')

describe('liveProbe', () => {
  it('always reports ok', () => {
    expect(liveProbe(fixedNow)).toEqual({
      status: 'ok',
      timestamp: '2026-07-16T12:00:00.000Z',
    })
  })
})

// BQC-7.2 liveness pin (architecture-test style source scan): liveness must
// stay dependency-free — neither the route nor the probe module may import
// DB/Redis seams. A platform liveness check that touches dependencies turns
// a dependency outage into a restart loop.
describe('liveness dependency pin', () => {
  const FORBIDDEN =
    /shared\/db|db-probe|cache\/redis|getPool|getRedis|operations-snapshot/

  it('the live route imports no dependency seams', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/routes/api/health/live.ts'),
      'utf8',
    )
    expect(source).not.toMatch(FORBIDDEN)
  })

  it('the probes module stays pure (no dependency seams)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/shared/health/probes.ts'),
      'utf8',
    )
    expect(source).not.toMatch(FORBIDDEN)
  })
})

describe('readyProbe', () => {
  const allUp = { db: true, redis: true, migrations: true, policy: true }

  it('is ok when db, redis, migrations and policy are all healthy', () => {
    expect(readyProbe(allUp, fixedNow)).toEqual({
      status: 'ok',
      db: true,
      redis: true,
      migrations: true,
      policy: true,
      timestamp: '2026-07-16T12:00:00.000Z',
    })
    expect(probeHttpStatus('ok')).toBe(200)
  })

  it.each([
    ['db', { ...allUp, db: false }],
    ['redis', { ...allUp, redis: false }],
    ['migrations', { ...allUp, migrations: false }],
    ['policy', { ...allUp, policy: false }],
  ] as const)('is degraded when %s fails', (field, deps) => {
    const body = readyProbe(deps, fixedNow)
    expect(body.status).toBe('degraded')
    expect(body[field]).toBe(false)
    expect(probeHttpStatus(body.status)).toBe(503)
  })
})

describe('startupProbe', () => {
  const booted = { container: true, migrations: true, policy: true }

  it('is ok once container, migrations and policy are complete', () => {
    expect(startupProbe(booted, fixedNow)).toEqual({
      status: 'ok',
      container: true,
      migrations: true,
      policy: true,
      timestamp: '2026-07-16T12:00:00.000Z',
    })
    expect(probeHttpStatus('ok')).toBe(200)
  })

  it.each([
    ['container', { ...booted, container: false }],
    ['migrations', { ...booted, migrations: false }],
    ['policy', { ...booted, policy: false }],
  ] as const)('is degraded while %s is incomplete', (field, deps) => {
    const body = startupProbe(deps, fixedNow)
    expect(body.status).toBe('degraded')
    expect(body[field]).toBe(false)
    expect(probeHttpStatus(body.status)).toBe(503)
  })
})
