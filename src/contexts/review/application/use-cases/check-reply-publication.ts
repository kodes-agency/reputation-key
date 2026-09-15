// D5 — "Check Google again". A manager's check returns what RepKey found; only
// a missing reply, a refusal or an unreachable Google is an error.
//
// Before this, the check ran through retryPublish, whose uncertain branch threw
// `invalid_transition` for every read that did not confirm the reply. A reply
// that never reached Google (b129e390: refused at compile, no permit, no fetch)
// therefore stayed stuck forever, and the thrown error was swallowed by the
// button (reply-message-actions.tsx). The check now:
//   1. asks for positive non-dispatch evidence (settle-never-dispatched-attempt.ts)
//      and, when it holds, settles the attempt as never sent — no Google read;
//   2. otherwise makes one targeted, read-only reconciliation;
//   3. re-reads the reply and reports the outcome with the next automatic check.
// Its deps carry no queue and no Google client: it cannot publish, authorize a
// cycle or enqueue a job.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ReviewId } from '#/shared/domain/ids'
import type { Reply } from '../../domain/types'
import { reviewError } from '../../domain/errors'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { ReplyPublicationDispatchEvidencePort } from '../ports/reply-publication-dispatch-evidence.port'
import type {
  ReconcilePublicationOutcome,
  ReconcileReplyPublication,
} from './reconcile-reply-publication'
import { isSettledPublishedReply, requireAccessibleReply } from './reply-operations'
import {
  isUncertainPublicationAttempt,
  settleIfNeverDispatched,
} from './settle-never-dispatched-attempt'

export type ReplyPublicationCheckOutcome =
  /** Confirmed now, or already published. */
  | 'live_on_google'
  /** Absent; the attempt may still have been sent, so it stays check-only. */
  | 'not_on_google'
  /** Positive evidence settled it as never sent; publishing again is safe. */
  | 'never_sent'
  /** Google shows another reply on this review. */
  | 'different_reply_on_google'
  /** Google shows a reply RepKey can't read; automatic checks continue. */
  | 'unreadable_on_google'
  | 'review_missing_on_google'
  | 'cancelled'

export type ReplyPublicationCheckResult = Readonly<{
  reply: Reply
  outcome: ReplyPublicationCheckOutcome
  checkedAt: Date
  /** `reply.reconcileDueAt` after the check, while automatic checks continue. */
  nextAutomaticCheckAt: Date | null
}>

export type CheckReplyPublicationDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  staffPublicApi: StaffPublicApi
  commandStore: Pick<ReplyCommandStore, 'settleNeverDispatchedAttempt'>
  dispatchEvidence: ReplyPublicationDispatchEvidencePort
  /** Read-only targeted reconciliation; it never calls the publish endpoint. */
  reconcileReplyPublication: ReconcileReplyPublication
  clock: () => Date
  /** Content-free: codes and reasons only, never reply or review text. */
  logger: Pick<LoggerPort, 'info'>
}>

export type CheckReplyPublicationInput = Readonly<{ reviewId: ReviewId }>

const NOTHING_TO_CHECK = 'This reply has nothing to check on Google.'
const GOOGLE_UNREACHABLE =
  "RepKey couldn't reach Google to check this reply. Try again in a minute."

/** Every state whose Google truth is still open (D5 "Checkable"). */
function isCheckable(reply: Reply): boolean {
  if (reply.status === 'approved') {
    return (
      reply.publicationState === 'sending' ||
      reply.publicationState === 'pending_observation'
    )
  }
  return (
    reply.status === 'publish_failed' &&
    (reply.publicationState === 'ambiguous' ||
      (reply.publicationState === 'terminal' &&
        reply.publicationLastErrorClass === 'ambiguous'))
  )
}

const READ_OUTCOMES: Readonly<
  Record<ReconcilePublicationOutcome['outcome'], ReplyPublicationCheckOutcome>
> = {
  confirmed_on_google: 'live_on_google',
  absent: 'not_on_google',
  external_current_live: 'different_reply_on_google',
  diverged: 'different_reply_on_google',
  provider_review_missing: 'review_missing_on_google',
  unreadable: 'unreadable_on_google',
}

