import type { InboxFilters } from './ports/inbox.repository'
import type { ReviewId, UserId } from '#/shared/domain/ids'
import { inboxError } from '../domain/errors'
import {
  replyQueueStage,
  type ReplyQueueStage as InboxReplyStage,
} from '#/shared/domain/reply-queue-stage'

// `replied` and `handled` are the closed folders of the two kinds (ADR 0057,
// amended 2026-10-28). `closed`, every closed item whatever its kind, stays a
// valid key for API compatibility; the rail no longer lists it, and the client
// reads an old `queue=closed` address as `replied`.
export const INBOX_QUEUES = [
  'reply',
  'approval',
  'waiting',
  'replied',
  'feedback',
  'handled',
  'escalated',
  'mine',
  'closed',
  'open',
] as const

export type InboxQueue = (typeof INBOX_QUEUES)[number]

// One reply-stage rule for the server stage lookup and the browser queue
// matcher; see its module header for why it lives in shared/domain.
export { replyQueueStage, type InboxReplyStage }

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

/** The queues that exist only with reply stages: `reply` is also "every open Review" without them. */
const STAGE_ONLY_QUEUES: ReadonlySet<InboxQueue> = new Set(['approval', 'waiting'])

export function queueToFilters(
  queue: InboxQueue,
  ctx: InboxQueueFilterContext,
): InboxFilters {
  if (STAGE_ONLY_QUEUES.has(queue) && !ctx.canManageReplies) {
    throw inboxError('forbidden', 'Reply queues require reply.manage')
  }

  switch (queue) {
    case 'reply':
      // Without reply stages the rail's one reply row reads "Open" and holds
      // every open Review: no stage decides it, so no stage is withheld.
      if (!ctx.canManageReplies) return { status: 'open', sourceType: 'review' }
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
    case 'replied':
      return { status: 'closed', sourceType: 'review' }
    case 'feedback':
      return { status: 'open', sourceType: 'feedback' }
    case 'handled':
      return { status: 'closed', sourceType: 'feedback' }
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
