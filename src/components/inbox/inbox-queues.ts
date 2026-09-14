import {
  Archive,
  CircleUserRound,
  Flag,
  Inbox,
  MessageSquareText,
  Send,
  ShieldCheck,
} from 'lucide-react'
import type {
  InboxItem,
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
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
  open: { key: 'open', label: 'Open', icon: Inbox },
}

export const MANAGER_INBOX_QUEUES = [
  QUEUE_ITEMS.reply,
  QUEUE_ITEMS.approval,
  QUEUE_ITEMS.waiting,
  QUEUE_ITEMS.feedback,
  QUEUE_ITEMS.escalated,
  QUEUE_ITEMS.mine,
] as const

export const MEMBER_INBOX_QUEUES = [
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

function isWaitingReply(item: InboxItem): boolean {
  return item.replyState?.status === 'approved' || item.replyState?.status === 'published'
}

export function itemMatchesQueue(
  item: InboxItem,
  queue: InboxQueue,
  viewerId: string | undefined,
): boolean {
  switch (queue) {
    case 'reply':
      return (
        item.status === 'open' &&
        item.sourceType === 'review' &&
        item.replyState?.status !== 'pending_approval' &&
        !isWaitingReply(item)
      )
    case 'approval':
      return (
        item.status === 'open' &&
        item.sourceType === 'review' &&
        item.replyState?.status === 'pending_approval'
      )
    case 'waiting':
      return (
        item.status === 'open' && item.sourceType === 'review' && isWaitingReply(item)
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
