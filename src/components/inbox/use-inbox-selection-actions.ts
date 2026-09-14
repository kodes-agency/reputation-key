import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { INBOX_BULK_LIMIT } from '#/contexts/inbox/application/public-api'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { toggleInboxSelection } from './inbox-selection'

type SelectionSetter = Dispatch<SetStateAction<ReadonlyArray<string>>>

export function useInboxSelectionActions(
  items: ReadonlyArray<InboxItem>,
  selectedItem: InboxItem | null,
  setSelectedIds: SelectionSetter,
) {
  const toggleSelectedItem = useCallback(() => {
    if (!selectedItem) return
    setSelectedIds((previous) => toggleInboxSelection(previous, selectedItem.id))
  }, [selectedItem, setSelectedIds])
  const toggleItem = useCallback(
    (id: string) => setSelectedIds((previous) => toggleInboxSelection(previous, id)),
    [setSelectedIds],
  )
  const selectAll = useCallback(
    () => setSelectedIds(items.slice(0, INBOX_BULK_LIMIT).map((item) => item.id)),
    [items, setSelectedIds],
  )
  const deselectAll = useCallback(() => setSelectedIds([]), [setSelectedIds])

  return {
    toggleSelectedItem: selectedItem ? toggleSelectedItem : undefined,
    toggleItem,
    selectAll,
    deselectAll,
  }
}
