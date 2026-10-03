import { useRef } from 'react'
import { Filter, X } from 'lucide-react'
import type { InboxSort } from '#/contexts/inbox/application/public-api'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet'
import { ASPECT_OPTIONS, ASPECT_POLARITY_OPTIONS } from '#/shared/aspect-labels'
import { InboxChoiceChips } from './inbox-choice-chips'
import {
  ATTENTION_OPTIONS,
  ratingPatch,
  ratingValue,
  RATING_OPTIONS,
  SORT_OPTIONS,
  SOURCE_OPTIONS,
  type InboxFilterOption,
} from './inbox-filter-options'
import { countActiveInboxFilters, type InboxListFilterValues } from './inbox-filters'
import { IconButton } from '#/components/ui/icon-button'

// The group heading already says what "All" is all of ("All ratings" under
// "Rating" would read twice), so the first choice of each group is plain "All".
function withPlainAll(
  options: ReadonlyArray<InboxFilterOption>,
): ReadonlyArray<InboxFilterOption> {
  return options.map((option) =>
    option.value === 'all' ? { ...option, label: 'All' } : option,
  )
}

const ALL_OPTION: InboxFilterOption = { value: 'all', label: 'All' }
const SOURCE_CHOICES = withPlainAll(SOURCE_OPTIONS)
const RATING_CHOICES = withPlainAll(RATING_OPTIONS)
const ATTENTION_CHOICES = withPlainAll(ATTENTION_OPTIONS)
const POLARITY_CHOICES: ReadonlyArray<InboxFilterOption> = [
  ALL_OPTION,
  ...ASPECT_POLARITY_OPTIONS,
]
const ASPECT_CHOICES: ReadonlyArray<InboxFilterOption> = [ALL_OPTION, ...ASPECT_OPTIONS]

function orUndefined<T extends string>(value: string): T | undefined {
  return value === 'all' ? undefined : (value as T)
}

// The count is stale (or zero) until the list arrives, so while it loads the
// button promises nothing: "No results" would be wrong for a list on its way.
function resultsLabel(totalCount: number, isLoading: boolean): string {
  if (isLoading) return 'Show results'
  if (totalCount === 0) return 'No results'
  return `Show ${totalCount} ${totalCount === 1 ? 'result' : 'results'}`
}

type Props = Readonly<{
  filters: InboxListFilterValues
  sort: InboxSort
  totalCount: number
  isLoading: boolean
  onFiltersChange: (patch: Partial<InboxListFilterValues>) => void
  onSortChange: (sort: InboxSort) => void
  /** Drops every filter and the sort in one navigation. */
  onClearAll: () => void
}>

/**
 * The phone's sort and filter surface. Choices apply to the list straight
 * away, so the footer only reports what they left and closes the sheet.
 */
export function InboxFilterSheet({
  filters,
  sort,
  totalCount,
  isLoading,
  onFiltersChange,
  onSortChange,
  onClearAll,
}: Props) {
  const activeCount = countActiveInboxFilters(filters)
  const canClear = activeCount > 0 || sort !== 'newest'
  const primaryRef = useRef<HTMLButtonElement>(null)

  // Once it has run there is nothing left to clear, so "Clear all" goes
  // disabled under the keyboard user's focus. Focus moves to the footer's other
  // button first, so it never lands on a control that cannot take it.
  function clearAll() {
    primaryRef.current?.focus()
    onClearAll()
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon"
          className="relative"
          data-inbox-filter-trigger
          label={activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters'}
        >
          <Filter />
          {activeCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground"
            >
              {activeCount}
            </span>
          )}
        </IconButton>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] gap-0 rounded-t-xl p-0"
      >
        <div
          data-density="compact"
          className="flex h-11 shrink-0 items-center justify-between border-b px-4"
        >
          <SheetTitle className="text-base">Sort and filter</SheetTitle>
          <SheetClose asChild>
            <IconButton variant="ghost" className="-mr-2.5" label="Close" tooltip={false}>
              <X />
            </IconButton>
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">
          Choices apply to the list straight away.
        </SheetDescription>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-4">
          <InboxChoiceChips
            label="Sort"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(next) => onSortChange(next as InboxSort)}
          />
          <InboxChoiceChips
            label="Source"
            value={filters.sourceType ?? 'all'}
            options={SOURCE_CHOICES}
            onChange={(sourceType) =>
              onFiltersChange({
                sourceType: orUndefined<'review' | 'feedback'>(sourceType),
              })
            }
          />
          <InboxChoiceChips
            label="Rating"
            value={ratingValue(filters)}
            options={RATING_CHOICES}
            onChange={(rating) => onFiltersChange(ratingPatch(rating))}
          />
          <InboxChoiceChips
            label="Priority"
            value={filters.attention ?? 'all'}
            options={ATTENTION_CHOICES}
            onChange={(attention) =>
              onFiltersChange({
                attention:
                  orUndefined<NonNullable<InboxListFilterValues['attention']>>(attention),
              })
            }
          />
          <InboxChoiceChips
            label="Polarity"
            value={filters.polarity ?? 'all'}
            options={POLARITY_CHOICES}
            onChange={(polarity) =>
              onFiltersChange({
                polarity:
                  orUndefined<NonNullable<InboxListFilterValues['polarity']>>(polarity),
              })
            }
          />
          {/* Last: it is the longest group, so it scrolls instead of pushing the rest down. */}
          <InboxChoiceChips
            label="Aspect"
            value={filters.aspect ?? 'all'}
            options={ASPECT_CHOICES}
            onChange={(aspect) =>
              onFiltersChange({
                aspect: orUndefined<NonNullable<InboxListFilterValues['aspect']>>(aspect),
              })
            }
          />
        </div>
        <div className="flex shrink-0 gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="outline" size="lg" disabled={!canClear} onClick={clearAll}>
            Clear all
          </Button>
          <SheetClose asChild>
            <Button ref={primaryRef} size="lg" className="flex-1">
              {resultsLabel(totalCount, isLoading)}
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  )
}
