// Operator CLI (BQC-7.5): bounded re-run of a refresh sweep by ENQUEUEING the
// job through the BQC-3 producer contract (createJobQueue + jobEnqueueOptions
// — catalogue retry policy; the dispatch gate re-authorizes at execution).
// Handlers are never invoked directly.
//
// Usage:
//   pnpm ops:refresh <target> --operator <id>                          — dry-run report
//   pnpm ops:refresh <target> --operator <id> --reason <text> --apply  — enqueue one run
//
// Target (background queue, bounded internally by the sweep):
//   reviews — refresh-expiring-reviews (hourly sweep, cursor-bounded)
//
// Requires QUEUE_REDIS_URL + DATABASE_URL. The enqueue is audited by the harness
// (decision row) and re-authorized by the BQC-3 dispatch gate at execution.

import { createJobQueue } from '../../src/shared/jobs/queue'
import { jobEnqueueOptions } from '../../src/shared/jobs/job-policy'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const TARGETS = {
  reviews: { jobName: 'refresh-expiring-reviews', capability: 'review.use' },
} as const

type Target = keyof typeof TARGETS

const USAGE = `pnpm ops:refresh <${Object.keys(TARGETS).join('|')}> --operator <id> [--reason <text> --apply]`

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [target] = positionalArgs(process.argv.slice(2))
  if (!target || !(target in TARGETS)) usage()
  const { jobName, capability } = TARGETS[target as Target]

  const result = await runOperatorCommand(
    {
      name: 'ops:refresh',
      scope: 'global',
      mutation: true,
      capability,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const queue = createJobQueue('background')
      if (!queue) {
        io.err('QUEUE_REDIS_URL is not configured — cannot reach the background queue.')
        return 1
      }
      try {
        if (ctx.dryRun) {
          io.out(
            `would enqueue '${jobName}' on 'background' (catalogue retry policy) — re-run with --apply`,
          )
          return
        }
        const job = await queue.add(jobName, {}, jobEnqueueOptions(jobName))
        io.out(
          JSON.stringify(
            { enqueued: jobName, queue: 'background', jobId: job.id, target },
            null,
            2,
          ),
        )
      } finally {
        await queue.close()
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:refresh failed', err)
  process.exit(1)
})
