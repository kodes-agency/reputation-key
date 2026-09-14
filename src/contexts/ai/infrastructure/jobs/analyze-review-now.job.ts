import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { RequestReviewAnalysisResult } from '../../application/use-cases/drain-review-analysis-backlog'

/**
 * One review a manager opened, analysed ahead of the backlog on the
 * interactive lane. Identifier-only payload; a busy lane leaves the review
 * queued with interactive priority rather than retrying here.
 */
export const ANALYZE_REVIEW_NOW_JOB_NAME = 'ai-review-analysis-on-demand'

export const analyzeReviewNowJobData = z
  .object({
    organizationId: z.string().min(1).max(255),
    propertyId: z.uuid(),
    reviewId: z.uuid(),
  })
  .strict()

export type AnalyzeReviewNowJobData = z.infer<typeof analyzeReviewNowJobData>

export type AnalyzeReviewNowJobDependencies = Readonly<{
  drainReview: (
    input: Readonly<{
      organizationId: ReturnType<typeof organizationId>
      propertyId: ReturnType<typeof propertyId>
      reviewId: ReturnType<typeof reviewId>
    }>,
  ) => Promise<RequestReviewAnalysisResult>
}>

export const createAnalyzeReviewNowJobHandler = (
  dependencies: AnalyzeReviewNowJobDependencies,
): ((job: Job) => Promise<void>) => {
  return async (job) => {
    const data = analyzeReviewNowJobData.parse(job.data)
    await dependencies.drainReview({
      organizationId: organizationId(data.organizationId),
      propertyId: propertyId(data.propertyId),
      reviewId: reviewId(data.reviewId),
    })
  }
}
