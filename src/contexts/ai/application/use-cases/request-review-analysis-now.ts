import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { resolveAiReadGate, type AiReadGateDependencies } from '../ai-read-gate'
import type { AiReviewAnalysisBacklogPort } from '../ports/ai-review-analysis-backlog.port'

export type RequestReviewAnalysisNowResult = Readonly<{
  status: 'queued' | 'not_pending' | 'disabled'
}>

export type RequestReviewAnalysisNowDependencies = AiReadGateDependencies &
  Readonly<{
    backlog: Pick<AiReviewAnalysisBacklogPort, 'hasPendingForReview'>
    /** Hands the review to the worker, which analyses it on the interactive lane. */
    enqueueReviewAnalysisNow: (
      input: Readonly<{
        organizationId: OrganizationId
        propertyId: PropertyId
        reviewId: ReviewId
      }>,
    ) => Promise<void>
  }>

/**
 * A manager opened a review whose analysis is still waiting in the backlog.
 * Ask the worker to analyse that one review ahead of the queue. Nothing runs
 * in the request: analysis is worker-only, and the answer only says whether
 * there was anything to hurry.
 */
export function createRequestReviewAnalysisNow(
  dependencies: RequestReviewAnalysisNowDependencies,
) {
  return async (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
    }>,
  ): Promise<RequestReviewAnalysisNowResult> => {
    const gate = await resolveAiReadGate(dependencies, input, 'review_analysis')
    if (gate.status === 'disabled') return { status: 'disabled' }
    if (!(await dependencies.backlog.hasPendingForReview(input))) {
      return { status: 'not_pending' }
    }
    await dependencies.enqueueReviewAnalysisNow(input)
    return { status: 'queued' }
  }
}
