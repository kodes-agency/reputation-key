import { betaFeedbackPseudonym } from '#/contexts/identity/application/beta-feedback-pseudonym'
import { throwContextError } from '#/shared/auth/server-errors'
import type { RateLimiter } from '#/shared/rate-limit/middleware'

const ACTOR_LIMIT = Object.freeze({
  maxRequests: 5,
  windowSeconds: 60 * 60,
})
const ORGANIZATION_LIMIT = Object.freeze({
  maxRequests: 20,
  windowSeconds: 24 * 60 * 60,
})

type Input = Readonly<{
  rateLimiter: RateLimiter
  actorId: string
  organizationId: string
  keyHmacSecret: string
}>

function throwRateLimited(): never {
  throwContextError(
    'FeedbackError',
    {
      code: 'rate_limited',
      message: 'Please wait before sending more beta feedback.',
    },
    429,
  )
}

/**
 * Apply the narrower actor budget before the organization budget so repeated
 * denied retries cannot exhaust the shared allowance for other managers.
 */
export async function enforceBetaFeedbackRateLimit(
  input: Input,
  audience: 'manager' | 'staff' = 'manager',
): Promise<void> {
  const prefix =
    audience === 'staff' ? 'identity:staff-beta-feedback' : 'identity:beta-feedback'
  const actor = await input.rateLimiter.check(
    `${prefix}:actor:${betaFeedbackPseudonym(
      input.keyHmacSecret,
      'rate-limit-actor',
      input.actorId,
    )}`,
    audience === 'staff' ? { maxRequests: 2, windowSeconds: 3600 } : ACTOR_LIMIT,
  )
  if (!actor.allowed) throwRateLimited()

  const organization = await input.rateLimiter.check(
    `${prefix}:organization:${betaFeedbackPseudonym(
      input.keyHmacSecret,
      'rate-limit-organization',
      input.organizationId,
    )}`,
    audience === 'staff' ? { maxRequests: 10, windowSeconds: 86400 } : ORGANIZATION_LIMIT,
  )
  if (!organization.allowed) throwRateLimited()
}