/**
 * A definite provider answer names itself. A read that decided nothing
 * (absent, unreadable, missing review) defers to a settlement another writer
 * committed while the read was in flight.
 */
function outcomeAfterRead(
  read: ReconcilePublicationOutcome['outcome'],
  current: Reply,
): ReplyPublicationCheckOutcome {
  const mapped = READ_OUTCOMES[read]
  if (mapped === 'live_on_google' || mapped === 'different_reply_on_google') return mapped
  if (isSettledPublishedReply(current)) return 'live_on_google'
  if (current.publicationState === 'cancelled') return 'cancelled'
  return mapped
}

const resultFor = (
  reply: Reply,
  outcome: ReplyPublicationCheckOutcome,
  checkedAt: Date,
): ReplyPublicationCheckResult => ({
  reply,
  outcome,
  checkedAt,
  nextAutomaticCheckAt: reply.reconcileDueAt,
})

async function requireCurrentReply(
  deps: CheckReplyPublicationDeps,
  reply: Reply,
): Promise<Reply> {
  const current = await deps.replyRepo.findById(reply.id, reply.organizationId)
  if (!current) throw reviewError('reply_not_found', 'Reply not found')
  return current
}

async function readGoogle(
  deps: CheckReplyPublicationDeps,
  reply: Reply,
): Promise<ReplyPublicationCheckResult> {
  const reconciled = await deps.reconcileReplyPublication({
    replyId: reply.id,
    organizationId: reply.organizationId,
  })
  const checkedAt = deps.clock()
  const current = await requireCurrentReply(deps, reply)
  if (reconciled.isOk() && reconciled.value.outcome === 'unreadable') {
    // D6: the sweep and the job log the same reason for the same read.
    deps.logger.info(
      { reason: reconciled.value.reason ?? null },
      'Check Google again: Google shows a reply RepKey cannot match to this attempt',
    )
  }
  if (reconciled.isOk()) {
    return resultFor(
      current,
      outcomeAfterRead(reconciled.value.outcome, current),
      checkedAt,
    )
  }

  // The read failed, but another writer may already have settled the reply.
  if (isSettledPublishedReply(current))
    return resultFor(current, 'live_on_google', checkedAt)
  if (current.publicationState === 'cancelled') {
    return resultFor(current, 'cancelled', checkedAt)
  }
  const { code, context } = reconciled.error
  if (code === 'sync_failed') {
    throw reviewError('sync_failed', GOOGLE_UNREACHABLE, context)
  }
  // The reply left every checkable state before the read began.
  if (code === 'invalid_transition')
    throw reviewError('invalid_transition', NOTHING_TO_CHECK)
  throw reconciled.error
}

export const checkReplyPublication =
  (deps: CheckReplyPublicationDeps) =>
  async (
    input: CheckReplyPublicationInput,
    ctx: AuthContext,
  ): Promise<ReplyPublicationCheckResult> => {
    // Same manager + tenant + Property prologue as retryPublish.
    const { reply, review } = await requireAccessibleReply(deps, ctx, input.reviewId)

    // A second click that lands after the first one confirmed the reply.
    if (isSettledPublishedReply(reply)) {
      return resultFor(reply, 'live_on_google', deps.clock())
    }
    if (!isCheckable(reply)) throw reviewError('invalid_transition', NOTHING_TO_CHECK)

    if (isUncertainPublicationAttempt(reply)) {
      const settlement = await settleIfNeverDispatched(deps, {
        reply,
        propertyId: review.propertyId,
      })
      if (settlement.kind === 'settled') {
        return resultFor(settlement.reply, 'never_sent', settlement.settledAt)
      }
      // `unproven` leaves the attempt as uncertain as it was; `superseded` means
      // another writer moved it, and the read below re-validates the state.
    }
    return readGoogle(deps, reply)
  }

export type CheckReplyPublication = ReturnType<typeof checkReplyPublication>
