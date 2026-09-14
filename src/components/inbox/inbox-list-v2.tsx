import { useMemo } from 'react'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import type { InboxCurrentUser } from './inbox-case-toolbar-props'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { InboxListRow } from './inbox-list-row'

export function InboxListV2({
  items,
  selectedIds,
  activeItemId,
  selectionMode = false,
  allProperties = false,
  assignmentOptions = [],
  currentUser,
  viewedUpTo = null,
  onToggleSelect,
  onRowClick,
}: Readonly<{
  items: ReadonlyArray<InboxItem>
  selectedIds: ReadonlyArray<string>
  activeItemId: string | undefined
  selectionMode?: boolean
  allProperties?: boolean
  assignmentOptions?: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  viewedUpTo?: Date | null
  onToggleSelect: (id: string) => void
  onRowClick: (item: InboxItem) => void
}>) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectionAtLimit = selectedIds.length >= INBOX_BULK_LIMIT
  return (
    <div role="list" aria-label="Inbox items" className="flex flex-col">
      {items.map((item) => (
        <InboxListRow
          key={item.id}
          item={item}
          isChecked={selectedSet.has(item.id)}
          isActive={activeItemId === item.id}
          selectionAtLimit={selectionAtLimit}
          selectionMode={selectionMode || selectedIds.length > 0}
          allProperties={allProperties}
          assignmentOptions={assignmentOptions}
          currentUser={currentUser}
          viewedUpTo={viewedUpTo}
          onToggleSelect={onToggleSelect}
          onOpen={onRowClick}
        />
      ))}
    </div>
  )
}
