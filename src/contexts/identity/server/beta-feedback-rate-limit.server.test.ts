import { describe, expect, it, vi } from 'vitest'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import {
  betaFeedbackPseudonym,
  enforceBetaFeedbackRateLimit,
} from './beta-feedback-rate-limit.server'

function limiterWith(results: ReadonlyArray<boolean>): RateLimiter & {
  check: ReturnType<typeof vi.fn>
} {
  let index = 0
  return {
    check: vi.fn(async () => ({
      allowed: results[index++] ?? true,
      remaining: 0,
      resetAt: new Date('2026-08-26T00:00:00.000Z'),
      backendStatus: 'available' as const,
    })),
  }
}

const INPUT = {
  actorId: 'private-user-id',
  organizationId: 'private-organization-id',
  keyHmacSecret: 'beta-feedback-test-secret',
} as const

describe('beta feedback rate limit', () => {
  it('uses scoped pseudonyms and applies actor then organization budgets', async () => {
    const rateLimiter = limiterWith([true, true])

    await enforceBetaFeedbackRateLimit({ ...INPUT, rateLimiter })

    expect(rateLimiter.check).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^identity:beta-feedback:actor:[a-f0-9]{64}$/u),
      { maxRequests: 5, windowSeconds: 3_600 },
    )
    expect(rateLimiter.check).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^identity:beta-feedback:organization:[a-f0-9]{64}$/u),
      { maxRequests: 20, windowSeconds: 86_400 },
    )
    expect(JSON.stringify(rateLimiter.check.mock.calls)).not.toContain(INPUT.actorId)
    expect(JSON.stringify(rateLimiter.check.mock.calls)).not.toContain(
      INPUT.organizationId,
    )
  })

  it('does not consume the organization budget after the actor is denied', async () => {
    const rateLimiter = limiterWith([false])

    await expect(
      enforceBetaFeedbackRateLimit({ ...INPUT, rateLimiter }),
    ).rejects.toMatchObject({
      name: 'FeedbackError',
      code: 'rate_limited',
      status: 429,
    })
    expect(rateLimiter.check).toHaveBeenCalledTimes(1)
  })

  it('returns unlinkable pseudonyms for distinct telemetry audiences', () => {
    const actorRateLimit = betaFeedbackPseudonym(
      INPUT.keyHmacSecret,
      'rate-limit-actor',
      INPUT.actorId,
    )
    const actorTelemetry = betaFeedbackPseudonym(
      INPUT.keyHmacSecret,
      'telemetry-actor',
      INPUT.actorId,
    )

    expect(actorRateLimit).toMatch(/^[a-f0-9]{64}$/u)
    expect(actorTelemetry).toMatch(/^[a-f0-9]{64}$/u)
    expect(actorRateLimit).not.toBe(actorTelemetry)
  })
})
