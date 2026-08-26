// Review context — reply queue port for BullMQ publish job dispatch

import type { JobEnqueueAttribution } from '#/shared/jobs/delayed-execution-gate'
import type { RoutingEnvelope } from '#/shared/routing/processing-router'

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
    /**
     * BQC-4.2: content-free routing envelope stamped at enqueue. Telemetry
     * only — the worker re-resolves routing at dispatch; a payload region is
     * never accepted as authority (ADR 0048).
     */
    routing?: RoutingEnvelope
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
