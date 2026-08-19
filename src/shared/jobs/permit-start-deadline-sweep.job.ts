// Execution-permit start-deadline sweep job.
//
// One bounded repeatable run per cadence tick. All fencing logic lives in
// `#/shared/auth/execution-permit-start-deadline-sweep`, which routes every
// candidate through the domain helper `fenceElapsedStartDeadlinePermit`; this
// module is only the queue seam plus content-free observability.
//
// The sweeper is injected rather than constructed here: `src/shared/jobs/**` is
// a shared-other boundary element and must not reach into a context's
// infrastructure. Composition (bootstrap) owns the repository wiring.
//
// Registration is unconditional and independent of the Google Content runtime
// approval. An unconfigured or killed runtime is exactly the case where nobody
// will ever start an admitted permit, so that is when the fence matters most.

import type { Job } from 'bullmq'
import type { ExecutionPermitStartDeadlineSweeper } from '#/shared/auth/execution-permit-start-deadline-sweep'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export const JOB_NAME = 'permit-start-deadline-sweep' as const

type PermitStartDeadlineSweepDeps = Readonly<{
  sweep: ExecutionPermitStartDeadlineSweeper
}>

export const createPermitStartDeadlineSweepHandler =
  (deps: PermitStartDeadlineSweepDeps) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const outcome = await deps.sweep()
      // Counts and closed reason codes only — no permit id, capability scope,
      // organization, property, or approval binding reaches a log line.
      getLogger().info(
        {
          job: JOB_NAME,
          scanned: outcome.scanned,
          fenced: outcome.fenced,
          vanished: outcome.vanished,
          retainedStateNotAdmitted: outcome.retained.state_not_admitted,
          retainedStartDeadlinePending: outcome.retained.start_deadline_pending,
          batchFull: outcome.batchFull,
        },
        'Permit start-deadline sweep completed',
      )
    })
