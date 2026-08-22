// AI review-analysis backfill advance sweep.
//
// `ops:ai-reanalyze` opens a durable run and emits ONE review; each settled item
// allocates and emits the next. The fast path for that hand-off is the AI outbox
// consumer, which advances the run the moment a backfill event settles. This
// sweep is the safety net for the case the consumer cannot cover: a worker that
// died between the settle and the hand-off, or a dispatch budget exhausted on a
// poison event. Without it a broken chain would leave the run `running` forever
// with the epoch already bumped — the worst shape, because the watermark has
// moved and the reviews it skipped are only reachable through this run.
//
// All logic lives in `contexts/ai/application/use-cases/advance-review-analysis-backfill`;
// this module is the queue seam plus content-free observability.
//
// It lives here rather than under `src/contexts/ai/` for the same reason as the
// abandoned-execution reaper: BQC-5.6 requires every job inside a dark context
// to carry a capability gate, and gating this one would freeze runs mid-flight
// in exactly the situation recovery matters. Registered unconditionally — with
// a dark AI runtime the consumer terminal-settles each item and the run still
// reaches a terminal state instead of hanging with a moved watermark.
//
// Cadence rationale: the bound that matters is the item's own settle, not this
// interval. The consumer hand-off carries the normal case at consumer latency,
// so the tick only decides how long a BROKEN chain sits idle. Five minutes
// matches the reaper and the permit sweep, and the scan does nothing when no run
// is open.

import type { Job } from 'bullmq'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'ai-review-analysis-backfill-advance' as const

/**
 * The counts this seam logs — declared structurally rather than imported from
 * the AI context: `src/shared/jobs/**` may not depend on a context (see
 * src/contexts/CONTEXT.md "Dependency rules"). Composition supplies the
 * concrete implementation.
 */
type AiReviewAnalysisBackfillSweepOutcome = Readonly<{
  runsVisited: number
  itemsEmitted: number
  itemsSkipped: number
  itemsRecovered: number
  runsCompleted: number
  runsSuperseded: number
  runsStalled: number
  batchFull: boolean
}>

type AiReviewAnalysisBackfillAdvanceDeps = Readonly<{
  sweep: () => Promise<AiReviewAnalysisBackfillSweepOutcome>
}>

export const createAiReviewAnalysisBackfillAdvanceHandler =
  (deps: AiReviewAnalysisBackfillAdvanceDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await deps.sweep()
      // Counts only — no run, organization, property or review identifier
      // reaches a log line.
      getLogger().info(
        {
          job: JOB_NAME,
          runsVisited: outcome.runsVisited,
          itemsEmitted: outcome.itemsEmitted,
          itemsSkipped: outcome.itemsSkipped,
          itemsRecovered: outcome.itemsRecovered,
          runsCompleted: outcome.runsCompleted,
          runsSuperseded: outcome.runsSuperseded,
          runsStalled: outcome.runsStalled,
          batchFull: outcome.batchFull,
        },
        'AI review-analysis backfill advance sweep completed',
      )
    })
