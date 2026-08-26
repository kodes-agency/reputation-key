import { describe, expect, it, vi } from 'vitest'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { enforceInvitationSendRateLimit } from './invitation-rate-limit.server'

function limiterWith(results: ReadonlyArray<boolean>): RateLimiter & {
  check: ReturnType<typeof vi.fn>
} {
  const check = vi.fn(
    async () =>
      ({
        allowed: results[check.mock.calls.length - 1] ?? true,
        remaining: 0,
        resetAt: new Date('2026-08-26T12:00:00.000Z'),
      }) as const,
  )
  return { check }
}

const INPUT = {
  actorId: 'user-raw-id',
  organizationId: 'organization-raw-id',
  keyHmacSecret: 'identity-rate-limit-test-secret',
} as const

describe('invitation send abuse control', () => {
  it('applies one shared create/resend budget to actor and organization', async () => {
    const rateLimiter = limiterWith([true, true])

    await enforceInvitationSendRateLimit({ ...INPUT, rateLimiter })

    expect(rateLimiter.check).toHaveBeenCalledTimes(2)
    const [actorKey, actorLimit] = rateLimiter.check.mock.calls[0] ?? []
    const [organizationKey, organizationLimit] = rateLimiter.check.mock.calls[1] ?? []
    expect(actorKey).toMatch(/^identity:invitation-send:actor:[a-f0-9]{64}$/)
    expect(organizationKey).toMatch(
      /^identity:invitation-send:organization:[a-f0-9]{64}$/,
    )
    expect(actorKey).not.toContain(INPUT.actorId)
    expect(organizationKey).not.toContain(INPUT.organizationId)
    expect(actorLimit).toEqual({ maxRequests: 20, windowSeconds: 60 * 60 })
    expect(organizationLimit).toEqual({
      maxRequests: 100,
      windowSeconds: 24 * 60 * 60,
    })
  })

  it('does not let one exhausted actor consume the organization budget', async () => {
    const rateLimiter = limiterWith([false])

    await expect(
      enforceInvitationSendRateLimit({ ...INPUT, rateLimiter }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'rate_limited',
      status: 429,
      message: 'Please wait before sending more invitations.',
    })
    expect(rateLimiter.check).toHaveBeenCalledOnce()
  })

  it('fails closed when the organization budget is exhausted', async () => {
    const rateLimiter = limiterWith([true, false])

    await expect(
      enforceInvitationSendRateLimit({ ...INPUT, rateLimiter }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'rate_limited',
      status: 429,
    })
    expect(rateLimiter.check).toHaveBeenCalledTimes(2)
  })
})
