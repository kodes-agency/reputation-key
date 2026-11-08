// Queue delivery cannot grant apply authority: ordinary wiring stays report-only.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import { REVIEW_DESTRUCTIVE_LIFECYCLE_QUARANTINE } from '../../application/review-lifecycle-safety'
import type {
  ReviewSourceContentLifecycleCheckpoint,
  ReviewSourceContentLifecycleResult,
  RunReviewSourceContentLifecycle,
  RunReviewSourceContentLifecycleInput,
} from '../../application/use-cases/run-source-content-lifecycle'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION } from '../../application/use-cases/run-source-content-lifecycle'
import type { ReviewSourceContentLifecycleMode } from '../../application/ports/source-content-lifecycle-store.port'

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
  mode?: ReviewSourceContentLifecycleMode
  batchSize?: number
  checkpoint?: ReviewSourceContentLifecycleCheckpoint
  applyConfirmation?: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION
}>

type PurgeHandlerDeps = Readonly<{
  batchSize?: number
  /** Set by trusted worker wiring only after owner-approved activation. */
  scheduledApplyConfirmation?: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION
  runLifecycle: RunReviewSourceContentLifecycle
  logger: Pick<LoggerPort, 'warn'>
  enqueueContinuation?: (data: PurgeExpiredReviewsJobData) => Promise<void>
}>

function resolveLifecycleInput(
  data: PurgeExpiredReviewsJobData,
  deps: PurgeHandlerDeps,
): RunReviewSourceContentLifecycleInput {
  const mode = data.mode ?? (deps.scheduledApplyConfirmation == null ? 'report' : 'apply')
  if (mode !== 'report' && mode !== 'shadow' && mode !== 'apply') {
    throw new TypeError('Invalid Review source-content lifecycle mode')
  }
  const applyConfirmation =
    data.applyConfirmation ??
    (data.mode == null ? deps.scheduledApplyConfirmation : undefined)
  if (
    (mode === 'apply' &&
      applyConfirmation !== REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION) ||
    (mode !== 'apply' && applyConfirmation != null)
  ) {
    throw new TypeError('Review expiry apply requires explicit confirmation')
  }
  if (data.checkpoint != null && data.checkpoint.scope.kind !== 'expired') {
    throw new TypeError('Review expiry jobs cannot apply a connection or one-off scope')
  }
  return {
    mode,
    batchSize: data.batchSize ?? deps.batchSize ?? DEFAULT_BATCH_SIZE,
    ...(mode === 'apply'
      ? { scope: { kind: 'expired' as const }, applyConfirmation }
      : {}),
    ...(data.checkpoint == null ? {} : { checkpoint: data.checkpoint }),
  }
}

function purgeRunResult(report: ReviewSourceContentLifecycleResult): PurgeRunResult {
  return {
    status: report.apply.enabled
      ? report.nextCheckpoint == null
        ? 'completed'
        : 'budget_exhausted'
      : 'report_only',
    batches: report.scanned === 0 ? 0 : 1,
    purged: report.apply.enabled ? report.apply.rowsRedacted : 0,
    failed: 0,
    batchRows: report.scanned === 0 ? [] : [report.scanned],
    report,
  }
}

export const createPurgeExpiredReviewsHandler = (deps: PurgeHandlerDeps) => {
  return async (job: Job<PurgeExpiredReviewsJobData>): Promise<PurgeRunResult> =>
    trace('job.purgeExpiredReviews', async () => {
      const input = resolveLifecycleInput(job.data ?? {}, deps)
      const report = await deps.runLifecycle(input)
      if (report.nextCheckpoint != null) {
        if (deps.enqueueContinuation == null || report.scanned === 0) {
          throw new Error('Review lifecycle continuation cannot make progress')
        }
        await deps.enqueueContinuation({
          mode: input.mode,
          batchSize: input.batchSize,
          checkpoint: report.nextCheckpoint,
          ...(input.mode === 'apply'
            ? { applyConfirmation: input.applyConfirmation }
            : {}),
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
        'Review lifecycle page completed',
      )
      return purgeRunResult(report)
    })
}
