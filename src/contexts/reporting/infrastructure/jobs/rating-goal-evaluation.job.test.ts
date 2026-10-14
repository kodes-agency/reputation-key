import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import {
  RatingGoalSweepError,
  type AuthorizeRatingGoalScope,
  type RatingGoalSweepStats,
} from '../../application/use-cases/rating-goal-sweep'
import {
  createRatingGoalEvaluationJobHandler,
  RATING_GOAL_EVALUATION_JOB_NAME,
} from './rating-goal-evaluation.job'

const job = {} as Job

const stats = (overrides: Partial<RatingGoalSweepStats> = {}): RatingGoalSweepStats => ({
  inspected: 3,
  evaluated: 2,
  denied: 1,
  notices: 1,
  failed: 0,
  failureCauses: {},
  ...overrides,
})

const logger = () => ({ info: vi.fn(), warn: vi.fn() })

describe('the daily rating goal evaluation job', () => {
  it('runs the sweep with the schedule’s own scope authorizer and logs counts only', async () => {
    const authorizeScope: AuthorizeRatingGoalScope = async () => true
    const sweep = vi.fn(async () => stats())
    const log = logger()

    await createRatingGoalEvaluationJobHandler({ sweep, authorizeScope, logger: log })(
      job,
    )

    expect(sweep).toHaveBeenCalledWith(authorizeScope)
    expect(log.info).toHaveBeenCalledWith(
      { jobName: RATING_GOAL_EVALUATION_JOB_NAME, ...stats() },
      'Rating goal evaluation completed',
    )
  })

  it('stays quiet when there is no active goal', async () => {
    const log = logger()

    await createRatingGoalEvaluationJobHandler({
      sweep: async () => stats({ inspected: 0, evaluated: 0, denied: 0, notices: 0 }),
      authorizeScope: async () => true,
      logger: log,
    })(job)

    expect(log.info).not.toHaveBeenCalled()
  })

  it('logs the failed counts and fails the job for the queue’s retry', async () => {
    const failed = stats({ failed: 1, failureCauses: { sqlstate_08006: 1 } })
    const log = logger()
    const handler = createRatingGoalEvaluationJobHandler({
      sweep: async () => {
        throw new RatingGoalSweepError(failed)
      },
      authorizeScope: async () => true,
      logger: log,
    })

    await expect(handler(job)).rejects.toBeInstanceOf(RatingGoalSweepError)
    expect(log.warn).toHaveBeenCalledWith(
      { jobName: RATING_GOAL_EVALUATION_JOB_NAME, ...failed },
      'Rating goal evaluation: goals failed',
    )
  })
})
