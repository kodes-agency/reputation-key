// Invariant: reviews with a published reply have their inbox item closed.
// Catches stale inbox items after a reply is published — a common
// cross-context sync bug. (ADR 0023: status is open/closed.)
//
// "Published" is Review's reply truth, not only RepKey's replies: a reply
// written on Google exists only as the observation head (the legacy
// `google_sync` row is deleted once one is recorded). It counts when it
// answers the review's current revision — what closes the Inbox cycle; a
// reply carried over a guest edit answers an earlier revision and does not.

import type { ReviewRepository } from '#/contexts/review/application/ports/review.repository'
import type { ReplyRepository } from '#/contexts/review/application/ports/reply.repository'
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import { isAnsweringGoogleReply } from '#/contexts/inbox/domain/rules'
import { organizationId } from '#/shared/domain/ids'
import type { InvariantChecker } from '../types'

export type InboxStatusLegalDeps = Readonly<{
  reviewRepo: Pick<ReviewRepository, 'findByOrganizationId'>
  replyRepo: Pick<
    ReplyRepository,
    'findByReviewId' | 'findCurrentGoogleReplyHeadsByReviewIds'
  >
  inboxRepo: Pick<InboxRepository, 'findBySource'>
}>

const MAX_REVIEWS_TO_CHECK = 500

export const inboxStatusLegal = (deps: InboxStatusLegalDeps): InvariantChecker => ({
  id: 'inbox-status-legal',
  description: 'Reviews with a published reply have their inbox item closed',
  async check(ctx) {
    const orgId = organizationId(ctx.organizationId)
    const reviews = await deps.reviewRepo.findByOrganizationId(orgId)
    const checked = reviews.slice(0, MAX_REVIEWS_TO_CHECK)
    const heads = new Map(
      (
        await deps.replyRepo.findCurrentGoogleReplyHeadsByReviewIds(
          checked.map((review) => review.id),
          orgId,
        )
      ).map((head) => [head.reviewId as string, head]),
    )
    const violations = []

    for (const review of checked) {
      const replies = await deps.replyRepo.findByReviewId(review.id, orgId)
      const head = heads.get(review.id as string)
      const answeredOnGoogle =
        head !== undefined &&
        isAnsweringGoogleReply(head) &&
        head.materialReviewRevision === review.sourceRevision
      const hasPublished =
        replies.some((r) => r.status === 'published') || answeredOnGoogle
      if (!hasPublished) continue

      const inboxItem = await deps.inboxRepo.findBySource(
        'review',
        review.id as string,
        orgId,
      )
      if (inboxItem && inboxItem.status === 'open') {
        violations.push({
          checker: 'inbox-status-legal',
          severity: 'error' as const,
          message: `Review ${review.id} has a published reply but inbox item is 'open' (expected 'closed')`,
          evidence: {
            reviewId: review.id,
            inboxItemId: inboxItem.id,
            currentStatus: inboxItem.status,
          },
        })
      }
    }

    // This checker is ERROR severity: a silent prefix scan would report
    // "All invariant checks passed" while leaving reviews 501..N unexamined.
    // Truncation is therefore itself an error — the gate must not claim a
    // verdict it did not compute.
    if (reviews.length > MAX_REVIEWS_TO_CHECK) {
      violations.push({
        checker: 'inbox-status-legal',
        severity: 'error' as const,
        message: `Checked only ${MAX_REVIEWS_TO_CHECK} of ${reviews.length} reviews (truncated) — the remaining ${reviews.length - MAX_REVIEWS_TO_CHECK} were never examined`,
        evidence: {
          reviewsChecked: MAX_REVIEWS_TO_CHECK,
          reviewsTotal: reviews.length,
          reviewsUnchecked: reviews.length - MAX_REVIEWS_TO_CHECK,
        },
      })
    }

    return violations
  },
})
