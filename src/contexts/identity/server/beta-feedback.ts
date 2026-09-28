import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import {
  type BetaFeedbackInput,
  type BetaFeedbackReportView,
  betaFeedbackInputSchema,
} from '#/shared/beta-feedback-contract'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isBetaFeedbackError } from '../domain/errors'
import { enforceBetaFeedbackRateLimit } from './beta-feedback-rate-limit.server'

function mapBetaFeedbackError(error: unknown): never {
  // The report is durably recorded as failed; the reporter may try again. An
  // already-mapped server error (the rate limit's 429) passes through as is.
  if (isBetaFeedbackError(error)) throwContextError('FeedbackError', error, 503)
  throw catchUntagged(error)
}

export const submitBetaFeedbackHandler = createServerOnlyFn(
  async ({
    data,
  }: Readonly<{ data: BetaFeedbackInput }>): Promise<Readonly<{ reference: string }>> => {
    const headers = await headersFromContext()
    const actor = await resolveTenantContext(headers)
    await requireExecutionAllowed({ actor, action: 'feedback.beta_report' })

    try {
      const { rateLimiter, identityRequestSecurity, identityBetaFeedback } =
        getContainer()
      await enforceBetaFeedbackRateLimit({
        rateLimiter,
        actorId: actor.userId,
        organizationId: actor.organizationId,
        keyHmacSecret: identityRequestSecurity.betaFeedbackHmacSecret,
      })
      return await identityBetaFeedback.submit({ actor, data })
    } catch (error) {
      mapBetaFeedbackError(error)
    }
  },
)

export const submitBetaFeedbackFn = createServerFn({ method: 'POST' })
  .validator(betaFeedbackInputSchema)
  .handler(
    tracedHandler(submitBetaFeedbackHandler, 'POST', 'identity.submitBetaFeedback'),
  )

export const listMyBetaFeedbackHandler = createServerOnlyFn(
  async (): Promise<readonly BetaFeedbackReportView[]> => {
    const headers = await headersFromContext()
    const actor = await resolveTenantContext(headers)
    await requireExecutionAllowed({ actor, action: 'feedback.beta_report' })

    try {
      return await getContainer().identityBetaFeedback.listMine({ actor })
    } catch (error) {
      throw catchUntagged(error)
    }
  },
)

export const listMyBetaFeedbackFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(listMyBetaFeedbackHandler, 'GET', 'identity.listMyBetaFeedback'),
)
