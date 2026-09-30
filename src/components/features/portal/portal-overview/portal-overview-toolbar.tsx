// Search, filter, group and sort for the Portals overview. Every control writes
// the URL through `onChange`; nothing here keeps state of its own. The same
// shape as the Properties list's toolbar: sort lives in a menu at every width,
// because the stacked layout has no column headers to click.
import { ArrowDownUp, ListFilter, ListTree, Search } from 'lucide-react'
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
  DEFAULT_PORTAL_OVERVIEW_GROUP_BY,
  DEFAULT_PORTAL_OVERVIEW_SORT,
  PORTAL_OVERVIEW_GROUP_BYS,
  PORTAL_OVERVIEW_SORTS,
  defaultSortDirection,
  type PortalOverviewGroupBy,
  type PortalOverviewSearch,
  type PortalOverviewSort,
  type SortDirection,
} from './portal-overview-search-schema'

const SORT_LABEL: Readonly<Record<PortalOverviewSort, string>> = {
  name: 'Name',
  attention: 'Needs attention',
}

const DIRECTION_LABEL: Readonly<
  Record<PortalOverviewSort, Readonly<Record<SortDirection, string>>>
> = {
  name: { asc: 'A to Z', desc: 'Z to A' },
  attention: { desc: 'Most first', asc: 'Fewest first' },
}

const GROUP_BY_LABEL: Readonly<Record<PortalOverviewGroupBy, string>> = {
  group: 'Group',
  none: 'Nothing',
}

const CONTROL_HEIGHT = 'h-11 md:h-9'
const MENU_ITEM = 'min-h-11 md:min-h-8'

type Props = Readonly<{
  search: PortalOverviewSearch
  matched: number
  total: number
  onChange: (patch: Partial<PortalOverviewSearch>) => void
}>

/** The sort's natural direction first ("A to Z" before "Z to A"). */
const directions = (sort: PortalOverviewSort): readonly SortDirection[] =>
  defaultSortDirection(sort) === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']

export function PortalOverviewToolbar({ search, matched, total, onChange }: Props) {
  const sort = search.sort ?? DEFAULT_PORTAL_OVERVIEW_SORT
  const dir = search.dir ?? defaultSortDirection(sort)
  const groupBy = search.groupBy ?? DEFAULT_PORTAL_OVERVIEW_GROUP_BY
  const narrowed = (search.q ?? '').trim() !== '' || search.show !== undefined

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className={`${CONTROL_HEIGHT} w-full sm:w-72`}>
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label="Search portals"
          placeholder="Search portals"
          value={search.q ?? ''}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </InputGroup>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={CONTROL_HEIGHT}>
            <ListFilter aria-hidden="true" />
            Show: {search.show === 'attention' ? 'Needs attention' : 'All'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuRadioGroup
            value={search.show ?? 'all'}
            onValueChange={(value) =>
              onChange({ show: value === 'attention' ? 'attention' : undefined })
            }
          >
            <DropdownMenuRadioItem value="all" className={MENU_ITEM}>
              All portals
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="attention" className={MENU_ITEM}>
              Needs attention
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={CONTROL_HEIGHT}>
            <ListTree aria-hidden="true" />
            Group by: {GROUP_BY_LABEL[groupBy]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuRadioGroup
            value={groupBy}
            onValueChange={(value) =>
              onChange({ groupBy: value as PortalOverviewGroupBy })
            }
          >
            {PORTAL_OVERVIEW_GROUP_BYS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className={MENU_ITEM}>
                {GROUP_BY_LABEL[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={CONTROL_HEIGHT}>
            <ArrowDownUp aria-hidden="true" />
            Sort: {SORT_LABEL[sort]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-52">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) =>
              onChange({ sort: value as PortalOverviewSort, dir: undefined })
            }
          >
            {PORTAL_OVERVIEW_SORTS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className={MENU_ITEM}>
                {SORT_LABEL[option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={dir}
            onValueChange={(value) => onChange({ sort, dir: value as SortDirection })}
          >
            {directions(sort).map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className={MENU_ITEM}>
                {DIRECTION_LABEL[sort][option]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Always mounted, so a screen reader hears the count change as you type. */}
      <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
        {narrowed ? `${matched} of ${total}` : ''}
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
