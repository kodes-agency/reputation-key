// Review context — quarantined legacy Review purge handler.
//
// SAFE-03: the current `reviews` row mixes provider-controlled source content
// with the stable identity referenced by RepKey-owned Replies and workflow
// history. `replies.review_id` still cascades on Review deletion. Until the
// REV-01 expand/backfill/cutover separates those lifecycles, this entry point
// validates no destructive authority and drains leftover queue jobs without
// reading or mutating Review data.

import type { Job } from 'bullmq'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
import type { Database } from '#/shared/db'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import { REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE } from '../../application/review-lifecycle-safety'

export const JOB_NAME = 'purge-expired-reviews' as const

/** Retained for scheduler/scale-contract compatibility during quarantine. */
export const DEFAULT_BATCH_SIZE = 500
export const DEFAULT_MAX_BATCHES = 100

export type PurgeRunResult = Readonly<{
  status: 'completed' | 'budget_exhausted' | 'quarantined'
  batches: number
  purged: number
  failed: number
  batchRows: ReadonlyArray<number>
}>

type PurgeHandlerDeps = Readonly<{
  reviewRepo: ReviewRepository
  commandStore: ReplyCommandStore
  clock: () => Date
  db?: Database
  batchSize?: number
  maxBatches?: number
}>

export const createPurgeExpiredReviewsHandler = (deps: PurgeHandlerDeps) => {
  // Keep the former dependencies in the constructor contract while callers
  // cut over. None is consulted: even a read can make an operator believe a
  // destructive retention run completed when it did not.
  void deps

  return async (_job: Job): Promise<PurgeRunResult> =>
    trace('job.purgeExpiredReviews', async () => {
      getLogger().warn(
        {
          job: JOB_NAME,
          owner: REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.owner,
          releaseDecision: REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.releaseDecision,
        },
        'Review purge is quarantined pending stable Review lifecycle cutover',
      )
      return {
        status: 'quarantined',
        batches: 0,
        purged: 0,
        failed: 0,
        batchRows: [],
      }
    })
}
