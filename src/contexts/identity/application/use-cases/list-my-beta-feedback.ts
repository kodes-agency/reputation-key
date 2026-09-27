// Identity context — list my beta feedback use case.
//
// One reporter's own reports, newest first, as the narrow reporter view: no
// severity, owner, privacy or security classification crosses back.

import { betaFeedbackPseudonym } from '../beta-feedback-pseudonym'
import type {
  BetaFeedbackActor,
  BetaFeedbackReporterItem,
  BetaFeedbackSubmissionStore,
} from '../ports/beta-feedback-submission.port'

export type ListMyBetaFeedbackInput = Readonly<{
  actor: Pick<BetaFeedbackActor, 'userId'>
}>
export type ListMyBetaFeedbackDeps = Readonly<{
  store: Pick<BetaFeedbackSubmissionStore, 'listForActor'>
  /** Keys the telemetry pseudonyms; never leaves the server. */
  hmacSecret: string
}>
export type ListMyBetaFeedback = ReturnType<typeof listMyBetaFeedback>

export const listMyBetaFeedback =
  (deps: ListMyBetaFeedbackDeps) =>
  async ({
    actor,
  }: ListMyBetaFeedbackInput): Promise<readonly BetaFeedbackReporterItem[]> =>
    // Scoping by the actor's own pseudonym is the authorization: the query
    // cannot express "somebody else's reports".
    deps.store.listForActor(
      betaFeedbackPseudonym(deps.hmacSecret, 'telemetry-actor', actor.userId),
    )
