// Review context — reply queue port for BullMQ publish job dispatch

import type { JobEnqueueAttribution } from '#/shared/jobs/delayed-execution-gate'

export type PublishReplyJobData = JobEnqueueAttribution &
  Readonly<{
    replyId: string
    organizationId: string
    /** Monotonic authorization generation. */
    publicationCycle: number
    /** Provider/source tuple frozen by manager authorization. */
    propertyId: string
    sourceEpoch: number
    materialReviewRevision: number
    baseObservationRevision: number
  }>

/**
 * The BullMQ jobId is the publication idempotency key
 * (reply-{replyId}-v{publicationCycle}), so a duplicate enqueue of the same
 * approval cycle is deduped instead of running the provider publish twice.
 */
export type ReplyQueuePort = Readonly<{
  addPublishJob: (data: PublishReplyJobData) => Promise<void>
}>
