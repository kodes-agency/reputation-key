import { describe, expect, it } from 'vitest'
import { liveProbe, readyProbe, probeHttpStatus } from './probes'

const fixedNow = () => new Date('2026-07-16T12:00:00.000Z')

describe('liveProbe', () => {
  it('always reports ok', () => {
    expect(liveProbe(fixedNow)).toEqual({
      status: 'ok',
      timestamp: '2026-07-16T12:00:00.000Z',
    })
  })
})

describe('readyProbe', () => {
  it('is ok when db and redis are healthy', () => {
    expect(readyProbe({ db: true, redis: true }, fixedNow)).toEqual({
      status: 'ok',
      db: true,
      redis: true,
      timestamp: '2026-07-16T12:00:00.000Z',
    })
    expect(probeHttpStatus('ok')).toBe(200)
  })

  it('is degraded when db is down', () => {
    const body = readyProbe({ db: false, redis: true }, fixedNow)
    expect(body.status).toBe('degraded')
    expect(body.db).toBe(false)
    expect(probeHttpStatus(body.status)).toBe(503)
  })

  it('is degraded when redis is down', () => {
    const body = readyProbe({ db: true, redis: false }, fixedNow)
    expect(body.status).toBe('degraded')
    expect(body.redis).toBe(false)
    expect(probeHttpStatus(body.status)).toBe(503)
  })
})
