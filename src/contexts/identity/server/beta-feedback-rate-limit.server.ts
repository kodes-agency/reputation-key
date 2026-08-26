import { createHmac } from 'node:crypto'
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

type PseudonymAudience =
  | 'rate-limit-actor'
  | 'rate-limit-organization'
  | 'telemetry-actor'
  | 'telemetry-organization'

type Input = Readonly<{
  rateLimiter: RateLimiter
  actorId: string
  organizationId: string
  keyHmacSecret: string
}>

export function betaFeedbackPseudonym(
  secret: string,
  audience: PseudonymAudience,
  value: string,
): string {
  return createHmac('sha256', secret)
    .update(`repkey:beta-feedback:${audience}:v1\0`)
    .update(value)
    .digest('hex')
}

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
