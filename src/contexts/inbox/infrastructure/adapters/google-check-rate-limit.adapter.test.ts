import { describe, expect, it } from 'vitest'
import type { RateLimiter, RateLimitResult } from '#/shared/rate-limit/middleware'
import { createGoogleCheckRateLimitAdapter } from './google-check-rate-limit.adapter'

const LIMIT = { maxRequests: 1, windowSeconds: 60 }

const limiterAnswering = (result: Partial<RateLimitResult>): RateLimiter => ({
  check: async () => ({
    allowed: true,
    remaining: 0,
    resetAt: new Date('2026-10-21T10:00:00.000Z'),
    backendStatus: 'available',
    ...result,
  }),
})

describe('createGoogleCheckRateLimitAdapter', () => {
  it('allows a call the limiter allows', async () => {
    const port = createGoogleCheckRateLimitAdapter(limiterAnswering({ allowed: true }))
    expect(await port.consume('k', LIMIT)).toBe('allowed')
  })

  it('reports a spent budget as limited', async () => {
    const port = createGoogleCheckRateLimitAdapter(limiterAnswering({ allowed: false }))
    expect(await port.consume('k', LIMIT)).toBe('limited')
  })

  it('reports a denial from an unavailable backend as unavailable, not limited', async () => {
    const port = createGoogleCheckRateLimitAdapter(
      limiterAnswering({ allowed: false, backendStatus: 'unavailable' }),
    )
    expect(await port.consume('k', LIMIT)).toBe('unavailable')
  })

  it('reports a limiter that throws as unavailable', async () => {
    const port = createGoogleCheckRateLimitAdapter({
      check: async () => {
        throw new Error('redis down')
      },
    })
    expect(await port.consume('k', LIMIT)).toBe('unavailable')
  })

  it('passes the key and the window to the limiter unchanged', async () => {
    const seen: Array<readonly [string, unknown]> = []
    const port = createGoogleCheckRateLimitAdapter({
      check: async (key, override) => {
        seen.push([key, override])
        return {
          allowed: true,
          remaining: 0,
          resetAt: new Date(0),
          backendStatus: 'available',
        }
      },
    })
    await port.consume('inbox:k', LIMIT)
    expect(seen).toEqual([['inbox:k', LIMIT]])
  })
})
