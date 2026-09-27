// Identity context — submit beta feedback use case.
//
// The request boundary has already authenticated the reporter, checked
// `feedback.beta_report` and spent the abuse budget. This records the
// content-free triage row (with its optional masked layout) first, hands the
// report to monitoring, then settles the row's delivery state.

import { maskedLayoutExpiry } from '#/shared/beta-feedback-layout'
import {
  type BetaFeedbackInput,
  classifyBetaFeedbackRoute,
} from '#/shared/beta-feedback-contract'
import { betaFeedbackError } from '../../domain/errors'
import { betaFeedbackPseudonym } from '../beta-feedback-pseudonym'
import type {
  BetaFeedbackActor,
  BetaFeedbackDelivery,
  BetaFeedbackSubmissionStore,
} from '../ports/beta-feedback-submission.port'

export type SubmitBetaFeedbackInput = Readonly<{
  actor: BetaFeedbackActor
  data: BetaFeedbackInput
}>
export type SubmitBetaFeedbackOutput = Readonly<{ reference: string }>
export type SubmitBetaFeedbackDeps = Readonly<{
  store: Pick<BetaFeedbackSubmissionStore, 'prepare' | 'markDelivered' | 'markFailed'>
  deliver: BetaFeedbackDelivery
  clock: () => Date
  idGen: () => string
  /** Keys the telemetry pseudonyms; never leaves the server. */
  hmacSecret: string
}>
export type SubmitBetaFeedback = ReturnType<typeof submitBetaFeedback>

/** A prepared row starts at revision 0; delivery settles it exactly once. */
const PREPARED_REVISION = 0

/**
 * Submit one beta-feedback report.
 *
 * Steps:
 * 1. Persist — prepare the triage row before anything leaves the server
 * 2. Deliver — hand the report to monitoring
 * 3. Persist — settle the row as delivered or failed
 * 4. Return — the opaque reference, or a BetaFeedbackError to retry
 */
export const submitBetaFeedback =
  (deps: SubmitBetaFeedbackDeps) =>
  async ({ actor, data }: SubmitBetaFeedbackInput): Promise<SubmitBetaFeedbackOutput> => {
    const now = deps.clock()
    const reference = deps.idGen()
    await deps.store.prepare({
      reference,
      organizationPseudonym: betaFeedbackPseudonym(
        deps.hmacSecret,
        'telemetry-organization',
        actor.organizationId,
      ),
      actorPseudonym: betaFeedbackPseudonym(
        deps.hmacSecret,
        'telemetry-actor',
        actor.userId,
      ),
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

    const delivery = deps.deliver({ data, actor, hmacSecret: deps.hmacSecret, reference })
    if (delivery.status === 'failed') {
      await deps.store.markFailed({
        reference,
        failureCode: delivery.failureCode,
        expectedRevision: PREPARED_REVISION,
        now,
      })
      throw betaFeedbackError(
        'temporarily_unavailable',
        'Beta feedback is temporarily unavailable. Please try again later.',
      )
    }
    await deps.store.markDelivered({
      reference,
      providerReference: delivery.providerReference,
      expectedRevision: PREPARED_REVISION,
      now,
    })
    return { reference }
  }
