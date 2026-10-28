import {
  Archive,
  CircleCheck,
  CircleUserRound,
  Flag,
  Inbox,
  Layers,
  MessageSquareLock,
  MessageSquareText,
  Reply,
  Send,
  ShieldCheck,
  Star,
} from 'lucide-react'
import {
  replyQueueStage,
  type InboxItem,
  type InboxQueue,
  type InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import type { ReplyQueueStage } from '#/shared/domain/reply-queue-stage'
import type { LucideIcon } from 'lucide-react'
import { STAR_FILLED_CLASS } from './inbox-detail-helpers'

export type InboxQueueItem = Readonly<{
  key: InboxQueue
  label: string
  icon: LucideIcon
}>

/** The two kinds of work the Inbox holds, which the rail names and the rows mark. */
export type InboxKind = 'review' | 'feedback'

/**
 * The glyph that stands for a kind wherever the Inbox names it: the rail's
 * headings, a feedback row's "Private" badge and the detail header. A Review is
 * the rating star in the rating token; private feedback is the locked message
 * in the quiet ink, so a colour never carries the kind alone (the words always
 * do).
 */
export const KIND_GLYPH: Readonly<
  Record<InboxKind, Readonly<{ icon: LucideIcon; className: string }>>
> = {
  review: { icon: Star, className: STAR_FILLED_CLASS },
  feedback: { icon: MessageSquareLock, className: 'text-muted-foreground' },
}

const QUEUE_ITEMS: Readonly<Record<InboxQueue, InboxQueueItem>> = {
  reply: { key: 'reply', label: 'Needs reply', icon: Inbox },
  approval: { key: 'approval', label: 'Awaiting approval', icon: ShieldCheck },
  waiting: { key: 'waiting', label: 'Waiting for Google', icon: Send },
  replied: { key: 'replied', label: 'Replied', icon: Reply },
  feedback: { key: 'feedback', label: 'To handle', icon: MessageSquareText },
  handled: { key: 'handled', label: 'Handled', icon: CircleCheck },
  escalated: { key: 'escalated', label: 'Escalated', icon: Flag },
  mine: { key: 'mine', label: 'Mine', icon: CircleUserRound },
  // Kept as a key for compatibility; the rail lists Replied and Handled instead,
  // and an old `queue=closed` address is read as Replied at the URL boundary.
  closed: { key: 'closed', label: 'Closed', icon: Archive },
  // Every open item of both kinds: its own glyph, since the shared views sit
  // below the two sections and it is the one that contains them.
  open: { key: 'open', label: 'All open', icon: Layers },
}

/** Without reply stages the one reply row holds every open Review and reads "Open". */
const REPLY_WITHOUT_STAGES_LABEL = 'Open'

/** Which kind a queue holds, or null for a queue that mixes both. */
const QUEUE_KIND: Readonly<Record<InboxQueue, InboxKind | null>> = {
  reply: 'review',
  approval: 'review',
  waiting: 'review',
  replied: 'review',
  feedback: 'feedback',
  handled: 'feedback',
  escalated: null,
  mine: null,
  closed: null,
  open: null,
}

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

export function queueKind(queue: InboxQueue): InboxKind | null {
  return QUEUE_KIND[queue]
}

/**
 * The queue as the rail draws it. Without reply stages `reply` is the section's
 * one row of open Reviews, so only its label changes: the key, the icon and the
 * address stay.
 */
export function queueItem(queue: InboxQueue, hasReplyStages = true): InboxQueueItem {
  const item = QUEUE_ITEMS[queue]
  return queue === 'reply' && !hasReplyStages
    ? { ...item, label: REPLY_WITHOUT_STAGES_LABEL }
    : item
}

export function queueLabel(queue: InboxQueue, hasReplyStages = true): string {
  return queueItem(queue, hasReplyStages).label
}

export function queueCount(counts: InboxQueueCounts | undefined, queue: InboxQueue) {
  return counts?.[queue] ?? null
}

type EmptyCopy = Readonly<{ title: string; description?: string }>

const EMPTY_COPY: Readonly<Record<InboxQueue, EmptyCopy>> = {
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
  replied: {
    title: 'Nothing replied yet',
    description: 'Reviews move here once their reply is live on Google.',
  },
  feedback: {
    title: 'No feedback to handle',
    description:
      'Guests who rate low can send a private note from your guest page. It arrives here, never on Google.',
  },
  handled: {
    title: 'Nothing handled yet',
    description: 'Feedback you mark handled moves here.',
  },
  escalated: { title: 'Nothing escalated' },
  mine: { title: 'Nothing assigned to you' },
  closed: { title: 'Nothing closed yet' },
  open: { title: 'No open items' },
}

const EMPTY_COPY_WITHOUT_STAGES: EmptyCopy = {
  title: 'No open reviews',
  description: 'New reviews land here as Google delivers them — usually within the hour.',
}

export function inboxEmptyCopy(
  queue: InboxQueue,
  isFiltered: boolean,
  hasReplyStages = true,
): EmptyCopy {
  if (isFiltered) {
    return {
      title: 'No matches',
      description: 'Try another search or clear the filters.',
    }
  }
  return queue === 'reply' && !hasReplyStages
    ? EMPTY_COPY_WITHOUT_STAGES
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

/**
 * The reply stage a reply-stage queue admits, or null for any other queue and
 * for `reply` without stages, which admits every open Review.
 */
export function queueReplyStage(
  queue: InboxQueue,
  hasReplyStages = true,
): ReplyQueueStage | null {
  if (queue === 'reply') return hasReplyStages ? REPLY_QUEUE_STAGE.reply : null
  return queue === 'approval' || queue === 'waiting' ? REPLY_QUEUE_STAGE[queue] : null
}

export function itemMatchesQueue(
  item: InboxItem,
  queue: InboxQueue,
  viewerId: string | undefined,
  hasReplyStages = true,
): boolean {
  switch (queue) {
    case 'reply':
    case 'approval':
    case 'waiting': {
      const stage = queueReplyStage(queue, hasReplyStages)
      return (
        item.status === 'open' &&
        item.sourceType === 'review' &&
        (stage === null || replyStage(item) === stage)
      )
    }
    case 'replied':
      return item.status === 'closed' && item.sourceType === 'review'
    case 'feedback':
      return item.status === 'open' && item.sourceType === 'feedback'
    case 'handled':
      return item.status === 'closed' && item.sourceType === 'feedback'
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
