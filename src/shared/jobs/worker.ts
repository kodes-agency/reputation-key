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
import { captureObservabilityException } from '#/shared/observability/telemetry'
import { isAttemptsExhausted, quarantineExhaustedJob } from './failure-quarantine'
import type { JobHandler } from './registry'
import { Redis } from 'ioredis'
import { getJobRedisUrl } from './redis-topology'

export type { Job }
export type { JobHandler }

/**
 * BullMQ lock/stall ordering — REQUIRED INVARIANT.
 *
 * A domain claim lease (the longest today is the Google-import item claim,
 * `GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS` = 60s) MUST be strictly shorter than
 * `JOB_LOCK_DURATION_MS`:
 *
 *   longest domain claim lease (60s) < JOB_LOCK_DURATION_MS (90s)
 *                                    <= JOB_STALLED_INTERVAL_MS (90s)
 *
 * Why: a job is stalled once its lock expires, and BullMQ permits exactly one
 * stalled recovery (maxStalledCount default 1). With the library defaults
 * (30s/30s) a killed worker's job is re-dispatched while the 60s claim lease
 * is STILL VALID, so the re-run cannot claim the row — it burns the single
 * permitted recovery and the row stays 'processing' until its effect
 * deadline. Pinning the lock above the lease means the first stalled recovery
 * always finds an expired lease and can take the claim under a fresh fence.
 *
 * The lock is auto-renewed every JOB_LOCK_DURATION_MS/2 while the process
 * lives, so a legitimately long job is never falsely stalled; expiry means
 * the process died or blocked its event loop.
 */
export const JOB_LOCK_DURATION_MS = 90_000
export const JOB_STALLED_INTERVAL_MS = 90_000

/**
 * Peak concurrent pool clients held by ONE in-flight job. The Google-import
 * item job is the worst case: `runClaimedEffect` holds a `FOR UPDATE`
 * transaction on the item row while the nested Property effect opens its own
 * transaction — two clients at once.
 */
export const WORST_CASE_POOL_CLIENTS_PER_JOB = 2

/**
 * Default-queue concurrency. REQUIRED INVARIANT:
 *
 *   DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB
 *     <= POOL_MAX_CONNECTIONS   (see #/shared/db/pool)
 *
 * 4 * 2 = 8 of 10, leaving 2 clients for the background worker, the outbox
 * relay and health probes in the same process. Setting this EQUAL to the pool
 * max (as it was) is a deterministic deadlock: every slot sits inside
 * `runClaimedEffect` holding a client, every nested acquisition then waits
 * out `connectionTimeoutMillis`, and the items are reported as spurious
 * `temporarily_unavailable`. The invariant is pinned by worker.test.ts.
 */
export const DEFAULT_QUEUE_CONCURRENCY = 4

/** Background queue concurrency — single-client maintenance sweeps. */
export const BACKGROUND_QUEUE_CONCURRENCY = 3

/**
 * Create a BullMQ worker for the given queue name.
 * Uses a dedicated Redis connection with maxRetriesPerRequest=null
 * (required by BullMQ for blocking BRPOPLPUSH operations).
 * Returns undefined if queue Redis is not configured. Production requires
 * QUEUE_REDIS_URL; development/test may fall back to REDIS_URL.
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
  const redisUrl = getJobRedisUrl(env)
  if (!redisUrl) return undefined

  const logger = getLogger()

  // BullMQ Worker requires maxRetriesPerRequest=null for blocking connections.
  // Cannot share the caching Redis client which uses maxRetriesPerRequest=3.
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  })

  const worker = new Worker<T>(name, handler, {
    connection: connection as unknown as import('bullmq').ConnectionOptions,
    concurrency,
    // Ordering invariant documented on the constants above: the domain claim
    // lease must expire before BullMQ hands the job to a stalled recovery.
    lockDuration: JOB_LOCK_DURATION_MS,
    stalledInterval: JOB_STALLED_INTERVAL_MS,
    limiter: {
      max: 10,
      duration: 1000,
    },
  })

  // EventEmitter's `error` event throws when it has no listener. BullMQ also
  // re-emits dedicated and blocking Redis connection errors here, so this is
  // the single structured, centrally redacted path for runtime queue faults.
  worker.on('error', (err: Error) => {
    logger.error({ component: 'bullmq-worker', queue: name, err }, 'BullMQ worker error')
    captureObservabilityException(err, { source: 'bullmq-worker', queue: name })
  })

  worker.on('completed', (job: Job<T>) => {
    logger.info({ queue: name, jobName: job.name }, 'job completed')
  })

  worker.on('failed', (job: Job<T> | undefined, err: Error) => {
    logger.error(
      {
        queue: name,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'job failed',
    )
    if (job && isAttemptsExhausted(job)) {
      captureObservabilityException(err, {
        source: 'bullmq-job',
        queue: name,
        jobName: job.name,
      })
    }
    // BQC-3.6: attempts exhausted → dead-letter quarantine (content-safe).
    // Fire-and-forget with its own error containment — a quarantine write
    // failure must never take down the worker's failure path.
    if (quarantineQueue && job) {
      void quarantineExhaustedJob(quarantineQueue, job, err)
        .then((outcome) => {
          if (outcome.quarantined) {
            logger.error(
              { queue: name, jobName: job.name },
              'job exhausted attempts — moved to quarantine',
            )
          }
        })
        .catch((quarantineErr: unknown) => {
          logger.error(
            { err: quarantineErr, queue: name, jobName: job.name },
            'failed to quarantine exhausted job',
          )
        })
    }
  })

  return worker
}
