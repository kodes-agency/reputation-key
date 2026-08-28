import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import {
  BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS,
  type BetaFeedbackInput,
  betaFeedbackInputSchema,
  classifyBetaFeedbackRoute,
} from '#/shared/beta-feedback-contract'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { deliverBetaFeedback } from './beta-feedback-delivery.server'
import {
  betaFeedbackPseudonym,
  enforceBetaFeedbackRateLimit,
} from './beta-feedback-rate-limit.server'

export const submitBetaFeedbackHandler = createServerOnlyFn(
  async ({
    data,
  }: Readonly<{ data: BetaFeedbackInput }>): Promise<Readonly<{ reference: string }>> => {
    const headers = await headersFromContext()
    const actor = await resolveTenantContext(headers)
    await requireExecutionAllowed({ actor, action: 'feedback.respond' })

    try {
      const {
        rateLimiter,
        identityRequestSecurity,
        betaFeedbackTriageRepo: triage,
        idGen,
        clock,
      } = getContainer()
      const secret = identityRequestSecurity.betaFeedbackHmacSecret
      await enforceBetaFeedbackRateLimit({
        rateLimiter,
        actorId: actor.userId,
        organizationId: actor.organizationId,
        keyHmacSecret: secret,
      })

      const now = clock()
      const reference = idGen()
      const attachmentExpiresAt =
        data.type === 'bug' && data.attachment
          ? new Date(
              now.getTime() +
                BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
            )
          : null
      await triage.prepare({
        reference,
        organizationPseudonym: betaFeedbackPseudonym(
          secret,
          'telemetry-organization',
          actor.organizationId,
        ),
        actorPseudonym: betaFeedbackPseudonym(secret, 'telemetry-actor', actor.userId),
        feedbackType: data.type,
        impactCode: data.type === 'bug' ? data.impact : data.importance,
        routeKey: classifyBetaFeedbackRoute(data.routePath),
        viewport: data.viewport,
        reporterRole: actor.role,
        attachmentKind:
          data.type === 'bug' && data.attachment ? 'masked_layout_v1' : 'none',
        attachmentCapturedAt: attachmentExpiresAt ? now : null,
        attachmentExpiresAt,
        now,
      })

      const delivery = deliverBetaFeedback({
        data,
        actor,
        hmacSecret: secret,
        reference,
        capturedAt: now,
        attachmentExpiresAt,
      })
      if (delivery.status === 'failed') {
        await triage.markFailed({
          reference,
          failureCode: delivery.failureCode,
          expectedRevision: 0,
          now,
        })
        throwContextError(
          'FeedbackError',
          {
            code: 'temporarily_unavailable',
            message: 'Beta feedback is temporarily unavailable. Please try again later.',
          },
          503,
        )
      }
      await triage.markDelivered({
        reference,
        providerReference: delivery.providerReference,
        expectedRevision: 0,
        now,
      })

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
