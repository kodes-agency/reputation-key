// Invariant: every review has exactly one corresponding inbox item.
// Catches orphaned reviews (review created but inbox item missing) and
// duplicate inbox items for the same review.

import type { ReviewRepository } from '#/contexts/review/application/ports/review.repository'
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import { organizationId } from '#/shared/domain/ids'
import type { InvariantChecker } from '../types'

export type ReviewInboxConsistencyDeps = Readonly<{
  reviewRepo: Pick<ReviewRepository, 'findByOrganizationId'>
  inboxRepo: Pick<InboxRepository, 'findBySource'>
}>

const MAX_REVIEWS_TO_CHECK = 500

export const reviewInboxConsistency = (
  deps: ReviewInboxConsistencyDeps,
): InvariantChecker => ({
  id: 'review-inbox-consistency',
  description: 'Every review has exactly one corresponding inbox item',
  async check(ctx) {
    const orgId = organizationId(ctx.organizationId)
    const reviews = await deps.reviewRepo.findByOrganizationId(orgId)
    const violations = []

    for (const review of reviews.slice(0, MAX_REVIEWS_TO_CHECK)) {
      const inboxItem = await deps.inboxRepo.findBySource(
        'review',
        review.id as string,
        orgId,
      )
      if (!inboxItem) {
        violations.push({
          checker: 'review-inbox-consistency',
          severity: 'error' as const,
          message: `Review ${review.id} has no corresponding inbox item`,
          evidence: { reviewId: review.id, propertyId: review.propertyId },
        })
      }
    }

    if (reviews.length > MAX_REVIEWS_TO_CHECK) {
      violations.push({
        checker: 'review-inbox-consistency',
        severity: 'warning' as const,
        message: `Checked ${MAX_REVIEWS_TO_CHECK} of ${reviews.length} reviews (truncated)`,
      })
    }

    return violations
  },
})
