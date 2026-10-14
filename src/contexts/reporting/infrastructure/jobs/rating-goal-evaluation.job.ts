// The daily evaluation of every active Property Google rating goal.
//
// The recurring job is content-free and tenant-cross: the use case lists
// active goals by identifier and asks `authorizeScope` (the schedule's own
// action under goal.use) about each goal's Organization and Property before it
// reads or writes anything of theirs (application/use-cases/rating-goal-sweep.ts).
// Counts only reach the log: tenant identifiers are never log fields (BQC-7.3).

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  RatingGoalSweepError,
  type AuthorizeRatingGoalScope,
  type RatingGoalSweepStats,
} from '../../application/use-cases/rating-goal-sweep'

export const RATING_GOAL_EVALUATION_JOB_NAME = 'rating-goal.evaluate' as const

export type RatingGoalEvaluationJobDependencies = Readonly<{
  sweep: (authorize: AuthorizeRatingGoalScope) => Promise<RatingGoalSweepStats>
  authorizeScope: AuthorizeRatingGoalScope
  logger: Pick<LoggerPort, 'info' | 'warn'>
}>

export const createRatingGoalEvaluationJobHandler =
  (deps: RatingGoalEvaluationJobDependencies) =>
  async (_job: Job): Promise<void> => {
    try {
      const stats = await deps.sweep(deps.authorizeScope)
      if (stats.inspected === 0) return
      deps.logger.info(
        { jobName: RATING_GOAL_EVALUATION_JOB_NAME, ...stats },
        'Rating goal evaluation completed',
      )
    } catch (error) {
      if (error instanceof RatingGoalSweepError) {
        deps.logger.warn(
          { jobName: RATING_GOAL_EVALUATION_JOB_NAME, ...error.stats },
          'Rating goal evaluation: goals failed',
        )
      }
      throw error
    }
  }
