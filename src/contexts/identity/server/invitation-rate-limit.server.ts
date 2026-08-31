import { createHmac } from 'node:crypto'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { throwContextError } from '#/shared/auth/server-errors'

const ACTOR_LIMIT = Object.freeze({
  maxRequests: 20,
  windowSeconds: 60 * 60,
})
const ORGANIZATION_LIMIT = Object.freeze({
  maxRequests: 100,
  windowSeconds: 24 * 60 * 60,
})

type Input = Readonly<{
  rateLimiter: RateLimiter
  actorId: string
  organizationId: string
  keyHmacSecret: string
}>

function pseudonym(secret: string, audience: 'actor' | 'organization', value: string) {
  return createHmac('sha256', secret)
    .update(`repkey:identity:invitation-send:${audience}:v1\0`)
    .update(value)
    .digest('hex')
}

function throwRateLimited(): never {
  throwContextError(
    'AuthError',
    {
      code: 'rate_limited',
      message: 'Please wait before sending more invitations.',
    },
    429,
  )
}

/**
 * One abuse budget for both new and repeated invitation emails. Actor-first
 * ordering prevents an already-limited account from consuming the wider
 * organization budget on every rejected retry.
 */
export async function enforceInvitationSendRateLimit(input: Input): Promise<void> {
  const actor = await input.rateLimiter.check(
    `identity:invitation-send:actor:${pseudonym(
      input.keyHmacSecret,
      'actor',
      input.actorId,
    )}`,
    ACTOR_LIMIT,
  )
  if (!actor.allowed) throwRateLimited()

  const organization = await input.rateLimiter.check(
    `identity:invitation-send:organization:${pseudonym(
      input.keyHmacSecret,
      'organization',
      input.organizationId,
    )}`,
    ORGANIZATION_LIMIT,
  )
  if (!organization.allowed) throwRateLimited()
}
