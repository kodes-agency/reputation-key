// AI operation abandoned-execution reaper job.
//
// One bounded repeatable run per cadence tick. All recovery logic lives in
// `../../application/ai-operation-execution-reaper`, which routes every
// candidate through the store's existing `recordFailure` CAS; this module is
// only the queue seam plus content-free observability.
//
// The reaper is injected rather than constructed here: `src/shared/jobs/**` is
// a shared-other boundary element and must not reach into a context's
// infrastructure. Composition (bootstrap) owns the store wiring, matching the
// permit start-deadline sweep seam.
//
// It lives here rather than under `src/contexts/ai/` deliberately. BQC-5.6
// requires every job inside a dark context to carry a capability gate, and
// gating this one would switch off recovery in the exact situation it exists
// for — a killed AI runtime, which is when executions get abandoned. The permit
// start-deadline sweep is unconditional for the identical reason and sits here
// too.
//
// Cadence rationale: the bound that matters is the operation's own
// `expires_at`, not this interval — a row only becomes reapable once that
// horizon has already passed, so the tick only decides how long an already-dead
// row keeps claiming to be in flight. Five minutes matches the permit sweep and
// the scan does nothing when no operation is abandoned.

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
  abandonedVisited: number
  operationsFenced: number
  operationsRaced: number
  batchFull: boolean
}>

type AiOperationExecutionReaperDeps = Readonly<{
  reap: () => Promise<AiOperationExecutionReaperOutcome>
}>

export const createAiOperationExecutionReaperHandler =
  (deps: AiOperationExecutionReaperDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await deps.reap()
      // Counts only — no operation id, organization, property, review, capability
      // or provider identifier reaches a log line.
      getLogger().info(
        {
          job: JOB_NAME,
          abandonedVisited: outcome.abandonedVisited,
          operationsFenced: outcome.operationsFenced,
          operationsRaced: outcome.operationsRaced,
          batchFull: outcome.batchFull,
        },
        'AI operation abandoned-execution reaper completed',
      )
    })
