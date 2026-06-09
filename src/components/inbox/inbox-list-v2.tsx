// Inbox list v2 — Gmail-style 3-to-4-line rows.
// Row 1: reviewer + date + stars.
// Row 2-3: snippet (bold, 2 lines, as "subject").
// Row 4: property + platform + status badge.
import React from 'react'
import { Checkbox } from '#/components/ui/checkbox'
import { InboxStatusBadge } from './inbox-status-badge'
import { RatingStars } from './inbox-detail-helpers'
import { formatDate } from './utils'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

type InboxListV2Props = Readonly<{
  items: ReadonlyArray<InboxItem>
  selectedIds: ReadonlyArray<string>
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
}>

// FE-4 FIX: Wrap ListItemRow in React.memo to avoid re-renders when parent state changes
const ListItemRow = React.memo(function ListItemRow({
  item,
  isSelected,
  onToggleSelect,
  onRowClick,
}: {
  item: InboxItem
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onRowClick: (item: InboxItem) => void
}) {
  const isNew = item.status === 'new'

  return (
    <div
      className={`group flex items-start gap-3 border-b cursor-pointer transition-colors hover:bg-surface/50 px-4 py-3
        ${isSelected ? 'bg-surface-elevated' : ''}
        ${isNew ? 'border-l-2 border-l-primary rounded-l-sm' : 'border-l-2 border-l-transparent'}`}
      onClick={() => onRowClick(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onRowClick(item)
      }}
      role="option"
      aria-selected={isSelected}
    >
      <Checkbox
        className="mt-1"
        checked={isSelected}
        onCheckedChange={() => onToggleSelect(item.id)}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select item from ${item.reviewerName ?? 'unknown'}`}
      />
      <div className="min-w-0 flex-1">
        {/* Row 1: Reviewer name + date + stars */}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm truncate ${isNew ? 'font-semibold' : 'font-medium'}`}>
            {item.reviewerName ?? 'Anonymous'}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {formatDate(item.sourceDate)}
            </span>
            <RatingStars rating={item.rating} />
          </div>
        </div>
        {/* Row 2-3: Snippet as "subject", 2 lines */}
        {item.snippet ? (
          <p
            className={`line-clamp-2 mt-1 text-sm leading-relaxed ${isNew ? 'font-semibold' : 'font-medium'}`}
          >
            {item.snippet}
          </p>
        ) : (
          <p className="line-clamp-2 mt-1 text-sm leading-relaxed italic text-muted-foreground">
            No review text
          </p>
        )}
        {/* Row 4: Property + platform + status (Gmail pattern: hide badge for new/read) */}
        <div className="flex items-center gap-1.5 mt-1">
          <span className="capitalize truncate text-xs text-muted-foreground">
            {item.propertyName}
          </span>
          {item.platform && (
            <span className="shrink-0 text-xs text-muted-foreground/60 capitalize">
              · {item.platform}
            </span>
          )}
          {item.status !== 'new' && item.status !== 'read' && (
            <InboxStatusBadge status={item.status} />
          )}
        </div>
      </div>
    </div>
  )
})

export function InboxListV2({
  items,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onRowClick,
}: InboxListV2Props) {
  // FE-095 FIX: Use Set for O(1) lookup instead of Array.includes O(n)
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const allSelected = items.length > 0 && items.every((item) => selectedSet.has(item.id))

  return (
    // FE-17 FIX: Add ARIA listbox role for accessibility
    <div className="flex flex-col" role="listbox" aria-label="Inbox items">
      {/* Select-all checkbox row */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => {
            if (checked) onSelectAll()
            else onDeselectAll()
          }}
          aria-label="Select all"
        />
        <span className="text-xs text-muted-foreground">
          {selectedIds.length > 0
            ? `${selectedIds.length} selected`
            : `${items.length} items`}
        </span>
      </div>

      {items.map((item) => (
        <ListItemRow
          key={item.id}
          item={item}
          isSelected={selectedSet.has(item.id)}
          onToggleSelect={onToggleSelect}
          onRowClick={onRowClick}
        />
      ))}
    </div>
  )
}
