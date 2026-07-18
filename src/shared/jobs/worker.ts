// BullMQ worker factory — creates workers with catalogue-derived retry and logging.
// Per architecture: "Default retry policy: exponential backoff, max 3 attempts."
//
// BQC-3.6: retry behavior comes from JOB OPTIONS (queue defaults + explicit
// per-job jobEnqueueOptions), never from a worker-level backoffStrategy — a
// custom strategy would override the job-level backoff (with jitter) that the
// event/job family catalogue declares. Exhausted jobs are copied to the
// dead-letter quarantine queue from the 'failed' handler.

import { Worker, type Job, type Queue } from 'bullmq'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { quarantineExhaustedJob } from './failure-quarantine'
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
 *
 * @param concurrency  Max jobs processed in parallel (BullMQ default: 1).
 *                     Set higher for latency-sensitive queues so a single
 *                     long-running job doesn't block everything behind it.
 * @param quarantineQueue  BQC-3.6 dead-letter queue. When provided, a job
 *                     whose attempt budget is spent is copied here (content-
 *                     safe envelope) instead of only sitting in BullMQ's
 *                     failed set under the removeOnFail cap.
 */
export function createJobWorker<T>(
  name: string,
  handler: JobHandler<T>,
  concurrency?: number,
  quarantineQueue?: Queue,
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
    concurrency,
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
    // BQC-3.6: attempts exhausted → dead-letter quarantine (content-safe).
    // Fire-and-forget with its own error containment — a quarantine write
    // failure must never take down the worker's failure path.
    if (quarantineQueue && job) {
      void quarantineExhaustedJob(quarantineQueue, job, err)
        .then((outcome) => {
          if (outcome.quarantined) {
            logger.error(
              { jobId: job.id, queue: name, quarantineJobId: outcome.quarantineJobId },
              'job exhausted attempts — moved to quarantine',
            )
          }
        })
        .catch((quarantineErr: unknown) => {
          logger.error(
            { err: quarantineErr, jobId: job.id, queue: name },
            'failed to quarantine exhausted job',
          )
        })
    }
  })

  return worker
}
