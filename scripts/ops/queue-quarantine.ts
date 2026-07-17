// Operator CLI: quarantine a queue without deleting jobs (BQC-0.4).
// Usage:
//   pnpm ops:queue status <queue>
//   pnpm ops:queue pause <queue>    — stop processing, preserve all jobs
//   pnpm ops:queue resume <queue>   — restore processing
// Queues: default, background, domain-events. Requires REDIS_URL.

import { createJobQueue } from '../../src/shared/jobs/queue'
import {
  assertKnownQueueName,
  pauseQueueForQuarantine,
  resumeQueueFromQuarantine,
  queueQuarantineStatus,
  QUARANTINE_QUEUE_NAMES,
} from '../../src/shared/jobs/queue-quarantine'

function usage(): never {
  console.error(
    `Usage: pnpm ops:queue <status|pause|resume> <${QUARANTINE_QUEUE_NAMES.join('|')}>`,
  )
  process.exit(1)
}

async function main(): Promise<void> {
  const [action, name] = process.argv.slice(2)
  if (!action || !name || !['status', 'pause', 'resume'].includes(action)) usage()

  let queue
  try {
    assertKnownQueueName(name)
    queue = createJobQueue(name)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
  if (!queue) {
    console.error('REDIS_URL is not configured — cannot reach the queue.')
    process.exit(1)
  }

  try {
    const result =
      action === 'pause'
        ? await pauseQueueForQuarantine(queue)
        : action === 'resume'
          ? await resumeQueueFromQuarantine(queue)
          : await queueQuarantineStatus(queue)
    console.log(JSON.stringify({ queue: name, action, ...result }, null, 2))
  } finally {
    await queue.close()
  }
}

main().catch((err) => {
  console.error('ops:queue failed', err)
  process.exit(1)
})
