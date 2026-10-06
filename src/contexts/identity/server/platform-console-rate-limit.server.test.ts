import { describe, expect, it, vi } from 'vitest'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { enforcePlatformConsoleRateLimit } from './platform-console-rate-limit.server'

const INPUT = {
  operatorUserId: 'user-operator-raw-id',
  keyHmacSecret: 'platform-console-test-secret',
} as const

/** A limiter that counts calls per key against the budget it is handed. */
function countingLimiter(): RateLimiter & { check: ReturnType<typeof vi.fn> } {
  const counts = new Map<string, number>()
  const check = vi.fn(async (key: string, limit?: Readonly<{ maxRequests: number }>) => {
    const count = (counts.get(key) ?? 0) + 1
    counts.set(key, count)
    return {
      allowed: count <= (limit?.maxRequests ?? Number.POSITIVE_INFINITY),
      remaining: 0,
      resetAt: new Date('2026-09-30T13:00:00.000Z'),
      backendStatus: 'available',
    } as const
  })
  return { check }
}

describe('platform console abuse control', () => {
  it('allows 30 changes an hour per operator and refuses the 31st with 429', async () => {
    const rateLimiter = countingLimiter()

    for (let call = 0; call < 30; call++) {
      await enforcePlatformConsoleRateLimit({ ...INPUT, rateLimiter })
    }
    await expect(
      enforcePlatformConsoleRateLimit({ ...INPUT, rateLimiter }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'rate_limited',
      status: 429,
    })

    const [, limit] = rateLimiter.check.mock.calls[0] ?? []
    expect(limit).toEqual({ maxRequests: 30, windowSeconds: 60 * 60 })
  })

  it('keys the budget by an HMAC of the operator, never the raw user id', async () => {
    const rateLimiter = countingLimiter()

    await enforcePlatformConsoleRateLimit({ ...INPUT, rateLimiter })

    const [key] = rateLimiter.check.mock.calls[0] ?? []
    expect(key).toMatch(/^identity:platform-console:operator:[a-f0-9]{64}$/)
    expect(key).not.toContain(INPUT.operatorUserId)
  })

  it('gives each operator their own budget', async () => {
    const rateLimiter = countingLimiter()

    await enforcePlatformConsoleRateLimit({ ...INPUT, rateLimiter })
    await enforcePlatformConsoleRateLimit({
      ...INPUT,
      operatorUserId: 'user-other-operator',
      rateLimiter,
    })

    const keys = rateLimiter.check.mock.calls.map(([key]) => key)
    expect(new Set(keys).size).toBe(2)
  })
})
