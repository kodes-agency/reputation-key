import {
  type BetaFeedbackInput,
  classifyBetaFeedbackRoute,
  formatBetaFeedbackMessage,
} from '#/shared/beta-feedback-contract'
import type { BetaFeedbackScreenshotType } from '#/shared/beta-feedback-screenshot'
import {
  captureObservabilityFeedback,
  type FeedbackAttachment,
} from '#/shared/observability/telemetry'
import { betaFeedbackPseudonym } from '../../application/beta-feedback-pseudonym'
import type { BetaFeedbackDelivery } from '../../application/ports/beta-feedback-submission.port'

const SCREENSHOT_EXTENSIONS: Readonly<Record<BetaFeedbackScreenshotType, string>> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** The contract checked the bytes start like their type; here they become the file. */
function screenshotAttachments(data: BetaFeedbackInput): FeedbackAttachment[] {
  if (!data.screenshot) return []
  const { mediaType, base64 } = data.screenshot
  return [
    {
      filename: `screenshot.${SCREENSHOT_EXTENSIONS[mediaType]}`,
      data: new Uint8Array(Buffer.from(base64, 'base64')),
      contentType: mediaType,
    },
  ]
}

/** Server-only Sentry delivery seam; never enters the browser module graph. */
export const deliverBetaFeedback: BetaFeedbackDelivery = (input) => {
  const providerReference = captureObservabilityFeedback({
    message: formatBetaFeedbackMessage(input.data),
    source: 'repkey-native-beta-feedback',
    attachments: screenshotAttachments(input.data),
    ...(input.reporter ? { reporter: input.reporter } : {}),
    tags: {
      feedback_type: input.data.kind,
      feedback_impact: input.data.impact,
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
      feedback_reference: input.reference,
      feedback_client_error: input.data.clientErrorEventId ?? 'none',
      feedback_attachment: input.data.maskedLayout ? 'masked_layout_v1' : 'none',
      feedback_attachment_retention: input.data.maskedLayout
        ? 'expires_30d'
        : 'not_applicable',
      feedback_triage_state: 'new',
      feedback_triage_owner: 'beta_support',
      feedback_triage_severity: 'unclassified',
      feedback_triage_privacy: 'pending',
      feedback_triage_security: 'pending',
      feedback_triage_reproduction: 'pending',
      feedback_triage_dedupe: 'pending',
      feedback_customer_response: 'pending',
    },
  })
  if (!providerReference) {
    return { status: 'failed', failureCode: 'monitoring_unavailable' }
  }
  if (!/^[a-f0-9]{32,64}$/u.test(providerReference)) {
    return { status: 'failed', failureCode: 'monitoring_invalid_reference' }
  }
  return { status: 'delivered', providerReference }
}
