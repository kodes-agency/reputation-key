// Operator CLI (BQC-3.6): inspect and redrive jobs from the failure
// quarantine — the dead-letter queue where jobs land after exhausting their
// attempt budget (content-safe envelope; see shared/jobs/failure-quarantine.ts).
//
// Usage:
//   pnpm ops:quarantine list                        — report quarantined jobs
//   pnpm ops:quarantine redrive <quarantineJobId>   — show what would be redriven
//   pnpm ops:quarantine redrive <quarantineJobId> --apply
//
// Redrive moves the job back to its ORIGINAL queue with a fresh attempt
// budget (catalogue policy) and redriveMetadata in the payload. Redacted
// envelopes (unknown job families) cannot be redriven — the payload is gone.
// Requires REDIS_URL.

import { createJobQueue } from '../../src/shared/jobs/queue'
import {
  createRedriveJob,
  listQuarantinedJobs,
  QUARANTINE_QUEUE_NAME,
  type QuarantinedEntry,
} from '../../src/shared/jobs/failure-quarantine'

function usage(): never {
  console.error('Usage: pnpm ops:quarantine <list|redrive <quarantineJobId>> [--apply]')
  process.exit(1)
}

function printEntry(entry: QuarantinedEntry): void {
  const e = entry.envelope
  console.log(
    entry.quarantineJobId.padEnd(48),
    e.jobName.padEnd(28),
    `queue=${e.originalQueue}`.padEnd(20),
    `attempts=${e.attempts}`.padEnd(12),
    e.quarantinedAt,
  )
  console.log(
    ''.padEnd(48),
    `reason: ${e.failedReason}${e.policyReason ? ` (policy: ${e.policyReason})` : ''}`,
  )
}

async function main(): Promise<void> {
  const [action, id, ...rest] = process.argv.slice(2)
  const apply = rest.includes('--apply')
  if (action !== 'list' && action !== 'redrive') usage()
  if (action === 'redrive' && !id) usage()

  const quarantine = createJobQueue(QUARANTINE_QUEUE_NAME)
  if (!quarantine) {
    console.error('REDIS_URL is not configured — cannot reach the quarantine queue.')
    process.exit(1)
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
      console.log(`\nfailure quarantine — ${entries.length} job(s)\n`)
      for (const entry of entries) printEntry(entry)
      console.log()
      return
    }

    // redrive
    const entries = await listQuarantinedJobs(quarantine)
    const entry = entries.find((e) => e.quarantineJobId === id)
    if (!entry) {
      console.error(`no quarantined job with id '${id}'`)
      process.exit(1)
    }
    printEntry(entry)

    if (!apply) {
      console.log(
        `\nreport only — re-run with --apply to redrive to '${entry.envelope.originalQueue}'\n`,
      )
      return
    }

    const redrive = createRedriveJob(quarantine, resolveTarget)
    const result = await redrive(id!)
    console.log(JSON.stringify(result, null, 2))
    if (!result.redriven) process.exit(1)
  } finally {
    await quarantine.close()
    for (const queue of targets.values()) await queue.close()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
