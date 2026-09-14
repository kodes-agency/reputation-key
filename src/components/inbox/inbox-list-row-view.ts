import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import { resolveInboxOwner, type InboxAssignmentOption } from './inbox-owner-view'
import { replyStateRowLabel } from './reply-state-copy'
import { formatCompactAge } from './utils'

export type InboxRowSignal = 'Escalated' | 'Urgent' | string

function inboxRowName(item: InboxItem): string {
  return (
    item.reviewerName ?? (item.sourceType === 'feedback' ? 'Guest feedback' : 'Anonymous')
  )
}

function inboxRowContent(item: InboxItem): string {
  if (item.contentAvailability === 'rating_only') {
    return 'Rating only — the guest left no text'
  }
  if (item.contentAvailability === 'unavailable') return 'Content unavailable'
  return item.snippet?.trim() || 'Content unavailable'
}

function inboxRowSignals(item: InboxItem): ReadonlyArray<InboxRowSignal> {
  const signals: string[] = []
  const reply = replyStateRowLabel(item.replyState)
  if (reply) signals.push(reply)
  if (item.isEscalated && item.escalationResolvedAt === null) signals.push('Escalated')
  if (item.attention === 'urgent') signals.push('Urgent')
  return signals
}

function isInboxRowNew(item: InboxItem, viewedUpTo: Date | null): boolean {
  return viewedUpTo !== null && new Date(item.createdAt).getTime() > viewedUpTo.getTime()
}

export function inboxRowView(
  item: InboxItem,
  options: Readonly<{
    assignmentOptions: ReadonlyArray<InboxAssignmentOption>
    currentUser?: InboxCurrentUser
    viewedUpTo: Date | null
    now?: Date
  }>,
) {
  const name = inboxRowName(item)
  const signals = inboxRowSignals(item)
  const isNew = isInboxRowNew(item, options.viewedUpTo)
  const suffix = [...signals, ...(isNew ? ['new'] : [])]
  return {
    name,
    content: inboxRowContent(item),
    signals,
    isNew,
    age: formatCompactAge(item.sourceDate, options.now),
    owner: resolveInboxOwner(
      item.assignedTo,
      options.assignmentOptions,
      options.currentUser,
    ),
    accessibleName: `Open ${item.sourceType} from ${name}${suffix.length ? `, ${suffix.join(', ')}` : ''}`,
  }
}
