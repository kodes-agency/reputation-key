// How AI work that is requested one item at a time becomes a queued job: the
// job name, the identifier-only payload, and the family's retry policy.
//
// Review analysis is property-scoped, and the delayed-execution gate reads the
// Organization and Property from the job payload alone. A job enqueued without
// them is denied `missing_scope` before its handler runs, and nothing else
// reports it: the scope below is what lets the work run at all.

import type { JobsOptions } from 'bullmq'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  type AnalyzeReviewNowJobData,
} from './analyze-review-now.job'

type AiJobQueue = Readonly<{
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>
}>

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
        // BullMQ ignores an add under an id it still holds, and the family has
        // one attempt: a failed job kept in the failed set would swallow every
        // later request for its review while the caller is told `queued`. The
        // dead letter stays in quarantine; the review stays in the backlog.
        // The price: a quarantine copy whose confirmation never landed (the
        // worker died between the failure and confirming it) cannot be
        // redriven, because a redrive promotes such a copy only on the proof
        // of its failed original (`createRedriveJob`). It can be discarded.
        removeOnFail: true,
      },
    )
  }
