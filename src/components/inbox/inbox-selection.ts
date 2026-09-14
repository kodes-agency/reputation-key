import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import { itemMatchesQueue as matchesQueue } from './inbox-queues'

export function toggleInboxSelection(
  previous: ReadonlyArray<string>,
  id: string,
): ReadonlyArray<string> {
  if (previous.includes(id)) return previous.filter((selected) => selected !== id)
  if (previous.length >= INBOX_BULK_LIMIT) return previous
  return [...previous, id]
}

export function removeInboxSelection(
  previous: ReadonlyArray<string>,
  id: string,
): ReadonlyArray<string> {
  return previous.includes(id) ? previous.filter((selected) => selected !== id) : previous
}

export const itemMatchesQueue = (
  item: InboxItem,
  queue: InboxQueue,
  viewerId: string | undefined,
) => matchesQueue(item, queue, viewerId)

export function reconcileInboxPageItems(
  items: ReadonlyArray<InboxItem>,
  updated: InboxItem,
  visible: boolean,
): ReadonlyArray<InboxItem> {
  if (!visible) return items.filter((item) => item.id !== updated.id)
  return items.map((item) =>
    item.id === updated.id
      ? {
          ...item,
          status: updated.status,
          isEscalated: updated.isEscalated,
          escalatedAt: updated.escalatedAt,
          escalatedBy: updated.escalatedBy,
          escalationResolvedAt: updated.escalationResolvedAt,
          escalationResolvedBy: updated.escalationResolvedBy,
          assignedTo: updated.assignedTo,
          replyState: updated.replyState,
          updatedAt: updated.updatedAt,
        }
      : item,
  )
}
