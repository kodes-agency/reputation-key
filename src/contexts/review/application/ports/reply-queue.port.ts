// Review context — reply queue port for BullMQ publish job dispatch

import type { JobPolicyContext } from '#/shared/jobs/delayed-execution-gate'

export type PublishReplyJobData = Readonly<{
  replyId: string
  organizationId: string
  /** BQC-3.2: content-free policy context stamped at enqueue. */
  policy?: JobPolicyContext
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
