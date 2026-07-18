// Review context — reply queue port for BullMQ publish job dispatch

import type { JobPolicyContext } from '#/shared/jobs/delayed-execution-gate'

export type PublishReplyJobData = Readonly<{
  replyId: string
  organizationId: string
  /** BQC-3.2: content-free policy context stamped at enqueue. */
  policy?: JobPolicyContext
}>

export type ReplyQueuePort = Readonly<{
  addPublishJob: (data: PublishReplyJobData) => Promise<void>
}>
