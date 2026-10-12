import type { Queue } from 'bullmq'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { GOOGLE_PROPERTY_IMPORT_ITEM_JOB } from '../application/google-import-v2-contract'
import type { GoogleImportV2QueuePort } from '../application/ports/gbp-queue.port'

/**
 * How Google import items become queued jobs.
 *
 * One child import batch fans out up to 100 item jobs in a single addBulk, so
 * the queue depth is intentionally far above what the pool can execute at
 * once. Safety comes from the worker side, not from throttling here: the
 * worker's pool covers DEFAULT_QUEUE_CONCURRENCY * WORST_CASE_POOL_CLIENTS_PER_JOB
 * and every other queue (src/worker/pool-budget.ts), because each item holds its fenced
 * `FOR UPDATE` transaction while the nested Property effect opens a second
 * one. If that budget is ever violated, every worker slot holds a client
 * and the nested acquisitions deadlock until connectionTimeoutMillis.
 */
export function createGoogleImportV2Queue(
  jobQueue: Pick<Queue, 'addBulk'>,
): GoogleImportV2QueuePort {
  return {
    addImportItemJobs: async (jobs) => {
      if (jobs.length === 0) return
      const options = jobEnqueueOptions(GOOGLE_PROPERTY_IMPORT_ITEM_JOB)
      await jobQueue.addBulk(
        jobs.map((job) => {
          const execution = createJobExecutionEnvelope({
            organizationId: job.organizationId,
            capability: 'property.import_gbp_v2',
            initiator: {
              kind: 'system',
              id: 'outbox:google-property-import-dispatch',
            },
          })
          return {
            name: GOOGLE_PROPERTY_IMPORT_ITEM_JOB,
            data: { ...job, ...execution },
            opts: {
              jobId: job.jobId,
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 50 },
              ...options,
            },
          }
        }),
      )
    },
  }
}
