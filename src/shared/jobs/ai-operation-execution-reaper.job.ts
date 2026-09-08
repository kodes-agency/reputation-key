// AI operation abandoned-owner and delivery reaper job.
//
// One bounded repeatable run per cadence tick. All recovery logic lives in the
// AI application reaper, which fences result-less work or delivers persisted
// Review Analysis output before recording the origin event's receipt. This
// module is only the queue seam plus content-free observability.
//
// The reaper is injected rather than constructed here: `src/shared/jobs/**` is
// a shared-other boundary element and must not reach into a context's
// infrastructure. The AI context build owns its store and outcome wiring.
//
// It lives here rather than under `src/contexts/ai/` deliberately. BQC-5.6
// requires every job inside a dark context to carry a capability gate, and
// gating this one would switch off recovery in the exact situation it exists
// for — a killed AI runtime, which is when owners disappear. The permit
// start-deadline sweep is unconditional for the identical reason and sits here
// too.
//
// The 15-minute domain horizon decides when work is recoverable. The five-minute
// cadence only bounds how long an already-ownerless operation waits for the
// next recovery tick.

import type { Job } from 'bullmq'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'ai-operation-execution-reaper' as const

/**
 * The counts this seam logs — declared here, structurally, rather than imported
 * from the AI context. `src/shared/jobs/**` may not depend on a context (see
 * src/contexts/CONTEXT.md "Dependency rules"), and this module needs nothing
 * from the reaper beyond the shape of its result. Composition supplies the
 * concrete implementation.
 */
type AiOperationExecutionReaperOutcome = Readonly<{
  recoveryCandidatesVisited: number
  operationsFenced: number
  operationsDelivered: number
  operationsSettled: number
  operationsRaced: number
  batchFull: boolean
}>

type AiOperationExecutionReaperDeps = Readonly<{
  reap: () => Promise<AiOperationExecutionReaperOutcome>
  /**
   * Release budget reservations whose operation never settled (WP3.3-B): the
   * same "owner died mid-flight" condition as an abandoned execution, on the
   * same tick. Returns the number of reservations released.
   */
  releaseStaleReservations: () => Promise<number>
}>

export const createAiOperationExecutionReaperHandler =
  (deps: AiOperationExecutionReaperDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await deps.reap()
      const reservationsReleased = await deps.releaseStaleReservations()
      // Counts only — no operation id, organization, property, review, capability
      // or provider identifier reaches a log line.
      getLogger().info(
        {
          job: JOB_NAME,
          recoveryCandidatesVisited: outcome.recoveryCandidatesVisited,
          operationsFenced: outcome.operationsFenced,
          operationsDelivered: outcome.operationsDelivered,
          operationsSettled: outcome.operationsSettled,
          operationsRaced: outcome.operationsRaced,
          batchFull: outcome.batchFull,
          reservationsReleased,
        },
        'AI operation recovery reaper completed',
      )
    })
