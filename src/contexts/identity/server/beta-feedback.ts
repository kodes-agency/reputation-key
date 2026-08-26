import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import {
  type BetaFeedbackInput,
  betaFeedbackInputSchema,
} from '#/shared/beta-feedback-contract'
import { getEnv } from '#/shared/config/env'
import { hasRole } from '#/shared/domain/roles'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { deliverBetaFeedback } from './beta-feedback-delivery.server'
import { enforceBetaFeedbackRateLimit } from './beta-feedback-rate-limit.server'

export const submitBetaFeedbackHandler = createServerOnlyFn(
  async ({
    data,
  }: Readonly<{ data: BetaFeedbackInput }>): Promise<Readonly<{ reference: string }>> => {
    const headers = await headersFromContext()
    const actor = await resolveTenantContext(headers)
    if (!hasRole(actor.role, 'PropertyManager')) {
      throwContextError(
        'FeedbackError',
        {
          code: 'forbidden',
          message: 'Beta feedback is available to account administrators and managers.',
        },
        403,
      )
    }

    try {
      const secret = getEnv().BETTER_AUTH_SECRET
      await enforceBetaFeedbackRateLimit({
        rateLimiter: getContainer().rateLimiter,
        actorId: actor.userId,
        organizationId: actor.organizationId,
        keyHmacSecret: secret,
      })

      const reference = deliverBetaFeedback({ data, actor, hmacSecret: secret })

      return { reference }
    } catch (error) {
      throw catchUntagged(error)
    }
  },
)

export const submitBetaFeedbackFn = createServerFn({ method: 'POST' })
  .validator(betaFeedbackInputSchema)
  .handler(
    tracedHandler(submitBetaFeedbackHandler, 'POST', 'identity.submitBetaFeedback'),
  )
