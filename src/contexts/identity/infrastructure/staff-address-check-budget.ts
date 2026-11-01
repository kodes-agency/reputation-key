import { createHmac } from 'node:crypto'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { staffAccountError } from '../domain/staff-account'

/** Address checks have their own actor budget; they never spend an invitation. */
export const createStaffAddressCheckBudget =
  (rateLimiter: RateLimiter, secret: string) =>
  async (ctx: AuthContext, units: number): Promise<void> => {
    const actor = createHmac('sha256', secret)
      .update('repkey:identity:staff-address-check:actor:v1\0')
      .update(ctx.userId)
      .digest('hex')
    for (let unit = 0; unit < units; unit += 1) {
      const result = await rateLimiter.check(
        `identity:staff-address-check:actor:${actor}`,
        {
          maxRequests: 200,
          windowSeconds: 3600,
        },
      )
      if (!result.allowed)
        throw staffAccountError(
          'rate_limited',
          'Please wait before checking more staff addresses',
        )
    }
  }
