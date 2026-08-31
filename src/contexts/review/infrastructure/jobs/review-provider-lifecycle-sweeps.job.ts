import type { Job } from 'bullmq'
import { reviewId } from '#/shared/domain/ids'
import type { ReviewProviderSnapshotRepository } from '../../application/ports/review-provider-snapshot.repository'
import { trace } from '#/shared/observability/trace'

export const EXPIRE_REVIEW_PROVIDER_SOURCE_JOB_NAME =
  'expire-review-provider-source' as const
export const SWEEP_REVIEW_PROVIDER_TOMBSTONES_JOB_NAME =
  'sweep-review-provider-tombstones' as const

export type ReviewProviderLifecycleSweepJobData = Readonly<{
  beforeOrAtEpochMillis: number
  afterReviewId: string | null
  limit: number
}>

type Dependencies = Readonly<{
  repository: ReviewProviderSnapshotRepository
  enqueueExpiryContinuation(data: ReviewProviderLifecycleSweepJobData): Promise<void>
  enqueueTombstoneContinuation(data: ReviewProviderLifecycleSweepJobData): Promise<void>
}>

const parseSweepData = (data: ReviewProviderLifecycleSweepJobData) => {
  if (
    !Number.isSafeInteger(data.beforeOrAtEpochMillis) ||
    data.beforeOrAtEpochMillis < 0 ||
    !Number.isSafeInteger(data.limit) ||
    data.limit < 1 ||
    data.limit > 100
  ) {
    throw new TypeError('Invalid Review provider lifecycle sweep bounds')
  }
  return {
    beforeOrAt: new Date(data.beforeOrAtEpochMillis),
    afterReviewId: data.afterReviewId == null ? null : reviewId(data.afterReviewId),
    limit: data.limit,
  }
}

export const createExpireReviewProviderSourceHandler =
  (dependencies: Dependencies) => async (job: Job<ReviewProviderLifecycleSweepJobData>) =>
    trace('job.expireReviewProviderSource', async () => {
      // Validate stale queue payloads, then drain them harmlessly. The legacy
      // repository adapter now delegates to the Review-owned checkpointed
      // report authority, while recurring apply remains unreachable until an
      // explicit reviewed cutover supplies both confirmation and approval.
      parseSweepData(job.data)
      void dependencies
      return { status: 'quarantined' as const, transitioned: 0, nextReviewId: null }
    })

export const createSweepReviewProviderTombstonesHandler =
  (dependencies: Dependencies) => async (job: Job<ReviewProviderLifecycleSweepJobData>) =>
    trace('job.sweepReviewProviderTombstones', async () => {
      const input = parseSweepData(job.data)
      const result = await dependencies.repository.sweepExpiredTombstones(input)
      if (result.nextReviewId != null) {
        await dependencies.enqueueTombstoneContinuation({
          ...job.data,
          afterReviewId: result.nextReviewId,
        })
      }
      return result
    })
