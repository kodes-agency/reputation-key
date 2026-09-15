// D4: the one place an uncertain publication attempt can become "safe to send
// again" — and only on positive evidence that no request for it left RepKey.
//
// A Google read that omits the reply is never that evidence (Google may accept
// a reply and not echo it). The evidence is the absence of a `reviews.reply`
// execution permit for this exact reply/cycle/attempt once no in-flight call
// can still create one (reply-publication-dispatch-evidence.port.ts). Every
// other answer leaves the attempt exactly as uncertain as it was.
//
// Callers: "Check Google again" (check-reply-publication.ts) and "Try
// publishing again" (reply-operations.ts retryPublish). The helper never reads
// Google and never authorizes or enqueues anything.

import type { PropertyId } from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import { reviewReplyPublishFailed } from '../../domain/events'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type {
  ReplyDispatchEvidence,
  ReplyPublicationDispatchEvidencePort,
} from '../ports/reply-publication-dispatch-evidence.port'

export type NeverDispatchedSettlementDeps = Readonly<{
  replyRepo: Pick<ReplyRepository, 'findCurrentPublicationAttemptStartedAt'>
  commandStore: Pick<ReplyCommandStore, 'settleNeverDispatchedAttempt'>
  dispatchEvidence: ReplyPublicationDispatchEvidencePort
  clock: () => Date
}>

export type NeverDispatchedSettlement =
  /** The attempt is now publish_failed / terminal / retryable. */
  | Readonly<{ kind: 'settled'; reply: Reply; settledAt: Date }>
  /** Nothing proves non-dispatch; the reply is unchanged. */
  | Readonly<{
      kind: 'unproven'
      evidence: Exclude<ReplyDispatchEvidence, 'never_dispatched'>
    }>
  /** The evidence held, but the reply moved on before the guarded write, or the
   * store's re-read under the attempt lock found a permit admitted since. */
  | Readonly<{ kind: 'superseded' }>

/**
 * The states the settle command accepts (reply-command-store.port.ts
 * settleNeverDispatchedAttempt), each naming one exact provider attempt.
 * `pending_observation` is absent on purpose: Google acknowledged that write.
 */
export function isUncertainPublicationAttempt(reply: Reply): boolean {
  if (reply.publicationCycle < 1 || reply.publicationAttempts < 1) return false
  if (reply.status === 'approved') return reply.publicationState === 'sending'
  if (reply.status !== 'publish_failed') return false
  return (
    reply.publicationState === 'ambiguous' ||
    (reply.publicationState === 'terminal' &&
      reply.publicationLastErrorClass === 'ambiguous')
  )
}

const POSSIBLY_DISPATCHED: NeverDispatchedSettlement = Object.freeze({
  kind: 'unproven',
  evidence: 'possibly_dispatched',
})

export async function settleIfNeverDispatched(
  deps: NeverDispatchedSettlementDeps,
  input: Readonly<{ reply: Reply; propertyId: PropertyId }>,
): Promise<NeverDispatchedSettlement> {
  const { reply } = input
  if (!isUncertainPublicationAttempt(reply)) return POSSIBLY_DISPATCHED

  const attemptStartedAt = await deps.replyRepo.findCurrentPublicationAttemptStartedAt({
    organizationId: reply.organizationId,
    reviewId: reply.reviewId,
    replyId: reply.id,
    publicationCycle: reply.publicationCycle,
    attemptNumber: reply.publicationAttempts,
  })
  // No attempt row means nothing dates the attempt, so nothing can prove it.
  if (attemptStartedAt === null) return POSSIBLY_DISPATCHED

  const now = deps.clock()
  const evidence = await deps.dispatchEvidence.findDispatchEvidence({
    organizationId: reply.organizationId,
    replyId: reply.id,
    publicationCycle: reply.publicationCycle,
    attemptNumber: reply.publicationAttempts,
    attemptStartedAt,
    now,
  })
  if (evidence !== 'never_dispatched') return { kind: 'unproven', evidence }

  // The store records this fact only when the row was not already
  // publish_failed, so a manager is not told about the same failure twice.
  const event = reviewReplyPublishFailed({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: input.propertyId,
    organizationId: reply.organizationId,
    authorId: reply.createdBy,
    occurredAt: now,
  })
  const settled = await deps.commandStore.settleNeverDispatchedAttempt(reply, event, now)
  return settled === null
    ? { kind: 'superseded' }
    : { kind: 'settled', reply: settled, settledAt: now }
}
