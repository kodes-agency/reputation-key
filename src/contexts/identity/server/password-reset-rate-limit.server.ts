import { createHmac } from 'node:crypto'
import type { RateLimiter } from '#/shared/rate-limit/middleware'

// The same budget an address has for a new verification link
// (verification-resend-rate-limit.server.ts): the mail goes to whoever the
// caller names, so the caller's IP is not the only thing to count.
const ADDRESS_LIMIT = Object.freeze({ maxRequests: 3, windowSeconds: 60 * 60 })

type Input = Readonly<{
  /** The request for the provider's /request-password-reset; its body is not consumed. */
  request: Request
  rateLimiter: RateLimiter
  keyHmacSecret: string
}>

/** The address never reaches the limiter store; a keyed pseudonym does. */
function addressPseudonym(secret: string, email: string): string {
  return createHmac('sha256', secret)
    .update('repkey:identity:password-reset:v1\0')
    .update(email.trim().toLowerCase())
    .digest('hex')
}

/**
 * The address the request asks a reset mail for, read as the provider reads
 * it: the `email` of a JSON body. Null for anything else, which the provider
 * refuses itself, so no mail follows and there is nothing to count.
 */
async function requestedAddress(request: Request): Promise<string | null> {
  let body: unknown
  try {
    body = await request.clone().json()
  } catch {
    return null
  }
  const email = (body as { email?: unknown } | null)?.email
  return typeof email === 'string' && email.trim() !== '' ? email : null
}

/**
 * The per-address budget for an anonymous password reset request. The count
 * is by address whether or not it has an account, so a refusal says nothing
 * about accounts. The caller checks its per-IP limit first, so a limited
 * client cannot spend the budget of whoever it is targeting.
 */
export async function admitPasswordResetRequest(input: Input): Promise<boolean> {
  const email = await requestedAddress(input.request)
  if (email === null) return true
  const result = await input.rateLimiter.check(
    `identity:password-reset:email:${addressPseudonym(input.keyHmacSecret, email)}`,
    ADDRESS_LIMIT,
  )
  return result.allowed
}
