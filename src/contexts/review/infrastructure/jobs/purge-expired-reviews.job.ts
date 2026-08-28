// Review context — report-only legacy Review purge compatibility handler.
//
// SAFE-03 / REV-01: the legacy job name remains reachable for operators and
// stale queue payloads, but it is now routed through the one checkpointed,
// content-free lifecycle inspection authority. It never receives apply
// authority and never mutates Review/source/Reply/Inbox data.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE } from '../../application/review-lifecycle-safety'
import type {
  ReviewSourceContentLifecycleCheckpoint,
  ReviewSourceContentLifecycleResult,
  RunReviewSourceContentLifecycle,
} from '../../application/use-cases/run-source-content-lifecycle'
import type { ReviewSourceContentLifecycleInspectionMode } from '../../application/ports/source-content-lifecycle-store.port'

export const JOB_NAME = 'purge-expired-reviews' as const

/** Retained for scheduler/scale-contract compatibility during quarantine. */
export const DEFAULT_BATCH_SIZE = 100
export const DEFAULT_MAX_BATCHES = 100

export type PurgeRunResult = Readonly<{
  status: 'completed' | 'budget_exhausted' | 'quarantined' | 'report_only'
  batches: number
  purged: number
  failed: number
  batchRows: ReadonlyArray<number>
  report?: ReviewSourceContentLifecycleResult
}>

export type PurgeExpiredReviewsJobData = Readonly<{
  mode?: ReviewSourceContentLifecycleInspectionMode
  batchSize?: number
  checkpoint?: ReviewSourceContentLifecycleCheckpoint
}>

type PurgeHandlerDeps = Readonly<{
  batchSize?: number
  runLifecycle: RunReviewSourceContentLifecycle
  logger: Pick<LoggerPort, 'warn'>
  enqueueContinuation?: (data: PurgeExpiredReviewsJobData) => Promise<void>
}>

export const createPurgeExpiredReviewsHandler = (deps: PurgeHandlerDeps) => {
  return async (job: Job<PurgeExpiredReviewsJobData>): Promise<PurgeRunResult> =>
    trace('job.purgeExpiredReviews', async () => {
      const mode = job.data?.mode ?? 'report'
      if (mode !== 'report' && mode !== 'shadow') {
        throw new TypeError('Invalid Review source-content lifecycle report mode')
      }
      const batchSize = job.data?.batchSize ?? deps.batchSize ?? DEFAULT_BATCH_SIZE
      const report = await deps.runLifecycle({
        mode,
        batchSize,
        ...(job.data?.checkpoint == null ? {} : { checkpoint: job.data.checkpoint }),
      })
      if (report.nextCheckpoint != null && deps.enqueueContinuation != null) {
        await deps.enqueueContinuation({
          mode,
          batchSize,
          checkpoint: report.nextCheckpoint,
        })
      }
      deps.logger.warn(
        {
          job: JOB_NAME,
          owner: REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.owner,
          releaseDecision: REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE.releaseDecision,
          mode: report.mode,
          scanned: report.scanned,
          status: report.status,
          applyEnabled: report.apply.enabled,
        },
        'Review lifecycle inspection completed; destructive apply remains quarantined',
      )
      return {
        status: 'report_only',
        batches: report.scanned === 0 ? 0 : 1,
        purged: 0,
        failed: 0,
        batchRows: report.scanned === 0 ? [] : [report.scanned],
        report,
      }
    })
}
