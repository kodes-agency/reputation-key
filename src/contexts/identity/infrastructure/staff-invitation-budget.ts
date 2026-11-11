import { INVITATION_BUDGET_MESSAGE } from '#/shared/domain/invitation-budget-limits'
import {
  spendInvitationSendBudget,
  readInvitationSendBudget,
} from '#/shared/auth/invitation-send-budget'
import type { AuthContext } from '#/shared/domain/auth-context'
import { staffAccountError } from '../domain/staff-account'
import { createStaffAddressCheckBudget } from './staff-address-check-budget'

export function createStaffInvitationBudget(
  rateLimiter: Parameters<typeof spendInvitationSendBudget>[0]['rateLimiter'],
  keyHmacSecret: string,
) {
  const input = (ctx: AuthContext) => ({
    rateLimiter,
    keyHmacSecret,
    actorId: ctx.userId,
    organizationId: ctx.organizationId,
  })
  return {
    checkAddresses: createStaffAddressCheckBudget(rateLimiter, keyHmacSecret),
    spend: async (ctx: AuthContext) => {
      if (!(await spendInvitationSendBudget(input(ctx))))
        throw staffAccountError('rate_limited', INVITATION_BUDGET_MESSAGE)
    },
    remaining: (ctx: AuthContext) => readInvitationSendBudget(input(ctx)),
  }
}
