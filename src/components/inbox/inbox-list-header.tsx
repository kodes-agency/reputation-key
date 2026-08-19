// Inbox list panel header — title, open count badge, and search bar.
// Extracted from inbox-page-v2.tsx for max-lines compliance.
// Per ADR 0023: no All/Unaddressed tabs (Open folder IS the working view).
import { Menu, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

type Props = Readonly<{
  folderLabel: string
  openCount: number
  searchQ: string | undefined
  attention: 'urgent' | 'high' | 'medium' | 'low' | undefined
  onAttentionChange: (attention: 'urgent' | 'high' | 'medium' | 'low' | undefined) => void
  onSearchChange: (q: string | undefined) => void
  /** Opens the folder sidebar drawer (mobile only). */
  onOpenSidebar?: () => void
}>

export function InboxListHeader({
  folderLabel,
  openCount,
  searchQ,
  attention,
  onAttentionChange,
  onSearchChange,
  onOpenSidebar,
}: Props) {
  return (
    <div className="shrink-0 border-b px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {onOpenSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 size-8 md:hidden"
              onClick={onOpenSidebar}
              aria-label="Open folders"
            >
              <Menu className="size-4" />
            </Button>
          )}
          <h1 className="truncate text-lg font-semibold tracking-tight">{folderLabel}</h1>
          {openCount > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {openCount} open
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search reviews..."
            value={searchQ ?? ''}
            onChange={(e) => onSearchChange(e.target.value || undefined)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select
          value={attention ?? 'all'}
          onValueChange={(value) =>
            onAttentionChange(
              value === 'all'
                ? undefined
                : (value as 'urgent' | 'high' | 'medium' | 'low'),
            )
          }
        >
          <SelectTrigger
            size="sm"
            aria-label="Filter by AI attention"
            className="w-[112px] shrink-0"
          >
            <SelectValue placeholder="Attention" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All signals</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
