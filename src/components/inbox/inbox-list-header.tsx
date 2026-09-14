import { useState, type ReactNode } from 'react'
import { ArrowUpDown, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '#/components/ui/select'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { InboxFilterPopover } from './inbox-filter-popover'
import type { InboxListFilterValues } from './inbox-filters'
import { InboxListSearch } from './inbox-list-search'

type Props = Readonly<{
  queueLabel: string
  scopeLabel: string
  totalCount: number
  searchQ: string | undefined
  filters: InboxListFilterValues
  sort: InboxSort
  onSearchChange: (q: string | undefined) => void
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  onStartSelection?: () => void
  isCompactLayout?: boolean
  selectionToolbar?: ReactNode
}>

export function InboxListHeader({
  queueLabel,
  scopeLabel,
  totalCount,
  searchQ,
  filters,
  sort,
  onSearchChange,
  onFiltersChange,
  onSortChange,
  onStartSelection,
  isCompactLayout = false,
  selectionToolbar,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const searchVisible = searchOpen || searchQ !== undefined

  return (
    <header
      data-inbox-list-header
      className="flex h-14 shrink-0 items-center border-b px-3 max-md:h-11 max-md:px-2"
    >
      {selectionToolbar ??
        (searchVisible ? (
          <InboxListSearch
            value={searchQ}
            totalCount={totalCount}
            onChange={onSearchChange}
            onClose={() => setSearchOpen(false)}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 max-md:hidden">
                <h1 className="truncate text-sm font-semibold">{queueLabel}</h1>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {totalCount}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{scopeLabel}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="max-md:size-9"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </Button>
            <ButtonGroup>
              <InboxFilterPopover value={filters} onChange={onFiltersChange} />
              <Select
                value={sort}
                onValueChange={(value) => onSortChange(value as InboxSort)}
              >
                <SelectTrigger
                  size="sm"
                  className="max-md:size-9 max-md:px-0"
                  aria-label="Sort reviews"
                >
                  <ArrowUpDown className="size-4" aria-hidden="true" />
                  <span className="max-md:sr-only">
                    {sort === 'newest' ? 'Newest' : 'Oldest'}
                  </span>
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </ButtonGroup>
            {isCompactLayout && onStartSelection && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2"
                aria-label="Select items"
                onClick={onStartSelection}
              >
                Select
              </Button>
            )}
          </div>
        ))}
    </header>
  )
}
