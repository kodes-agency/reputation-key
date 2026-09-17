import {
  Archive,
  CircleUserRound,
  Flag,
  Inbox,
  Layers,
  MessageSquareText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import {
  replyQueueStage,
  type InboxItem,
  type InboxQueue,
  type InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import type { ReplyQueueStage } from '#/shared/domain/reply-queue-stage'
import type { LucideIcon } from 'lucide-react'

export type InboxQueueItem = Readonly<{
  key: InboxQueue
  label: string
  icon: LucideIcon
}>

const QUEUE_ITEMS: Readonly<Record<InboxQueue, InboxQueueItem>> = {
  reply: { key: 'reply', label: 'Needs reply', icon: Inbox },
  approval: { key: 'approval', label: 'Awaiting approval', icon: ShieldCheck },
  waiting: { key: 'waiting', label: 'Waiting for Google', icon: Send },
  feedback: { key: 'feedback', label: 'Feedback', icon: MessageSquareText },
  escalated: { key: 'escalated', label: 'Escalated', icon: Flag },
  mine: { key: 'mine', label: 'Mine', icon: CircleUserRound },
  closed: { key: 'closed', label: 'Closed', icon: Archive },
  // Every open item: Needs reply's stages plus feedback. Its own glyph, since
  // a manager's rail lists both.
  open: { key: 'open', label: 'Open', icon: Layers },
}

const MANAGER_INBOX_QUEUES = [
  QUEUE_ITEMS.reply,
  QUEUE_ITEMS.approval,
  QUEUE_ITEMS.waiting,
  QUEUE_ITEMS.feedback,
  QUEUE_ITEMS.escalated,
  QUEUE_ITEMS.mine,
  // The superset sits below the queues it contains. The Properties list's
  // "Needs attention" count opens it, so a manager lands on a highlighted queue.
  QUEUE_ITEMS.open,
] as const

const MEMBER_INBOX_QUEUES = [
  QUEUE_ITEMS.open,
  QUEUE_ITEMS.feedback,
  QUEUE_ITEMS.escalated,
  QUEUE_ITEMS.mine,
] as const

export const CLOSED_INBOX_QUEUE = QUEUE_ITEMS.closed

export function canUseReplyQueues(
  canManageReplies: boolean,
  canPublishReplies: boolean,
): boolean {
  return canManageReplies && canPublishReplies
}

const REPLY_QUEUES: ReadonlySet<InboxQueue> = new Set(['reply', 'approval', 'waiting'])

/** Queues whose membership the item's reply state decides (besides being an open review). */
export function isReplyStageQueue(queue: InboxQueue): boolean {
  return REPLY_QUEUES.has(queue)
}

export function resolveInboxQueue(
  requestedQueue: InboxQueue | undefined,
  canManageReplies: boolean,
): InboxQueue {
  if (requestedQueue && (canManageReplies || !REPLY_QUEUES.has(requestedQueue))) {
    return requestedQueue
  }

  return canManageReplies ? 'reply' : 'open'
}

export function queueLabel(queue: InboxQueue): string {
  return QUEUE_ITEMS[queue].label
}

export function queuesForViewer(
  canManageReplies: boolean,
): ReadonlyArray<InboxQueueItem> {
  return canManageReplies ? MANAGER_INBOX_QUEUES : MEMBER_INBOX_QUEUES
}

export function queueCount(counts: InboxQueueCounts | undefined, queue: InboxQueue) {
  return counts?.[queue] ?? null
}

const EMPTY_COPY: Readonly<
  Record<InboxQueue, Readonly<{ title: string; description?: string }>>
> = {
  reply: {
    title: 'Nothing needs a reply',
    description:
      'New reviews land here as Google delivers them — usually within the hour.',
  },
  approval: {
    title: 'No approvals waiting',
    description: 'Drafts your team submits appear here for you to confirm.',
  },
  waiting: {
    title: 'Nothing in flight',
    description: 'Replies you approve wait here until Google confirms them live.',
  },
  feedback: {
    title: 'No feedback to handle',
    description: 'Private feedback from your guests appears here.',
  },
  escalated: { title: 'Nothing escalated' },
  mine: { title: 'Nothing assigned to you' },
  closed: { title: 'Nothing closed yet' },
  open: { title: 'No open items' },
}

export function inboxEmptyCopy(queue: InboxQueue, isFiltered: boolean) {
  return isFiltered
    ? { title: 'No matches', description: 'Try another search or clear the filters.' }
    : EMPTY_COPY[queue]
}

// The browser mirror of the server stage lookup: both apply the shared
// `replyQueueStage` rule, so an optimistic patch keeps a row exactly where the
// next list read will put it. A review without a reply needs one.
function replyStage(item: InboxItem) {
  return item.replyState ? replyQueueStage(item.replyState) : 'needs_reply'
}

const REPLY_QUEUE_STAGE = {
  reply: 'needs_reply',
  approval: 'awaiting',
  waiting: 'waiting',
} as const

/** The reply stage a reply-stage queue admits, or null for any other queue. */
export function queueReplyStage(queue: InboxQueue): ReplyQueueStage | null {
  return queue === 'reply' || queue === 'approval' || queue === 'waiting'
    ? REPLY_QUEUE_STAGE[queue]
    : null
}

export function itemMatchesQueue(
  item: InboxItem,
  queue: InboxQueue,
  viewerId: string | undefined,
): boolean {
  switch (queue) {
    case 'reply':
    case 'approval':
    case 'waiting':
      return (
        item.status === 'open' &&
        item.sourceType === 'review' &&
        replyStage(item) === REPLY_QUEUE_STAGE[queue]
      )
    case 'feedback':
      return item.status === 'open' && item.sourceType === 'feedback'
    case 'escalated':
      return item.isEscalated && item.escalationResolvedAt === null
    case 'mine':
      return item.status === 'open' && !!viewerId && item.assignedTo === viewerId
    case 'closed':
      return item.status === 'closed'
    case 'open':
      return item.status === 'open'
  }
}
