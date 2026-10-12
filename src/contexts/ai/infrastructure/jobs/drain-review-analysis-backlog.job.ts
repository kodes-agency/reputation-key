import type { Job } from 'bullmq'
import { z } from 'zod/v4'
import type {
  AuthorizeReviewAnalysisScope,
  DrainReviewAnalysisBacklog,
} from '../../application/use-cases/drain-review-analysis-backlog'

/**
 * Recurring drain of Review Analysis waiting for the background lane
 * (ADR 0058). Each tick claims bounded, per-property rounds for a bounded
 * time, so a long history can never fan out into the queue; the admission
 * lanes decide how much of each round actually runs.
 *
 * The tenant-cross schedule is only the enumeration boundary: each claimed
 * entry's Organization and Property are decided again by `authorizeScope`
 * (capability, suspension, allowlist) before its review is analysed, and job
 * data carries no authority. A policy outage throws from `authorizeScope` and
 * fails the tick for a queue retry.
 */
export const DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME = 'ai-review-analysis-backlog-drain'

const drainJobData = z.object({}).strict()

export type DrainReviewAnalysisBacklogJobDependencies = Readonly<{
  drain: DrainReviewAnalysisBacklog['drain']
  authorizeScope: AuthorizeReviewAnalysisScope
  logger: Readonly<{
    info: (fields: Record<string, unknown>, message: string) => void
  }>
}>

export const createDrainReviewAnalysisBacklogJobHandler = (
  dependencies: DrainReviewAnalysisBacklogJobDependencies,
): ((job: Job) => Promise<void>) => {
  return async (job) => {
    drainJobData.parse(job.data ?? {})
    const outcome = await dependencies.drain({
      authorizeScope: dependencies.authorizeScope,
    })
    if (outcome.claimed === 0) return
    dependencies.logger.info(
      { job: DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME, ...outcome },
      'AI Review Analysis backlog drain completed',
    )
  }
}
