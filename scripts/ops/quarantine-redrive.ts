// Operator CLI (BQC-3.6; harness BQC-7.5): inspect and disposition jobs from
// the failure quarantine — the dead-letter queue where jobs land after
// exhausting their attempt budget (content-safe envelope; see
// shared/jobs/failure-quarantine.ts).
//
// Usage:
//   pnpm ops:quarantine list --operator <id>                       — report quarantined jobs
//   pnpm ops:quarantine redrive <quarantineJobId> --operator <id>  — show what would be redriven
//   pnpm ops:quarantine redrive <quarantineJobId> --operator <id> --reason <text> --apply
//   pnpm ops:quarantine discard <quarantineJobId> --operator <id>  — show what would be discarded
//   pnpm ops:quarantine discard <quarantineJobId> --operator <id> --reason <text> --apply
//
// Redrive moves the job back to its ORIGINAL queue with a fresh attempt
// budget (catalogue policy) and redriveMetadata in the payload — the BQC-3
// runtime contract (createRedriveJob); handlers are never invoked directly.
// Discard removes the quarantined job without executing or re-enqueuing it.
// Redacted envelopes (unknown job families) cannot be redriven, but can be
// discarded after operator review. Requires QUEUE_REDIS_URL + DATABASE_URL.

import {
  createRedriveJob,
  listQuarantinedJobs,
  type QuarantinedEntry,
  type QuarantinedJobHandle,
} from '../../src/shared/jobs/failure-quarantine'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:quarantine <list|redrive <quarantineJobId>|discard <quarantineJobId>> --operator <id> [--reason <text> --apply]'

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

function printEntry(entry: QuarantinedEntry): void {
  const e = entry.envelope
  console.log(
    entry.quarantineJobId.padEnd(48),
    e.jobName.padEnd(28),
    `queue=${e.originalQueue}`.padEnd(20),
    `attempts=${e.attemptsMade}`.padEnd(12),
    `state=${entry.publicationState}`.padEnd(31),
    e.quarantinedAt,
  )
  console.log(
    ''.padEnd(48),
    `reason: ${e.failedReason}${e.policyReason ? ` (policy: ${e.policyReason})` : ''}`,
  )
}

async function main(): Promise<void> {
  const [action, id] = positionalArgs(process.argv.slice(2))
  if (action !== 'list' && action !== 'redrive' && action !== 'discard') usage()
  if (action !== 'list' && !id) usage()
  const mutation = action !== 'list'

  const result = await runOperatorCommand(
    {
      name: 'ops:quarantine',
      scope: 'global',
      mutation,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const quarantine = ctx.container.opsQueues.quarantine
      if (!quarantine) {
        io.err('QUEUE_REDIS_URL is not configured — cannot reach the quarantine queue.')
        return 1
      }

      const resolveTarget = (name: string) => {
        switch (name) {
          case 'default':
            return ctx.container.jobQueue
          case 'background':
            return ctx.container.opsQueues.background
          case 'domain-events':
            return ctx.container.opsQueues.domainEvents
          default:
            return undefined
        }
      }

      if (action === 'list') {
        const entries = await listQuarantinedJobs(quarantine)
        io.out(`\nfailure quarantine — ${entries.length} job(s)\n`)
        for (const entry of entries) printEntry(entry)
        io.out('')
        return
      }

      // Look up the reviewed entry before either disposition.
      const entries = await listQuarantinedJobs(quarantine)
      const entry = entries.find((candidate) => candidate.quarantineJobId === id)
      if (!entry) {
        io.err(`no quarantined job with id '${id}'`)
        return 1
      }
      printEntry(entry)

      if (ctx.dryRun) {
        if (action === 'discard') {
          io.out(
            `\nreport only — re-run with --apply to discard '${entry.quarantineJobId}' without executing it\n`,
          )
          return
        }
        const pendingNote =
          entry.publicationState === 'pending_failure'
            ? '; apply will first require the original job to still be failed'
            : ''
        io.out(
          `\nreport only — re-run with --apply to redrive to '${entry.envelope.originalQueue}'${pendingNote}\n`,
        )
        return
      }

      if (action === 'discard') {
        const quarantinedJob: QuarantinedJobHandle | undefined = await quarantine.getJob(
          entry.quarantineJobId,
        )
        if (!quarantinedJob) {
          io.err(
            `quarantined job '${entry.quarantineJobId}' disappeared before it could be discarded`,
          )
          return 1
        }
        await quarantinedJob.remove()
        io.out(
          JSON.stringify(
            {
              discarded: true,
              quarantineJobId: entry.quarantineJobId,
              jobName: entry.envelope.jobName,
              executed: false,
            },
            null,
            2,
          ),
        )
        return
      }

      const redrive = createRedriveJob(quarantine, resolveTarget)
      const redriveResult = await redrive(entry.quarantineJobId)
      io.out(JSON.stringify(redriveResult, null, 2))
      if (!redriveResult.redriven) return 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:quarantine failed', err)
  process.exit(1)
})
