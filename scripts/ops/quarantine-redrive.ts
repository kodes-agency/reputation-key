// Operator CLI (BQC-3.6; harness BQC-7.5): inspect and redrive jobs from the
// failure quarantine — the dead-letter queue where jobs land after exhausting
// their attempt budget (content-safe envelope; see shared/jobs/failure-quarantine.ts).
//
// Usage:
//   pnpm ops:quarantine list --operator <id>                       — report quarantined jobs
//   pnpm ops:quarantine redrive <quarantineJobId> --operator <id>  — show what would be redriven
//   pnpm ops:quarantine redrive <quarantineJobId> --operator <id> --reason <text> --apply
//
// Redrive moves the job back to its ORIGINAL queue with a fresh attempt
// budget (catalogue policy) and redriveMetadata in the payload — the BQC-3
// runtime contract (createRedriveJob); handlers are never invoked directly.
// Redacted envelopes (unknown job families) cannot be redriven — the payload
// is gone. Requires REDIS_URL + DATABASE_URL.

import { createJobQueue } from '../../src/shared/jobs/queue'
import {
  createRedriveJob,
  listQuarantinedJobs,
  QUARANTINE_QUEUE_NAME,
  type QuarantinedEntry,
} from '../../src/shared/jobs/failure-quarantine'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:quarantine <list|redrive <quarantineJobId>> --operator <id> [--reason <text> --apply]'

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
    e.quarantinedAt,
  )
  console.log(
    ''.padEnd(48),
    `reason: ${e.failedReason}${e.policyReason ? ` (policy: ${e.policyReason})` : ''}`,
  )
}

async function main(): Promise<void> {
  const [action, id] = positionalArgs(process.argv.slice(2))
  if (action !== 'list' && action !== 'redrive') usage()
  if (action === 'redrive' && !id) usage()
  const mutation = action === 'redrive'

  const result = await runOperatorCommand(
    {
      name: 'ops:quarantine',
      scope: 'global',
      mutation,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const quarantine = createJobQueue(QUARANTINE_QUEUE_NAME)
      if (!quarantine) {
        io.err('REDIS_URL is not configured — cannot reach the quarantine queue.')
        return 1
      }

      // Lazily created target queues, memoized so each is closed at the end.
      const targets = new Map<string, NonNullable<ReturnType<typeof createJobQueue>>>()
      const resolveTarget = (name: string) => {
        let queue = targets.get(name)
        if (!queue) {
          queue = createJobQueue(name)
          if (queue) targets.set(name, queue)
        }
        return queue
      }

      try {
        if (action === 'list') {
          const entries = await listQuarantinedJobs(quarantine)
          io.out(`\nfailure quarantine — ${entries.length} job(s)\n`)
          for (const entry of entries) printEntry(entry)
          io.out('')
          return
        }

        // redrive
        const entries = await listQuarantinedJobs(quarantine)
        const entry = entries.find((e) => e.quarantineJobId === id)
        if (!entry) {
          io.err(`no quarantined job with id '${id}'`)
          return 1
        }
        printEntry(entry)

        if (ctx.dryRun) {
          io.out(
            `\nreport only — re-run with --apply to redrive to '${entry.envelope.originalQueue}'\n`,
          )
          return
        }

        const redrive = createRedriveJob(quarantine, resolveTarget)
        const redriveResult = await redrive(id as string)
        io.out(JSON.stringify(redriveResult, null, 2))
        if (!redriveResult.redriven) return 1
      } finally {
        await quarantine.close()
        for (const queue of targets.values()) await queue.close()
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:quarantine failed', err)
  process.exit(1)
})
