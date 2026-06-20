// Invariant: reviews past the response SLA without a published reply are
// surfaced as warnings. Catches SLA-tracking gaps and stale reply states.
// Uses the injected clock (ADR 0017) for deterministic time-dependent checks.

import type { ReviewRepository } from '#/contexts/review/application/ports/review.repository'
import type { ReplyRepository } from '#/contexts/review/application/ports/reply.repository'
import type { Clock } from '#/shared/domain/clock'
import { organizationId } from '#/shared/domain/ids'
import { slaCutoff } from '#/contexts/dashboard/application/utils'
import type { InvariantChecker } from '../types'

export type SlaConsistencyDeps = Readonly<{
  reviewRepo: Pick<ReviewRepository, 'findByOrganizationId'>
  replyRepo: Pick<ReplyRepository, 'findByReviewId'>
  clock: Clock
}>

const MS_PER_HOUR = 3_600_000
const MAX_REVIEWS_TO_CHECK = 500

export const slaConsistency = (deps: SlaConsistencyDeps): InvariantChecker => ({
  id: 'sla-consistency',
  description: 'Reviews past SLA without a published reply are identified',
  async check(ctx) {
    const orgId = organizationId(ctx.organizationId)
    const slaHours = ctx.slaHours ?? 48
    const reviews = await deps.reviewRepo.findByOrganizationId(orgId)
    const violations = []
    const now = deps.clock()
    const cutoff = slaCutoff(now, slaHours)

    for (const review of reviews.slice(0, MAX_REVIEWS_TO_CHECK)) {
      if (review.reviewedAt >= cutoff) continue

      const replies = await deps.replyRepo.findByReviewId(review.id, orgId)
      const hasPublished = replies.some((r) => r.status === 'published')

      if (!hasPublished) {
        const hoursPast = Math.round(
          (now.getTime() - review.reviewedAt.getTime()) / MS_PER_HOUR,
        )
        violations.push({
          checker: 'sla-consistency',
          severity: 'warning' as const,
          message: `Review ${review.id} is ${hoursPast}h old (SLA: ${slaHours}h) with no published reply`,
          evidence: {
            reviewId: review.id,
            propertyId: review.propertyId,
            reviewedAt: review.reviewedAt.toISOString(),
            hoursPastSla: hoursPast - slaHours,
          },
        })
      }
    }

    return violations
  },
})
