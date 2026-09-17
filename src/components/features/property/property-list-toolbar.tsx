// Search, filter and sort for the Properties list (docs/plan/property-list-table.md
// row 12). Every control writes the URL through `onChange`; nothing here keeps
// state of its own. Sort lives in a menu at every width, because the stacked
// layout has no column headers to click.
import { ArrowDownUp, ListFilter, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#/components/ui/input-group'
import {
  PROPERTY_LIST_SHOWS,
  PROPERTY_LIST_SORTS,
  type PropertyListSearch,
  type PropertyListShow,
  type PropertyListSort,
  type SortDirection,
} from './property-list-search-schema'
import {
  defaultSortDirection,
  type DataState,
  type PropertyListView,
} from './property-list-view'

const SHOW_LABEL: Readonly<Record<PropertyListShow, string>> = {
  attention: 'Needs attention',
  setup: 'Setup to finish',
  google: 'Google not linked',
}

const SORT_LABEL: Readonly<Record<PropertyListSort, string>> = {
  attention: 'Needs attention',
  name: 'Name',
  rating: 'Rating',
  reviews: 'Reviews',
  setup: 'Setup',
}

const DIRECTION_LABEL: Readonly<
  Record<PropertyListSort, Readonly<Record<SortDirection, string>>>
> = {
  attention: { desc: 'Most first', asc: 'Fewest first' },
  name: { asc: 'A to Z', desc: 'Z to A' },
  rating: { desc: 'Highest first', asc: 'Lowest first' },
  reviews: { desc: 'Most first', asc: 'Fewest first' },
  setup: { asc: 'Least done first', desc: 'Most done first' },
}

const CONTROL_HEIGHT = 'h-11 md:h-9'
const MENU_ITEM = 'min-h-11 md:min-h-8'

type Props = Readonly<{
  view: PropertyListView
  fleet: DataState
  setup: DataState
  shown: number
  total: number
  onChange: (patch: Partial<PropertyListSearch>) => void
}>

/** The sort's natural direction first ("A to Z" before "Z to A"). */
function directions(sort: PropertyListSort): readonly SortDirection[] {
  return defaultSortDirection(sort) === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']
}

function readFor(key: PropertyListSort | PropertyListShow): 'fleet' | 'setup' | null {
  if (key === 'name' || key === 'google') return null
  return key === 'setup' ? 'setup' : 'fleet'
}

export function PropertyListToolbar({
  view,
  fleet,
  setup,
  shown,
  total,
  onChange,
}: Props) {
  const available = (key: PropertyListSort | PropertyListShow) => {
    const read = readFor(key)
    return read === null || (read === 'fleet' ? fleet : setup) !== 'unavailable'
  }
  const narrowed = view.q.trim() !== '' || view.show !== null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className={`${CONTROL_HEIGHT} w-full sm:w-72`}>
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Search properties"
          placeholder="Search name or address"
          value={view.q}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </InputGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={CONTROL_HEIGHT}>
            <ListFilter aria-hidden="true" />
            Show: {view.show ? SHOW_LABEL[view.show] : 'All'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            value={view.show ?? 'all'}
            onValueChange={(value) =>
              onChange({
                show: value === 'all' ? undefined : (value as PropertyListShow),
              })
            }
          >
            <DropdownMenuRadioItem value="all" className={MENU_ITEM}>
              All properties
            </DropdownMenuRadioItem>
            {PROPERTY_LIST_SHOWS.filter(available).map((show) => (
              <DropdownMenuRadioItem key={show} value={show} className={MENU_ITEM}>
                {SHOW_LABEL[show]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={CONTROL_HEIGHT}>
            <ArrowDownUp aria-hidden="true" />
            Sort: {SORT_LABEL[view.sort]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view.sort}
            onValueChange={(value) =>
              onChange({ sort: value as PropertyListSort, dir: undefined })
            }
          >
            {PROPERTY_LIST_SORTS.filter(available).map((sort) => (
              <DropdownMenuRadioItem key={sort} value={sort} className={MENU_ITEM}>
                {SORT_LABEL[sort]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={view.dir}
            onValueChange={(value) =>
              onChange({ sort: view.sort, dir: value as SortDirection })
            }
          >
            {directions(view.sort).map((dir) => (
              <DropdownMenuRadioItem key={dir} value={dir} className={MENU_ITEM}>
                {DIRECTION_LABEL[view.sort][dir]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Always mounted, so a screen reader hears the count change as you type. */}
      <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
        {narrowed ? `${shown} of ${total}` : ''}
      </p>
      {narrowed ? (
        <Button
          variant="ghost"
          size="sm"
          className={CONTROL_HEIGHT}
          onClick={() => onChange({ q: undefined, show: undefined })}
        >
          Clear
        </Button>
      ) : null}
    </div>
  )
}
