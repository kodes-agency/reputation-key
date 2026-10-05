import { useState, type ReactNode } from 'react'
import { ArrowDownUp, Search } from 'lucide-react'
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
import { useIsMobile } from '#/components/hooks/use-mobile'
import { InboxFilterPopover } from './inbox-filter-popover'
import { InboxFilterSheet } from './inbox-filter-sheet'
import type { InboxListFilterValues } from './inbox-filters'
import { InboxListSearch } from './inbox-list-search'
import { IconButton } from '#/components/ui/icon-button'

type Props = Readonly<{
  queueLabel: string
  scopeLabel: string
  /** Replaces the plain scope line when the scope can be changed from here. */
  scopeControl?: ReactNode
  totalCount: number
  /** What the queue holds before any search or filter; null until its count has arrived. */
  queueTotal: number | null
  searchQ: string | undefined
  filters: InboxListFilterValues
  sort: InboxSort
  /** The list is on its way: the phone sheet's results button stops quoting a count. */
  isLoading?: boolean
  onSearchChange: (q: string | undefined) => void
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  /** Drops the search and every filter in one navigation; the sort stays. */
  onClearFilters: () => void
  onStartSelection?: () => void
  isCompactLayout?: boolean
  selectionToolbar?: ReactNode
}>

type ControlsProps = Readonly<{
  filters: InboxListFilterValues
  sort: InboxSort
  onOpenSearch: () => void
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  onStartSelection?: () => void
}>

type SelectButtonProps = Readonly<{ className: string; onClick: () => void }>

function SelectButton({ className, onClick }: SelectButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      aria-label="Select items"
      onClick={onClick}
    >
      Select
    </Button>
  )
}

/**
 * Phone bar: 36px controls on the 44px bar. Sort lives in the filter sheet, so
 * nothing here needs a select trigger, which `data-[size=sm]:h-8` would pin to
 * 32px whatever a breakpoint utility says. Select is a text button, so
 * `-mr-2` (its px-2) puts the word, not the box, on the 16px gutter.
 *
 * Phone or not is `useIsMobile`'s answer, on the server as on the client, so the
 * first paint gets whichever bar that hook decides, the same way the compact
 * layout follows `useInboxCompactLayout`.
 */
function PhoneControls({
  filters,
  sort,
  totalCount,
  isLoading,
  onOpenSearch,
  onFiltersChange,
  onSortChange,
  onClearFilters,
  onStartSelection,
}: ControlsProps &
  Readonly<{
    totalCount: number
    isLoading: boolean
    onClearFilters: () => void
  }>) {
  return (
    <>
      <IconButton variant="ghost" size="icon" label="Search" onClick={onOpenSearch}>
        <Search />
      </IconButton>
      <InboxFilterSheet
        filters={filters}
        sort={sort}
        totalCount={totalCount}
        isLoading={isLoading}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onClearFilters={onClearFilters}
      />
      {onStartSelection && (
        <SelectButton className="-mr-2 h-9 px-2" onClick={onStartSelection} />
      )}
    </>
  )
}

/** Tablet and desktop bar: 32px controls, the filter popover and the sort select. */
function WideControls({
  filters,
  sort,
  onOpenSearch,
  onFiltersChange,
  onSortChange,
  onStartSelection,
}: ControlsProps) {
  return (
    <>
      <IconButton variant="ghost" size="icon-sm" label="Search" onClick={onOpenSearch}>
        <Search />
      </IconButton>
      <ButtonGroup>
        <InboxFilterPopover value={filters} onChange={onFiltersChange} />
        <Select value={sort} onValueChange={(value) => onSortChange(value as InboxSort)}>
          <SelectTrigger size="sm" aria-label="Sort reviews">
            <ArrowDownUp className="size-4" aria-hidden="true" />
            <span>{sort === 'newest' ? 'Newest' : 'Oldest'}</span>
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </ButtonGroup>
      {onStartSelection && (
        <SelectButton className="h-8 px-2" onClick={onStartSelection} />
      )}
    </>
  )
}

export function InboxListHeader({
  queueLabel,
  scopeLabel,
  scopeControl,
  totalCount,
  queueTotal,
  searchQ,
  filters,
  sort,
  isLoading = false,
  onSearchChange,
  onFiltersChange,
  onSortChange,
  onClearFilters,
  onStartSelection,
  isCompactLayout = false,
  selectionToolbar,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const isMobile = useIsMobile()
  const searchVisible = searchOpen || searchQ !== undefined
  const openSearch = () => setSearchOpen(true)
  // Only the compact layout offers the Select button.
  const startSelection = isCompactLayout ? onStartSelection : undefined
  // Search and the selection toolbar take the whole header over, the visible heading
  // with it. The page keeps its one h1 (FRAME-10): read, not drawn.
  const takenOver = (selectionToolbar ?? null) !== null || searchVisible

  return (
    <header
      data-inbox-list-header
      className="flex h-14 shrink-0 items-center border-b px-3 max-md:h-11 max-md:px-4"
    >
      {takenOver ? <h1 className="sr-only">{queueLabel}</h1> : null}
      {selectionToolbar ??
        (searchVisible ? (
          <InboxListSearch
            value={searchQ}
            totalCount={totalCount}
            queueTotal={queueTotal}
            onChange={onSearchChange}
            onClose={() => setSearchOpen(false)}
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0 flex-1">
              {/* The queue's name is the page's one h1 at every width: on a phone the
                  queue strip above draws it, so the heading is read, not drawn. */}
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-sm font-semibold max-md:sr-only">
                  {queueLabel}
                </h1>
                <span className="text-xs tabular-nums text-muted-foreground max-md:hidden">
                  {totalCount}
                </span>
              </div>
              {scopeControl ?? (
                <p className="truncate text-xs text-muted-foreground max-md:text-[13px] max-md:font-medium max-md:text-foreground">
                  {scopeLabel}
                </p>
              )}
            </div>
            {isMobile ? (
              <PhoneControls
                filters={filters}
                sort={sort}
                totalCount={totalCount}
                isLoading={isLoading}
                onOpenSearch={openSearch}
                onFiltersChange={onFiltersChange}
                onSortChange={onSortChange}
                onClearFilters={onClearFilters}
                onStartSelection={startSelection}
              />
            ) : (
              <WideControls
                filters={filters}
                sort={sort}
                onOpenSearch={openSearch}
                onFiltersChange={onFiltersChange}
                onSortChange={onSortChange}
                onStartSelection={startSelection}
              />
            )}
          </div>
        ))}
    </header>
  )
}
