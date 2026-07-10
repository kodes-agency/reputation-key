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

/** True when the selected item is no longer present in the loaded list — the
 *  detail panel should close in that case. */
export const isSelectedItemMissing = (
  selectedId: string | undefined,
  isLoading: boolean,
  items: ReadonlyArray<InboxItem>,
): boolean =>
  !!selectedId &&
  !isLoading &&
  items.length > 0 &&
  !items.some((i) => i.id === selectedId)

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
