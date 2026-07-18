// Review context — reply queue port for BullMQ publish job dispatch

import type { JobPolicyContext } from '#/shared/jobs/delayed-execution-gate'
import type { RoutingEnvelope } from '#/shared/routing/processing-router'

export type PublishReplyJobData = Readonly<{
  replyId: string
  organizationId: string
  /** BQC-3.2: content-free policy context stamped at enqueue. */
  policy?: JobPolicyContext
  /**
   * BQC-4.2: content-free routing envelope stamped at enqueue. Telemetry
   * only — the worker re-resolves routing at dispatch; a payload region is
   * never accepted as authority (ADR 0048).
   */
  routing?: RoutingEnvelope
}>

export type AddPublishJobOptions = Readonly<{
  /**
   * BQC-3.3: saga idempotency key (reply:{replyId}:v{sourceVersion}) used as
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
