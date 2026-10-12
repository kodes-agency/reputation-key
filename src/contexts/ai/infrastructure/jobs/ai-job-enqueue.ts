// How AI work that is requested one item at a time becomes a queued job: the
// job name, the identifier-only payload, and the family's retry policy.
//
// Both families are property-scoped, and the delayed-execution gate reads the
// Organization and Property from the job payload alone. A job enqueued without
// them is denied `missing_scope` before its handler runs, and nothing else
// reports it: the scope below is what lets the work run at all.

import type { JobsOptions } from 'bullmq'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  type AnalyzeReviewNowJobData,
} from './analyze-review-now.job'
import {
  GENERATE_PROPERTY_TREND_JOB_NAME,
  parseGeneratePropertyTrendJobData,
  type GeneratePropertyTrendJobData,
} from './generate-property-trend.job'

type AiJobQueue = Readonly<{
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}>

/**
 * Queue one scheduled trend for its Property. The request is validated with
 * the schema the handler parses with, so the two cannot disagree.
 */
export const createPropertyTrendEnqueue =
  (queue: AiJobQueue) =>
  async (request: GeneratePropertyTrendJobData): Promise<void> => {
    const data = parseGeneratePropertyTrendJobData(request)
    await queue.add(GENERATE_PROPERTY_TREND_JOB_NAME, data, {
      jobId: `ai-trend-${data.scheduleId}`,
      ...jobEnqueueOptions(GENERATE_PROPERTY_TREND_JOB_NAME),
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    })
  }

/** Queue one opened review for analysis: its identifiers and nothing else. */
export const createAnalyzeReviewNowEnqueue =
  (queue: AiJobQueue) =>
  async (request: AnalyzeReviewNowJobData): Promise<void> => {
    await queue.add(
      ANALYZE_REVIEW_NOW_JOB_NAME,
      {
        organizationId: request.organizationId,
        propertyId: request.propertyId,
        reviewId: request.reviewId,
      },
      {
        // One waiting request per review: repeated opens coalesce.
        jobId: `ai-analysis-now-${request.reviewId}`,
        ...jobEnqueueOptions(ANALYZE_REVIEW_NOW_JOB_NAME),
        removeOnComplete: true,
        removeOnFail: { count: 50 },
      },
    )
  }
