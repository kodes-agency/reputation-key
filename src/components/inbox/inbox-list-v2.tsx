import React from 'react'
import { Star } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Checkbox } from '#/components/ui/checkbox'
import { cn } from '#/lib/utils'
import { INBOX_BULK_LIMIT, type InboxItem } from '#/contexts/inbox/application/public-api'
import { formatDate, formatInboxListDate, formatReviewLanguage } from './utils'

type Props = Readonly<{
  items: ReadonlyArray<InboxItem>
  selectedIds: ReadonlyArray<string>
  activeItemId: string | undefined
  onToggleSelect: (id: string) => void
  onRowClick: (item: InboxItem) => void
}>

function CompactRating({ rating }: Readonly<{ rating: number | null }>) {
  if (rating === null) return null
  return (
    <span
      className="flex items-center gap-1 font-medium tabular-nums"
      aria-label={`${rating} out of 5 stars`}
    >
      <Star className="size-4 fill-primary text-primary" aria-hidden="true" />
      {rating.toFixed(1)}
    </span>
  )
}

function listItemContent(item: InboxItem): string {
  if (item.contentAvailability === 'rating_only') return 'Rating only'
  if (item.contentAvailability === 'unavailable') return 'Content unavailable'
  return item.snippet?.trim() || 'Content unavailable'
}

const ListItemRow = React.memo(function ListItemRow({
  item,
  isChecked,
  isActive,
  selectionAtLimit,
  onToggleSelect,
  onRowClick,
}: Readonly<{
  item: InboxItem
  isChecked: boolean
  isActive: boolean
  selectionAtLimit: boolean
  onToggleSelect: (id: string) => void
  onRowClick: (item: InboxItem) => void
}>) {
  const language = formatReviewLanguage(item.reviewLanguageCode)
  const reviewer =
    item.reviewerName ?? (item.sourceType === 'feedback' ? 'Guest feedback' : 'Anonymous')
  const content = listItemContent(item)
  const selectionDisabled = selectionAtLimit && !isChecked
  return (
    <div
      role="listitem"
      className={cn(
        'group flex items-start gap-4 border-b border-l-2 px-5 py-4 transition-colors hover:bg-accent/30',
        isActive ? 'border-l-primary bg-accent/60' : 'border-l-transparent',
      )}
    >
      <Checkbox
        className="mt-1"
        checked={isChecked}
        disabled={selectionDisabled}
        onCheckedChange={() => onToggleSelect(item.id)}
        aria-label={
          selectionDisabled
            ? `Select item from ${reviewer} (${INBOX_BULK_LIMIT} item limit reached)`
            : `Select item from ${reviewer}`
        }
      />
      <div
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'true' : undefined}
        aria-label={`Open ${item.sourceType} from ${reviewer}`}
        className="min-w-0 flex-1 cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onRowClick(item)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onRowClick(item)
          }
        }}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{reviewer}</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {item.propertyName ?? 'Property unavailable'}
              {item.platform && <span className="capitalize"> · {item.platform}</span>}
              {language && <span> · {language}</span>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-sm">
            <CompactRating rating={item.rating} />
            <time
              className="text-muted-foreground tabular-nums"
              dateTime={new Date(item.sourceDate).toISOString()}
              title={formatDate(item.sourceDate)}
            >
              {formatInboxListDate(item.sourceDate)}
            </time>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-end gap-2">
          <p
            className={cn(
              'min-w-0 flex-1 text-sm leading-relaxed',
              item.contentAvailability === 'text' || item.snippet
                ? 'line-clamp-2'
                : 'text-muted-foreground',
            )}
          >
            {content}
          </p>
          {item.attention === 'urgent' && (
            <Badge
              variant="outline"
              className="border-destructive/20 bg-destructive/10 text-destructive"
            >
              Urgent
            </Badge>
          )}
        </div>
      </div>
    </div>
  )
})

export function InboxListV2({
  items,
  selectedIds,
  activeItemId,
  onToggleSelect,
  onRowClick,
}: Props) {
  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds])
  const selectionAtLimit = selectedIds.length >= INBOX_BULK_LIMIT
  return (
    <div role="list" aria-label="Inbox items" className="flex flex-col">
      {items.map((item) => (
        <ListItemRow
          key={item.id}
          item={item}
          isChecked={selectedSet.has(item.id)}
          isActive={activeItemId === item.id}
          selectionAtLimit={selectionAtLimit}
          onToggleSelect={onToggleSelect}
          onRowClick={onRowClick}
        />
      ))}
    </div>
  )
}
