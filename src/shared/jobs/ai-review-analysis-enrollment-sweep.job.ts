// Unconditional queue seam for exhaustive Review Analysis enrollment recovery.
//
// First enablement records a durable, revision-pinned enrollment intent. The
// owning AI use case rechecks the exact authorization lineage, source epoch,
// capability epoch, and current global/provider/capability controls before it
// can open a replay. Keeping this recovery tick unconditional therefore does
// not turn the scheduler into an activation switch: a dark runtime leaves the
// intent queued and returns a content-free `runtimeBlocked` count.
//
// One tick visits at most the application-owned batch limit. A full batch is
// reported for operators and left for the next five-minute recurrence; this
// seam deliberately has no continuation enqueue, so sustained backlog cannot
// create an unbounded queue fan-out.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'ai-review-analysis-enrollment-sweep' as const

/**
 * Declared structurally because shared jobs must not import an owning context.
 * Bootstrap supplies the AI use case; the queue seam observes counts only.
 */
type AiReviewAnalysisEnrollmentSweepOutcome = Readonly<{
  enrollmentsVisited: number
  runtimeBlocked: number
  replaysStarted: number
  revisionsPinned: number
  waitingForReplay: number
  enrollmentsCaughtUp: number
  enrollmentsSuperseded: number
  enrollmentsStalled: number
  batchFull: boolean
}>

type AiReviewAnalysisEnrollmentSweepDependencies = Readonly<{
  sweep: () => Promise<AiReviewAnalysisEnrollmentSweepOutcome>
  logger: Pick<LoggerPort, 'info' | 'warn'>
}>

export const createAiReviewAnalysisEnrollmentSweepHandler =
  (dependencies: AiReviewAnalysisEnrollmentSweepDependencies) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await dependencies.sweep()
      const fields = { job: JOB_NAME, ...outcome }

      if (outcome.batchFull) {
        dependencies.logger.warn(
          fields,
          'AI Review Analysis enrollment sweep reached its batch cap',
        )
        return
      }

      dependencies.logger.info(fields, 'AI Review Analysis enrollment sweep completed')
    })
