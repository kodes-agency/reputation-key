// BQC-7.2 — readiness/startup assembly semantics (fake probes; the real
// probe implementations are covered by the e2e healthy-rig assertions).
import { describe, expect, it } from 'vitest'
import {
  runReadiness,
  runStartup,
  READINESS_PROBE_BUDGET_MS,
  type ReadinessProbes,
  type StartupProbes,
} from './readiness'

const fixedNow = () => new Date('2026-07-16T12:00:00.000Z')

const pass = () => Promise.resolve(true)
const fail = () => Promise.resolve(false)
const reject = () => Promise.reject(new Error('boom'))
const never = () => new Promise<boolean>(() => {})

const allUp: ReadinessProbes = { db: pass, redis: pass, migrations: pass, policy: pass }

describe('runReadiness', () => {
  it('is ok with every probe field true when all probes pass', async () => {
    const body = await runReadiness(allUp, READINESS_PROBE_BUDGET_MS, fixedNow)
    expect(body).toEqual({
      status: 'ok',
      db: true,
      redis: true,
      migrations: true,
      policy: true,
      timestamp: '2026-07-16T12:00:00.000Z',
    })
  })

  it.each(['db', 'redis', 'migrations', 'policy'] as const)(
    'degrades with only %s false when that probe fails',
    async (field) => {
      const body = await runReadiness(
        { ...allUp, [field]: fail },
        READINESS_PROBE_BUDGET_MS,
        fixedNow,
      )
      expect(body.status).toBe('degraded')
      expect(body[field]).toBe(false)
      for (const other of ['db', 'redis', 'migrations', 'policy'] as const) {
        if (other !== field) expect(body[other]).toBe(true)
      }
    },
  )

  it('reports a rejecting probe as false (never throws)', async () => {
    const body = await runReadiness(
      { ...allUp, migrations: reject },
      READINESS_PROBE_BUDGET_MS,
      fixedNow,
    )
    expect(body.status).toBe('degraded')
    expect(body.migrations).toBe(false)
  })

  it.each(['db', 'redis', 'migrations', 'policy'] as const)(
    'fires the budget on a never-resolving %s probe',
    async (field) => {
      const start = Date.now()
      const body = await runReadiness({ ...allUp, [field]: never }, 25, fixedNow)
      expect(Date.now() - start).toBeLessThan(1000)
      expect(body.status).toBe('degraded')
      expect(body[field]).toBe(false)
    },
  )
})

describe('runStartup', () => {
  const booted: StartupProbes = { container: () => true, migrations: pass, policy: pass }

  it('is 200-shaped once container, migrations and policy complete', async () => {
    const body = await runStartup(booted, READINESS_PROBE_BUDGET_MS, fixedNow)
    expect(body).toEqual({
      status: 'ok',
      container: true,
      migrations: true,
      policy: true,
      timestamp: '2026-07-16T12:00:00.000Z',
    })
  })

  it('is 503-shaped while the container has not built', async () => {
    const body = await runStartup(
      { ...booted, container: () => false },
      READINESS_PROBE_BUDGET_MS,
      fixedNow,
    )
    expect(body.status).toBe('degraded')
    expect(body.container).toBe(false)
  })

  it('is 503-shaped when the container probe throws (build failed)', async () => {
    const body = await runStartup(
      {
        ...booted,
        container: () => {
          throw new Error('[CONFIG] Invalid environment variables')
        },
      },
      READINESS_PROBE_BUDGET_MS,
      fixedNow,
    )
    expect(body.status).toBe('degraded')
    expect(body.container).toBe(false)
  })

  it('is 503-shaped while migrations have not caught up', async () => {
    const body = await runStartup(
      { ...booted, migrations: fail },
      READINESS_PROBE_BUDGET_MS,
      fixedNow,
    )
    expect(body.status).toBe('degraded')
    expect(body.migrations).toBe(false)
  })

  it('fires the budget on a never-resolving probe', async () => {
    const start = Date.now()
    const body = await runStartup({ ...booted, policy: never }, 25, fixedNow)
    expect(Date.now() - start).toBeLessThan(1000)
    expect(body.status).toBe('degraded')
    expect(body.policy).toBe(false)
  })
})
