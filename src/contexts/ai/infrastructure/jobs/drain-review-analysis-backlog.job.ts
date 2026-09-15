import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import type { DrainReviewAnalysisBacklogResult } from '../../application/use-cases/drain-review-analysis-backlog'

/**
 * Recurring drain of Review Analysis waiting for the background lane
 * (ADR 0058). Each tick claims a bounded, per-property share, so a long
 * history can never fan out into the queue; the admission lanes decide how
 * much of that share actually runs.
 */
export const DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME = 'ai-review-analysis-backlog-drain'

const drainJobData = z.object({}).strict()

export type DrainReviewAnalysisBacklogJobDependencies = Readonly<{
  drain: () => Promise<DrainReviewAnalysisBacklogResult>
  logger: Readonly<{
    info: (fields: Record<string, unknown>, message: string) => void
  }>
}>

export const createDrainReviewAnalysisBacklogJobHandler = (
  dependencies: DrainReviewAnalysisBacklogJobDependencies,
): ((job: Job) => Promise<void>) => {
  return async (job) => {
    drainJobData.parse(job.data ?? {})
    const outcome = await dependencies.drain()
    if (outcome.claimed === 0) return
    dependencies.logger.info(
      { job: DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME, ...outcome },
      'AI Review Analysis backlog drain completed',
    )
  }
}
