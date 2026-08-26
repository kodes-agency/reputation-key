import { throwContextError } from '#/shared/auth/server-errors'
import type { BetaFeedbackInput } from '#/shared/beta-feedback-contract'
import {
  classifyBetaFeedbackRoute,
  formatBetaFeedbackMessage,
} from '#/shared/beta-feedback-contract'
import type { Role } from '#/shared/domain/roles'
import { captureObservabilityFeedback } from '#/shared/observability/telemetry'
import { betaFeedbackPseudonym } from './beta-feedback-rate-limit.server'

type Input = Readonly<{
  data: BetaFeedbackInput
  actor: Readonly<{
    userId: string
    organizationId: string
    role: Role
  }>
  hmacSecret: string
}>

/** Server-only Sentry delivery seam; never enters the browser module graph. */
export function deliverBetaFeedback(input: Input): string {
  const reference = captureObservabilityFeedback({
    message: formatBetaFeedbackMessage(input.data),
    source: 'repkey-native-beta-feedback',
    tags: {
      feedback_type: input.data.type,
      feedback_impact:
        input.data.type === 'bug' ? input.data.impact : input.data.importance,
      feedback_route: classifyBetaFeedbackRoute(input.data.routePath),
      feedback_actor: betaFeedbackPseudonym(
        input.hmacSecret,
        'telemetry-actor',
        input.actor.userId,
      ),
      feedback_organization: betaFeedbackPseudonym(
        input.hmacSecret,
        'telemetry-organization',
        input.actor.organizationId,
      ),
      feedback_viewport: input.data.viewport,
      feedback_role: input.actor.role,
    },
  })
  if (!reference) {
    throwContextError(
      'FeedbackError',
      {
        code: 'temporarily_unavailable',
        message: 'Beta feedback is temporarily unavailable. Please try again later.',
      },
      503,
    )
  }
  return reference
}
