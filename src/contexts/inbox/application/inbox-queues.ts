import type { InboxFilters } from './ports/inbox.repository'
import type { ReviewId, UserId } from '#/shared/domain/ids'
import { inboxError } from '../domain/errors'
import type { ReplyStatus } from '../domain/types'

export const INBOX_QUEUES = [
  'reply',
  'approval',
  'waiting',
  'feedback',
  'escalated',
  'mine',
  'closed',
  'open',
] as const

export type InboxQueue = (typeof INBOX_QUEUES)[number]
export type InboxReplyStage = 'needs_reply' | 'awaiting' | 'waiting'

export function replyStageForStatus(status: ReplyStatus): InboxReplyStage {
  if (status === 'pending_approval') return 'awaiting'
  if (status === 'approved' || status === 'published') return 'waiting'
  return 'needs_reply'
}

export type InboxReplyStages = Readonly<{
  awaiting: ReadonlyArray<ReviewId>
  waiting: ReadonlyArray<ReviewId>
}>

export type InboxQueueFilterContext = Readonly<{
  viewerId: UserId
  canManageReplies: boolean
  replyStages: InboxReplyStages
}>

export const REPLY_STAGE_QUEUES: ReadonlySet<InboxQueue> = new Set([
  'reply',
  'approval',
  'waiting',
])

export function queueToFilters(
  queue: InboxQueue,
  ctx: InboxQueueFilterContext,
): InboxFilters {
  if (REPLY_STAGE_QUEUES.has(queue) && !ctx.canManageReplies) {
    throw inboxError('forbidden', 'Reply queues require reply.manage')
  }

  switch (queue) {
    case 'reply':
      return {
        status: 'open',
        sourceType: 'review',
        replyStage: {
          match: 'exclude',
          reviewIds: [...ctx.replyStages.awaiting, ...ctx.replyStages.waiting],
        },
      }
    case 'approval':
      return {
        status: 'open',
        sourceType: 'review',
        replyStage: { match: 'include', reviewIds: ctx.replyStages.awaiting },
      }
    case 'waiting':
      return {
        status: 'open',
        sourceType: 'review',
        replyStage: { match: 'include', reviewIds: ctx.replyStages.waiting },
      }
    case 'feedback':
      return { status: 'open', sourceType: 'feedback' }
    case 'escalated':
      return { isEscalated: true }
    case 'mine':
      return { status: 'open', assignedTo: ctx.viewerId }
    case 'closed':
      return { status: 'closed' }
    case 'open':
      return { status: 'open' }
  }
}
