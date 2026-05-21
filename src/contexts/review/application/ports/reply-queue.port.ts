// Review context — reply queue port for BullMQ publish job dispatch

export type PublishReplyJobData = Readonly<{
  replyId: string
  organizationId: string
}>

export type ReplyQueuePort = Readonly<{
  addPublishJob: (data: PublishReplyJobData) => Promise<void>
}>
