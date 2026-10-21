// Review context — what the publish-reply job and its read before the claim
// (publish-reply-preread.ts) share: the budget, the facts both end a cycle
// with, and the content-free way a failure is logged.

import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { Reply, Review } from '../../domain/types'
import { replyAuthor } from '../../domain/reply-author'
import {
  publicationFailureEvidence,
  type PublicationFailureCause,
} from '../../domain/reply-publication-workflow'
import {
  reviewReplyPublicationCancelled,
  reviewReplyPublishFailed,
  type ReplyPublishFailureOutcome,
} from '../../domain/events'
import type { LoggerPort } from '#/shared/domain/logger.port'

/** BullMQ's execution budget for one publish (event-job-catalogue.ts). */
export const MAX_PUBLISH_ATTEMPTS = 5

export type PublishCycleDeps = Readonly<{
  replyCommandStore: ReplyCommandStore
  clock: () => Date
  logger: Pick<LoggerPort, 'error' | 'info' | 'warn'>
}>

/** The publish_failed fact — identifier-only, propertyId from the parent review. */
export function buildPublishFailedEvent(
  review: Review,
  reply: Reply,
  occurredAt: Date,
  outcome: ReplyPublishFailureOutcome,
  cause: PublicationFailureCause | null = null,
) {
  return reviewReplyPublishFailed({
    replyId: reply.id,
    reviewId: reply.reviewId,
    propertyId: review.propertyId,
    organizationId: reply.organizationId,
    authorId: replyAuthor(reply),
    outcome,
    ...(cause === null ? {} : { cause }),
    occurredAt,
  })
}

/**
 * Cancel the cycle the way the archive consumer and a failed claim do: the
 * Reply returns to draft and one `publication_cancelled` fact is recorded. A
 * row whose state moved on since the caller read it is skipped, so a `false`
 * answer means somebody else already ended or advanced the cycle.
 */
export async function cancelPublicationCycle(
  deps: PublishCycleDeps,
  reply: Reply,
  review: Review,
  cause: 'policy' | 'provider_truth',
): Promise<boolean> {
  const now = deps.clock()
  const cancelled = await deps.replyCommandStore.cancelPublications([
    {
      reply,
      event: reviewReplyPublicationCancelled({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        authorId: replyAuthor(reply),
        cause,
        occurredAt: now,
      }),
      now,
    },
  ])
  return cancelled > 0
}

/**
 * RepKey's own authorizer refused the call because the Property is no longer
 * active at the cycle's source epoch: an Archive, Restore or relink committed
 * after the cycle was authorized. That is policy, not Google's answer, and must
 * never reach the author as "Google rejected the reply".
 */
export function refusedForPropertySource(err: unknown): boolean {
  const evidence = publicationFailureEvidence(err)
  return evidence.dispatch === 'not_sent' && evidence.executionCode === 'stale_source'
}

// Names are class-like identifiers (`DatabaseError`, `GoogleReviewApiError`);
// codes are closed-union words or SQLSTATEs (`provider_unavailable`, `40001`).
// Anything else is dropped rather than trusted: both fields come from an
// `unknown` rejection, and a free-form value could carry reply text.
const CONTENT_FREE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u
const CONTENT_FREE_ERROR_CODE = /^[A-Za-z0-9_]{1,64}$/u

export function contentFreeErrorIdentity(
  err: unknown,
): Readonly<{ errorName: string | null; errorCode: string | null }> {
  if (!(err instanceof Error)) return { errorName: null, errorCode: null }
  const code: unknown = 'code' in err ? err.code : undefined
  const codeText =
    typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : code
  return {
    errorName: CONTENT_FREE_ERROR_NAME.test(err.name) ? err.name : null,
    errorCode:
      typeof codeText === 'string' && CONTENT_FREE_ERROR_CODE.test(codeText)
        ? codeText
        : null,
  }
}
