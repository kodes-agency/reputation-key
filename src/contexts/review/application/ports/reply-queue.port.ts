// Review context — reply queue port for BullMQ publish job dispatch

import type { JobEnqueueAttribution } from '#/shared/jobs/delayed-execution-gate'

export type PublishReplyJobData = JobEnqueueAttribution &
  Readonly<{
    replyId: string
    organizationId: string
    /**
     * Monotonic authorization generation. Required for current producers;
     * optional only so a bounded pre-RPL-01 in-flight job can be recognized
     * as legacy by the worker (legacy rows have cycle 0).
     */
    publicationCycle?: number
    /** Provider/source tuple frozen by manager authorization. */
    propertyId?: string
    sourceEpoch?: number
    materialReviewRevision?: number
    baseObservationRevision?: number
  }>

export type AddPublishJobOptions = Readonly<{
  /**
   * RPL-01: saga idempotency key (reply-{replyId}-v{publicationCycle}) used as
   * the BullMQ jobId so a duplicate enqueue of the same approval cycle is
   * deduped instead of running the provider publish twice.
   */
  idempotencyKey?: string
}>

export type ReplyQueuePort = Readonly<{
  addPublishJob: (
    data: PublishReplyJobData,
    options?: AddPublishJobOptions,
  ) => Promise<void>
}>
