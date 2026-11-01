import { throwContextError } from '#/shared/auth/server-errors'
import { spendInvitationSendBudget } from '#/shared/auth/invitation-send-budget'
export { readInvitationSendBudget } from '#/shared/auth/invitation-send-budget'

/** Both manager and staff invitations share the same invitation-send counters. */
export async function enforceInvitationSendRateLimit(
  input: Parameters<typeof spendInvitationSendBudget>[0],
): Promise<void> {
  if (await spendInvitationSendBudget(input)) return
  throwContextError(
    'AuthError',
    { code: 'rate_limited', message: 'Please wait before sending more invitations.' },
    429,
  )
}
