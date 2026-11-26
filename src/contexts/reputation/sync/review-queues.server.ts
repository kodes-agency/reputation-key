import type { Queue } from 'bullmq'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import type {
  ReviewHeadCheckQueuePort,
  ReviewProviderJobData,
  ReviewQueuePort,
  TargetedGoogleReviewQueuePort,
} from './review-queue.port.server'
import type { ReplyQueuePort } from '../publication/reply-queue.port.server'
import { buildIdempotencyKey } from '../domain/reply-publication-workflow'

/** The Review context's job producers over one BullMQ queue. */
export function createReviewQueues(jobQueue: Pick<Queue, 'add'>): Readonly<{
  queue: ReviewQueuePort
  targetedQueue: TargetedGoogleReviewQueuePort
  headCheckQueue: ReviewHeadCheckQueuePort
  replyQueue: ReplyQueuePort
}> {
  /**
   * Every sync-property-reviews job (a snapshot step, a push-targeted fetch, a
   * head check): one family, one capability, one retry row and retention. Only
   * the default initiator, the job id and the start delay differ.
   */
  const addSyncPropertyReviewsJob = async (
    data: ReviewProviderJobData,
    defaultInitiatorId: string,
    options?: Readonly<{ jobId?: string; delayMs?: number }>,
  ): Promise<void> => {
    const execution = createJobExecutionEnvelope({
      organizationId: data.organizationId,
      propertyId: data.propertyId,
      capability: 'property.connect_gbp',
      initiator: data.initiator ?? { kind: 'system', id: defaultInitiatorId },
      correlationId: data.correlationId,
    })
    await jobQueue.add(
      'sync-property-reviews',
      { ...data, ...execution },
      {
        jobId: options?.jobId,
        ...(options?.delayMs === undefined ? {} : { delay: options.delayMs }),
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        // Attempts/backoff+jitter/timeout from the job catalogue.
        ...jobEnqueueOptions('sync-property-reviews'),
      },
    )
  }

  const queue: ReviewQueuePort = {
    addSyncJob: (data, options) =>
      addSyncPropertyReviewsJob(data, 'queue:review-sync', options),
  }

  const targetedQueue: TargetedGoogleReviewQueuePort = {
    addTargetedFetchJob: (data, options) =>
      addSyncPropertyReviewsJob(data, 'queue:review-targeted', options),
  }

  // A head check is a sync-property-reviews job of mode 'head', with a
  // deterministic job id per Property and interval bucket (reputation/domain/head-check.ts).
  const headCheckQueue: ReviewHeadCheckQueuePort = {
    addHeadCheckJob: (data, options) =>
      addSyncPropertyReviewsJob(data, 'queue:review-head', options),
  }

  const replyQueue: ReplyQueuePort = {
    addPublishJob: async (data) => {
      const execution = createJobExecutionEnvelope({
        organizationId: data.organizationId,
        propertyId: data.propertyId,
        capability: 'property.publish_reply',
        initiator: data.initiator ?? { kind: 'system', id: 'queue:reply-publish' },
        correlationId: data.correlationId,
      })
      await jobQueue.add(
        'publish-reply',
        { ...data, ...execution },
        {
          // Saga idempotency key as BullMQ jobId — a duplicate enqueue
          // of the same approval cycle is deduped by the queue.
          jobId: buildIdempotencyKey(data.replyId, data.publicationCycle),
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          // Attempts/backoff+jitter/timeout from the job catalogue
          // (job-definitions.ts publish-reply: 5 attempts, exponential
          // from 30 s; job-policy.ts 0.5 jitter, so the first retry lands
          // 15-30 s later; 120 s timeout). Only a retryable failure spends
          // them on another write; an uncertain send is re-read on the D3
          // schedule and never written again.
          ...jobEnqueueOptions('publish-reply'),
        },
      )
    },
  }

  return { queue, targetedQueue, headCheckQueue, replyQueue }
}
