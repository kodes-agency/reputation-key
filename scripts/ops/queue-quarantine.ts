// Operator CLI: quarantine a queue without deleting jobs (BQC-0.4; harness BQC-7.5).
// Usage:
//   pnpm ops:queue status <queue> --operator <id>
//   pnpm ops:queue pause <queue> --operator <id> --reason <text>           — dry-run report
//   pnpm ops:queue pause <queue> --operator <id> --reason <text> --apply   — stop processing, preserve all jobs
//   pnpm ops:queue resume <queue> --operator <id> --reason <text> --apply  — restore processing
// Queues: default, background, domain-events. Requires REDIS_URL + DATABASE_URL.
// Every invocation is policy-evaluated + audited (allow rows carry the
// reason; reads audit as 'read'). pause/resume are report-first since
// BQC-7.5 — --apply executes.

import { createJobQueue } from '../../src/shared/jobs/queue'
import {
  assertKnownQueueName,
  pauseQueueForQuarantine,
  resumeQueueFromQuarantine,
  queueQuarantineStatus,
  QUARANTINE_QUEUE_NAMES,
} from '../../src/shared/jobs/queue-quarantine'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE = `pnpm ops:queue <status|pause|resume> <${QUARANTINE_QUEUE_NAMES.join('|')}> --operator <id> [--reason <text> --apply]`

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [action, name] = positionalArgs(process.argv.slice(2))
  if (!action || !name || !['status', 'pause', 'resume'].includes(action)) usage()
  const mutation = action !== 'status'

  const result = await runOperatorCommand(
    {
      name: 'ops:queue',
      scope: 'global',
      mutation,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      let queue
      try {
        assertKnownQueueName(name)
        queue = createJobQueue(name)
      } catch (err) {
        io.err(err instanceof Error ? err.message : String(err))
        return 1
      }
      if (!queue) {
        io.err('REDIS_URL is not configured — cannot reach the queue.')
        return 1
      }

      try {
        if (mutation && ctx.dryRun) {
          const status = await queueQuarantineStatus(queue)
          io.out(JSON.stringify({ queue: name, action, ...status }, null, 2))
          io.out(`report only — re-run with --apply to ${action} '${name}'`)
          return
        }
        const out =
          action === 'pause'
            ? await pauseQueueForQuarantine(queue)
            : action === 'resume'
              ? await resumeQueueFromQuarantine(queue)
              : await queueQuarantineStatus(queue)
        io.out(JSON.stringify({ queue: name, action, ...out }, null, 2))
      } finally {
        await queue.close()
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:queue failed', err)
  process.exit(1)
})
