import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { portalError, type PortalError } from '../domain/errors'

// "Download again" hands out the one secret a printed code is made of, so it
// has its own budget: generous for a person printing a batch, small for a
// script. The actor is checked first so an already-limited account cannot burn
// the wider Organization budget with retries.
const ACTOR_LIMIT = Object.freeze({ maxRequests: 30, windowSeconds: 60 * 60 })
const ORGANIZATION_LIMIT = Object.freeze({
  maxRequests: 200,
  windowSeconds: 24 * 60 * 60,
})

type Input = Readonly<{
  rateLimiter: RateLimiter
  actorId: string
  organizationId: string
}>

/** The refusal to throw, or null when both budgets have room. */
export async function checkPortalAddressRateLimit(
  input: Input,
): Promise<PortalError | null> {
  const refusal = portalError(
    'rate_limited',
    'Too many downloads. Please wait a little before trying again.',
  )
  const actor = await input.rateLimiter.check(
    `portal:address-reveal:actor:${input.organizationId}:${input.actorId}`,
    ACTOR_LIMIT,
  )
  if (!actor.allowed) return refusal
  const organization = await input.rateLimiter.check(
    `portal:address-reveal:organization:${input.organizationId}`,
    ORGANIZATION_LIMIT,
  )
  return organization.allowed ? null : refusal
}
