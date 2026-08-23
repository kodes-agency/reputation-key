import type { ReactNode } from 'react'
import { Menu, Search } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { InboxFilterPopover } from './inbox-filter-popover'
import type { InboxListFilterValues } from './inbox-filters'

type Props = Readonly<{
  folderLabel: string
  totalCount: number
  searchQ: string | undefined
  filters: InboxListFilterValues
  sort: InboxSort
  onSearchChange: (q: string | undefined) => void
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  onOpenSidebar?: () => void
  selectionToolbar?: ReactNode
}>

export function InboxListHeader({
  folderLabel,
  totalCount,
  searchQ,
  filters,
  sort,
  onSearchChange,
  onFiltersChange,
  onSortChange,
  onOpenSidebar,
  selectionToolbar,
}: Props) {
  return (
    <header className="shrink-0 border-b px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {onOpenSidebar && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-2 md:hidden"
            onClick={onOpenSidebar}
            aria-label="Open folders"
          >
            <Menu />
          </Button>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight">{folderLabel}</h1>
        <Badge variant="secondary" className="tabular-nums">
          {totalCount}
        </Badge>
      </div>

      {selectionToolbar ?? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <InputGroup className="h-10 min-w-48 flex-1 basis-64">
            <InputGroupInput
              aria-label="Search reviews"
              placeholder="Search reviews..."
              value={searchQ ?? ''}
              onChange={(event) => onSearchChange(event.target.value || undefined)}
            />
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
          <InboxFilterPopover value={filters} onChange={onFiltersChange} />
          <Select
            value={sort}
            onValueChange={(value) => onSortChange(value as InboxSort)}
          >
            <SelectTrigger className="h-10 w-32" aria-label="Sort reviews">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
    </header>
  )
}
