// Operator CLI: acknowledge a job family's repair once its cause is fixed.
//
// Usage:
//   pnpm ops jobs acknowledge-repair <jobName> --operator <id>
//     — report what would change, and why the family is unready
//   pnpm ops jobs acknowledge-repair <jobName> --operator <id> --reason <text> --apply
//
// Sets `lastRepairAt` on the family's runtime head (Queue Redis) so a failed
// on-demand run that no redrive can answer stops holding `repair_required`.
// Refuses while the family still has a dead letter or a retained failed job
// newer than its latest success. The rules live in
// src/shared/jobs/repair-acknowledgement.ts and the invocation in
// src/shared/ops/job-repair-command.ts — scripts/ is wiring only.
// Requires QUEUE_REDIS_URL + DATABASE_URL.

import { JOB_OPERATIONAL_CONTRACTS } from '../../src/shared/jobs/operational-catalogue'
import { createJobRedisConnection } from '../../src/shared/jobs/queue'
import { createJobRepairAcknowledger } from '../../src/shared/jobs/repair-acknowledgement'
import { createJobRuntimeObservationStore } from '../../src/shared/jobs/runtime-observations'
import {
  jobRepairCommandSpec,
  planJobRepairCommand,
  runJobRepairCommand,
} from '../../src/shared/ops/job-repair-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(jobRepairCommandSpec, async (ctx, args, io) => {
    const plan = planJobRepairCommand(args)
    if (!plan.ok) {
      io.err(`${jobRepairCommandSpec.name}: ${plan.error}`)
      io.err(`usage: ${jobRepairCommandSpec.usage}`)
      return 1
    }

    // A missing queue would read as a family with no failures and no dead
    // letters, so the command does not run without all of them.
    const { jobQueue, backgroundQueue } = ctx.container
    const { quarantine } = ctx.container.opsQueues
    const redis = createJobRedisConnection()
    if (!jobQueue || !backgroundQueue || !quarantine || !redis) {
      io.err('QUEUE_REDIS_URL is not configured — cannot reach the job queues.')
      return 1
    }

    return runJobRepairCommand({
      ctx,
      jobName: plan.jobName,
      acknowledger: createJobRepairAcknowledger({
        contracts: JOB_OPERATIONAL_CONTRACTS,
        store: createJobRuntimeObservationStore({ redis }),
        queues: { default: jobQueue, background: backgroundQueue },
        quarantine,
        clock: () => new Date(),
      }),
      io,
    })
  })
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:jobs failed', err)
  process.exit(1)
})
