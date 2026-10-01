import { describe, expect, it, vi } from 'vitest'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { checkPortalAddressRateLimit } from './portal-address-rate-limit.server'

function limiterWith(results: ReadonlyArray<boolean>): RateLimiter & {
  check: ReturnType<typeof vi.fn>
} {
  const check = vi.fn(
    async () =>
      ({
        allowed: results[check.mock.calls.length - 1] ?? true,
        remaining: 0,
        resetAt: new Date('2026-09-30T12:00:00.000Z'),
        backendStatus: 'available',
      }) as const,
  )
  return { check }
}

const INPUT = { actorId: 'user-1', organizationId: 'org-1' } as const

describe('Portal address download abuse control', () => {
  it('spends one actor budget and one Organization budget', async () => {
    const rateLimiter = limiterWith([true, true])

    await expect(
      checkPortalAddressRateLimit({ ...INPUT, rateLimiter }),
    ).resolves.toBeNull()

    expect(rateLimiter.check).toHaveBeenCalledTimes(2)
    expect(rateLimiter.check.mock.calls[0]).toEqual([
      'portal:address-reveal:actor:org-1:user-1',
      { maxRequests: 30, windowSeconds: 3600 },
    ])
    expect(rateLimiter.check.mock.calls[1]).toEqual([
      'portal:address-reveal:organization:org-1',
      { maxRequests: 200, windowSeconds: 86_400 },
    ])
  })

  it('does not let an exhausted actor spend the Organization budget', async () => {
    const rateLimiter = limiterWith([false])

    await expect(
      checkPortalAddressRateLimit({ ...INPUT, rateLimiter }),
    ).resolves.toMatchObject({ _tag: 'PortalError', code: 'rate_limited' })
    expect(rateLimiter.check).toHaveBeenCalledTimes(1)
  })

  it('refuses when the Organization budget is spent', async () => {
    const rateLimiter = limiterWith([true, false])

    await expect(
      checkPortalAddressRateLimit({ ...INPUT, rateLimiter }),
    ).resolves.toMatchObject({ code: 'rate_limited' })
  })

  it('keeps two Organizations in separate buckets even for the same user id', async () => {
    const rateLimiter = limiterWith([true, true, true, true])

    await checkPortalAddressRateLimit({ ...INPUT, rateLimiter })
    await checkPortalAddressRateLimit({ ...INPUT, organizationId: 'org-2', rateLimiter })

    const keys = rateLimiter.check.mock.calls.map(([key]) => key)
    expect(new Set(keys).size).toBe(4)
  })
})
