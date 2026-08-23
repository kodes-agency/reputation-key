import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxFilters } from '#/contexts/inbox/application/ports/inbox.repository'

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

export function itemMatchesActiveFolder(
  item: InboxItem,
  filters: Partial<Pick<InboxFilters, 'status' | 'isEscalated'>>,
): boolean {
  const statusMatches = !filters.status
    ? true
    : Array.isArray(filters.status)
      ? filters.status.includes(item.status)
      : filters.status === item.status
  if (!statusMatches) return false
  if (filters.isEscalated === undefined) return true
  return filters.isEscalated
    ? item.isEscalated && item.escalationResolvedAt === null
    : !item.isEscalated
}

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
          updatedAt: updated.updatedAt,
        }
      : item,
  )
}
