// Identity context — the operator console's change budget (ADR 0063).
//
// A stolen operator session is the console's main risk, so every change it
// makes (provision, invite, resend, cancel) draws on one small hourly budget
// per operator. The key is an HMAC of the user id, never the id itself.

import { createHmac } from 'node:crypto'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { throwContextError } from '#/shared/auth/server-errors'

const OPERATOR_LIMIT = Object.freeze({
  maxRequests: 30,
  windowSeconds: 60 * 60,
})

const KEY_DOMAIN = 'repkey:identity:platform-console:operator:v1'

type Input = Readonly<{
  rateLimiter: RateLimiter
  operatorUserId: string
  keyHmacSecret: string
}>

function pseudonym(secret: string, operatorUserId: string): string {
  return createHmac('sha256', secret)
    .update(`${KEY_DOMAIN}\0`)
    .update(operatorUserId)
    .digest('hex')
}

/** 30 console changes per operator per hour; the 31st is a 429. */
export async function enforcePlatformConsoleRateLimit(input: Input): Promise<void> {
  const result = await input.rateLimiter.check(
    `identity:platform-console:operator:${pseudonym(
      input.keyHmacSecret,
      input.operatorUserId,
    )}`,
    OPERATOR_LIMIT,
  )
  if (!result.allowed) {
    throwContextError(
      'AuthError',
      {
        code: 'rate_limited',
        message: 'Please wait before making more operator console changes.',
      },
      429,
    )
  }
}
