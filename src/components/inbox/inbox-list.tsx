import { Checkbox } from '#/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { InboxStatusBadge } from './inbox-status-badge'
import { Star, ExternalLink } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

type Props = Readonly<{
  items: ReadonlyArray<InboxItem>
  selectedIds: ReadonlyArray<string>
  onToggleSelect: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onRowClick: (item: InboxItem) => void
}>

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(typeof date === 'string' ? new Date(date) : date)
}

function RatingDisplay({ rating }: Readonly<{ rating: number | null }>) {
  if (rating === null) return <span className="text-muted-foreground">–</span>
  return (
    <div className="flex items-center gap-1">
      <Star className="size-3.5 fill-yellow-400 text-yellow-400" />
      <span className="text-sm font-medium">{rating}</span>
    </div>
  )
}

export function InboxList({
  items,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onRowClick,
}: Props) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id))
  const someSelected = selectedIds.length > 0 && !allSelected

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40px]">
            <Checkbox
              checked={allSelected}
              {...(someSelected ? { 'data-state': 'indeterminate' as const } : {})}
              onCheckedChange={(checked) => {
                if (checked) {
                  onSelectAll()
                } else {
                  onDeselectAll()
                }
              }}
              aria-label="Select all"
            />
          </TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const isSelected = selectedIds.includes(item.id)
          return (
            <TableRow
              key={item.id}
              className={`cursor-pointer ${isSelected ? 'bg-muted/50' : ''}`}
              onClick={() => onRowClick(item)}
            >
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(item.id)}
                  aria-label={`Select item ${item.id}`}
                />
              </TableCell>
              <TableCell>
                <InboxStatusBadge status={item.status} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm capitalize">{item.sourceType}</span>
                  {item.platform && (
                    <span className="text-xs text-muted-foreground capitalize">
                      {item.platform}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <RatingDisplay rating={item.rating} />
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {formatDate(item.sourceDate)}
                </span>
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRowClick(item)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
