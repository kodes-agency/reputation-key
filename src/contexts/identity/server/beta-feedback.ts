import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { maskedLayoutExpiry } from '#/shared/beta-feedback-layout'
import {
  type BetaFeedbackInput,
  type BetaFeedbackReportView,
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
    await requireExecutionAllowed({ actor, action: 'feedback.beta_report' })

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
      await triage.prepare({
        reference,
        organizationPseudonym: betaFeedbackPseudonym(
          secret,
          'telemetry-organization',
          actor.organizationId,
        ),
        actorPseudonym: betaFeedbackPseudonym(secret, 'telemetry-actor', actor.userId),
        feedbackType: data.kind,
        impactCode: data.impact,
        routeKey: classifyBetaFeedbackRoute(data.routePath),
        viewport: data.viewport,
        reporterRole: actor.role,
        clientErrorEventId: data.clientErrorEventId,
        // The capture happened moments ago in the reporter's browser, but the
        // retention clock is the server's: a client clock must not be able to
        // mint a layout that outlives the accepted 30-day horizon.
        attachmentKind: data.maskedLayout ? 'masked_layout_v1' : 'none',
        attachmentCapturedAt: data.maskedLayout ? now : null,
        attachmentExpiresAt: data.maskedLayout ? maskedLayoutExpiry(now) : null,
        maskedLayout: data.maskedLayout,
        now,
      })

      const delivery = deliverBetaFeedback({
        data,
        actor,
        hmacSecret: secret,
        reference,
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

export const listMyBetaFeedbackHandler = createServerOnlyFn(
  async (): Promise<readonly BetaFeedbackReportView[]> => {
    const headers = await headersFromContext()
    const actor = await resolveTenantContext(headers)
    await requireExecutionAllowed({ actor, action: 'feedback.beta_report' })

    try {
      const { identityRequestSecurity, betaFeedbackTriageRepo: triage } = getContainer()
      // Scoping by the actor's own pseudonym is the authorization: the query
      // cannot express "somebody else's reports".
      return await triage.listForActor(
        betaFeedbackPseudonym(
          identityRequestSecurity.betaFeedbackHmacSecret,
          'telemetry-actor',
          actor.userId,
        ),
      )
    } catch (error) {
      throw catchUntagged(error)
    }
  },
)

export const listMyBetaFeedbackFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(listMyBetaFeedbackHandler, 'GET', 'identity.listMyBetaFeedback'),
)
