// BullMQ worker factory — creates workers with default retry and logging.
// Per architecture: "Default retry policy: exponential backoff, max 3 attempts."

import { Worker } from 'bullmq'
import type { Job } from 'bullmq'
import { getRedis } from '#/shared/cache/redis'
import { getLogger } from '#/shared/observability/logger'
import type { JobHandler } from './registry'

export type { Job }
export type { JobHandler }

export function createJobWorker<T>(
  name: string,
  handler: JobHandler<T>,
): Worker<T> | undefined {
  const redis = getRedis()
  if (!redis) return undefined

  const logger = getLogger()

  const worker = new Worker<T>(name, handler, {
    connection: redis,
    settings: {
      backoffStrategy: (attemptsMade: number) => {
        // Exponential backoff: 1s, 2s, 4s, 8s...
        return Math.min(2 ** attemptsMade * 1000, 60000)
      },
    },
    limiter: {
      max: 10,
      duration: 1000,
    },
  })

  worker.on('completed', (job: Job<T>) => {
    logger.info({ jobId: job.id, queue: name }, 'job completed')
  })

  worker.on('failed', (job: Job<T> | undefined, err: Error) => {
    logger.error(
      { jobId: job?.id, queue: name, err: { message: err.message, stack: err.stack } },
      'job failed',
    )
  })

  return worker
}
