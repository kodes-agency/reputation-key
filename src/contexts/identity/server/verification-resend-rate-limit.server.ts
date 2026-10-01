import { createHmac } from 'node:crypto'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { throwContextError } from '#/shared/auth/server-errors'

const IP_LIMIT = Object.freeze({ maxRequests: 5, windowSeconds: 60 * 60 })
const ADDRESS_LIMIT = Object.freeze({ maxRequests: 3, windowSeconds: 60 * 60 })

type Input = Readonly<{
  rateLimiter: RateLimiter
  ip: string
  email: string
  keyHmacSecret: string
}>

/** The address never reaches the limiter store; a keyed pseudonym does. */
function addressPseudonym(secret: string, email: string): string {
  return createHmac('sha256', secret)
    .update('repkey:identity:verify-resend:v1\0')
    .update(email.trim().toLowerCase())
    .digest('hex')
}

function throwRateLimited(): never {
  throwContextError(
    'AuthError',
    {
      code: 'rate_limited',
      message: 'Too many requests for a new link. Try again later.',
    },
    429,
  )
}

/**
 * The anonymous "send a new verification link" budget: per IP, then per
 * address. IP first, so a limited client cannot spend the address budget of
 * whoever it is targeting on every refused retry.
 */
export async function enforceVerificationResendRateLimit(input: Input): Promise<void> {
  const ip = await input.rateLimiter.check(
    `identity:verify-resend:ip:${input.ip}`,
    IP_LIMIT,
  )
  if (!ip.allowed) throwRateLimited()

  const address = await input.rateLimiter.check(
    `identity:verify-resend:email:${addressPseudonym(input.keyHmacSecret, input.email)}`,
    ADDRESS_LIMIT,
  )
  if (!address.allowed) throwRateLimited()
}
