import { createHmac } from 'node:crypto'
import type { RateLimiter } from '#/shared/rate-limit/middleware'

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

/**
 * One abuse budget for both new and repeated invitation emails. Actor-first
 * ordering prevents an already-limited account from consuming the wider
 * organization budget on every rejected retry.
 */
export async function spendInvitationSendBudget(input: Input): Promise<boolean> {
  const actor = await input.rateLimiter.check(
    `identity:invitation-send:actor:${pseudonym(
      input.keyHmacSecret,
      'actor',
      input.actorId,
    )}`,
    ACTOR_LIMIT,
  )
  if (!actor.allowed) return false

  const organization = await input.rateLimiter.check(
    `identity:invitation-send:organization:${pseudonym(
      input.keyHmacSecret,
      'organization',
      input.organizationId,
    )}`,
    ORGANIZATION_LIMIT,
  )
  return organization.allowed
}

/** Reads the existing counters without consuming an invitation. */
export async function readInvitationSendBudget(input: Input): Promise<number> {
  if (!input.rateLimiter.remaining) return 0
  const remaining = await Promise.all([
    input.rateLimiter.remaining(
      `identity:invitation-send:actor:${pseudonym(input.keyHmacSecret, 'actor', input.actorId)}`,
      ACTOR_LIMIT,
    ),
    input.rateLimiter.remaining(
      `identity:invitation-send:organization:${pseudonym(input.keyHmacSecret, 'organization', input.organizationId)}`,
      ORGANIZATION_LIMIT,
    ),
  ])
  return Math.min(...remaining)
}
