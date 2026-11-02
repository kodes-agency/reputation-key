import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getContainer } from '#/composition'
import { getAuth } from '#/shared/auth/auth'
import { headersFromContext } from '#/shared/auth/headers'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  betaFeedbackInputSchema,
  type BetaFeedbackInput,
} from '#/shared/beta-feedback-contract'
import { changePasswordCommandSchema } from '../application/dto/change-password.dto'
import { isBetaFeedbackError } from '../domain/errors'
import { resolveStaffSelfContext } from './staff-self-context'
import { enforceBetaFeedbackRateLimit } from './beta-feedback-rate-limit.server'
import {
  assertStaffPasswordBudget,
  staffPasswordFailureKey,
  STAFF_PASSWORD_FAILURE_LIMIT,
} from './staff-password-rate-limit.server'
import { handleAuthError } from './auth-settings.helpers'

async function ownAccount() {
  const headers = await headersFromContext()
  const { ctx } = await resolveStaffSelfContext(headers)
  await requireExecutionAllowed({
    actor: ctx,
    action: 'staff.self',
    capability: 'staff.accounts',
  })
  return { headers, ctx }
}

export const changeMyStaffPasswordHandler = createServerOnlyFn(
  async ({ data }: { data: { currentPassword: string; newPassword: string } }) => {
    const { headers, ctx } = await ownAccount()
    await requireExecutionAllowed({ actor: ctx, action: 'identity.password.change' })
    const { rateLimiter } = getContainer()
    await assertStaffPasswordBudget(rateLimiter, ctx.userId)
    try {
      await getAuth().api.changePassword({
        headers,
        body: { ...data, revokeOtherSessions: true },
      })
    } catch (error) {
      await rateLimiter.check(
        staffPasswordFailureKey(ctx.userId),
        STAFF_PASSWORD_FAILURE_LIMIT,
      )
      handleAuthError(
        getContainer().logger,
        error,
        'AuthError',
        'password_change_failed',
        'Failed to change password. Please check your current password.',
      )
    }
  },
)

export const changeMyStaffPassword = createServerFn({ method: 'POST' })
  .validator(changePasswordCommandSchema)
  .handler(
    tracedHandler(changeMyStaffPasswordHandler, 'POST', 'identity.changeMyStaffPassword'),
  )

export const submitMyStaffFeedbackHandler = createServerOnlyFn(
  async ({ data }: { data: BetaFeedbackInput }) => {
    const { ctx: actor } = await ownAccount()
    try {
      const { rateLimiter, identityRequestSecurity, identityBetaFeedback } =
        getContainer()
      await enforceBetaFeedbackRateLimit(
        {
          rateLimiter,
          actorId: actor.userId,
          organizationId: actor.organizationId,
          keyHmacSecret: identityRequestSecurity.betaFeedbackHmacSecret,
        },
        'staff',
      )
      return await identityBetaFeedback.submit({ actor, data })
    } catch (error) {
      if (isBetaFeedbackError(error)) throwContextError('FeedbackError', error, 503)
      throw catchUntagged(error)
    }
  },
)

export const submitMyStaffFeedback = createServerFn({ method: 'POST' })
  .validator(betaFeedbackInputSchema)
  .handler(
    tracedHandler(submitMyStaffFeedbackHandler, 'POST', 'identity.submitMyStaffFeedback'),
  )

export const listMyStaffFeedbackHandler = createServerOnlyFn(async () => {
  setResponseHeader('Cache-Control', 'private, no-store')
  const { ctx: actor } = await ownAccount()
  try {
    return await getContainer().identityBetaFeedback.listMine({ actor })
  } catch (error) {
    throw catchUntagged(error)
  }
})
export const listMyStaffFeedback = createServerFn({ method: 'GET' }).handler(
  tracedHandler(listMyStaffFeedbackHandler, 'GET', 'identity.listMyStaffFeedback'),
)
