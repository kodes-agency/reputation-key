import { betaFeedbackPseudonym } from '#/contexts/identity/application/beta-feedback-pseudonym'
import { throwContextError } from '#/shared/auth/server-errors'
import type { RateLimiter } from '#/shared/rate-limit/middleware'

// Re-exported so the existing server-side consumers (and their module mocks)
// keep a single import site; the derivation itself now lives in application/.
export { betaFeedbackPseudonym }

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
export async function enforceBetaFeedbackRateLimit(input: Input): Promise<void> {
  const actor = await input.rateLimiter.check(
    `identity:beta-feedback:actor:${betaFeedbackPseudonym(
      input.keyHmacSecret,
      'rate-limit-actor',
      input.actorId,
    )}`,
    ACTOR_LIMIT,
  )
  if (!actor.allowed) throwRateLimited()

  const organization = await input.rateLimiter.check(
    `identity:beta-feedback:organization:${betaFeedbackPseudonym(
      input.keyHmacSecret,
      'rate-limit-organization',
      input.organizationId,
    )}`,
    ORGANIZATION_LIMIT,
  )
  if (!organization.allowed) throwRateLimited()
}
