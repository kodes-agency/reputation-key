// Inbox state helpers — pure appliers + a navigation sub-hook, split from
// use-inbox-state.ts for line-count compliance.

import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { InboxSearchParams } from '#/components/inbox/inbox-search-schema'
import type { InboxItem, Cursor } from '#/contexts/inbox/application/public-api'

export const LOAD_ERROR_MESSAGE =
  'Failed to load inbox items. Check your connection and try again.'

export type InboxNavigate = (opts: {
  to: '.'
  search: (prev: InboxSearchParams) => Partial<InboxSearchParams>
}) => void

type InboxPageResult = Readonly<{
  items?: ReadonlyArray<InboxItem>
  nextCursor?: Cursor | null
}>
type SetItems = Dispatch<SetStateAction<ReadonlyArray<InboxItem>>>
type SetCursor = Dispatch<SetStateAction<Cursor | null>>
type SetError = Dispatch<SetStateAction<string | null>>

/** Applies a successful page load: appends on pagination, replaces otherwise. */
export const applyLoadedPage = (
  result: InboxPageResult,
  cursor: Cursor | undefined,
  setItems: SetItems,
  setNextCursor: SetCursor,
): void => {
  const next = result.items ?? []
  if (cursor) setItems((prev) => [...prev, ...next])
  else setItems(next)
  setNextCursor(result.nextCursor ?? null)
}

/** Surfaces a load failure and clears the list on a fresh (non-paged) fetch. */
export const applyLoadError = (
  cursor: Cursor | undefined,
  setItems: SetItems,
  setError: SetError,
): void => {
  setError(LOAD_ERROR_MESSAGE)
  if (!cursor) setItems([])
}

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
