import type { Job } from 'bullmq'
import { reviewId } from '#/shared/domain/ids'
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

export const expireReviewProviderSourceHandler = async (
  job: Job<ReviewProviderLifecycleSweepJobData>,
) =>
  trace('job.expireReviewProviderSource', async () => {
    // Validate stale queue payloads, then drain them harmlessly. Nothing
    // seeds this sweep; raw source expiry runs through purge-expired-reviews.
    parseSweepData(job.data)
    return { status: 'quarantined' as const, transitioned: 0, nextReviewId: null }
  })

export const sweepReviewProviderTombstonesHandler = async (
  job: Job<ReviewProviderLifecycleSweepJobData>,
) =>
  trace('job.sweepReviewProviderTombstones', async () => {
    // Validate stale queue payloads, then drain them harmlessly. Nothing
    // seeds this sweep; the subject tombstone delete stays on the snapshot
    // repository until its retention rule is decided.
    parseSweepData(job.data)
    return { status: 'quarantined' as const, deleted: 0, nextReviewId: null }
  })
