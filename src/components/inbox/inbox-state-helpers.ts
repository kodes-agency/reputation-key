// Inbox state helpers — pure predicates + a navigation sub-hook, split from
// use-inbox-state.ts for line-count compliance. (Paging/error appliers removed —
// TanStack Query owns those now.)

import { useCallback } from 'react'
import type { InboxSearchParams } from '#/components/inbox/inbox-search-schema'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

export type InboxNavigate = (opts: {
  to: '.'
  search: (prev: InboxSearchParams) => Partial<InboxSearchParams>
}) => void

export type SelectedItemPresenceAction = 'keep' | 'remember' | 'close' | 'reset'

/**
 * Distinguish an item that left a queue from a direct link whose item was
 * never in that queue. The latter still has an independently authorized
 * detail read and must remain open while that read resolves.
 */
export const selectedItemPresenceAction = (
  seenSelectedId: string | undefined,
  selectedId: string | undefined,
  isLoading: boolean,
  items: ReadonlyArray<InboxItem>,
): SelectedItemPresenceAction => {
  if (!selectedId) return 'reset'
  if (items.some((item) => item.id === selectedId)) return 'remember'
  if (!isLoading && seenSelectedId === selectedId) return 'close'
  return 'keep'
}

/** Stable row-click / close-detail callbacks derived from the navigate fn. */
export function useInboxNavigation(onNavigate: InboxNavigate) {
  const handleRowClick = useCallback(
    (item: InboxItem) =>
      onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: item.id }) }),
    [onNavigate],
  )
  const closeDetail = useCallback(
    () => onNavigate({ to: '.', search: (prev) => ({ ...prev, itemId: undefined }) }),
    [onNavigate],
  )
  return { handleRowClick, closeDetail }
}
