// BullMQ worker factory — creates workers with default retry and logging.
// Per architecture: "Default retry policy: exponential backoff, max 3 attempts."

import { Worker, type Job } from 'bullmq'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import type { JobHandler } from './registry'
import { Redis } from 'ioredis'

// fallow-ignore-next-line unused-type
export type { Job }
// fallow-ignore-next-line unused-type
export type { JobHandler }

/**
 * Create a BullMQ worker for the given queue name.
 * Uses a dedicated Redis connection with maxRetriesPerRequest=null
 * (required by BullMQ for blocking BRPOPLPUSH operations).
 * Returns undefined if Redis is not configured (REDIS_URL missing).
 */
export function createJobWorker<T>(
  name: string,
  handler: JobHandler<T>,
): Worker<T> | undefined {
  const env = getEnv()
  if (!env.REDIS_URL) return undefined

  const logger = getLogger()

  // BullMQ Worker requires maxRetriesPerRequest=null for blocking connections.
  // Cannot share the caching Redis client which uses maxRetriesPerRequest=3.
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  const worker = new Worker<T>(name, handler, {
    connection: connection as unknown as import('bullmq').ConnectionOptions,
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
      {
        jobId: job?.id,
        queue: name,
        attemptsMade: job?.attemptsMade,
        err: { message: err.message, stack: err.stack },
      },
      'job failed',
    )
  })

  return worker
}
