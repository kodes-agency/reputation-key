// Search, filter, group and sort for the Portals overview. Every control writes
// the URL through `onChange`; nothing here keeps state of its own. The same
// shape as the Properties list's toolbar: sort lives in a menu at every width,
// because the stacked layout has no column headers to click. The one filter is
// a toggle that names what it keeps and how many, and it is left out while no
// Portal needs attention, as it would keep nothing.
import { ArrowDownUp, ListFilter, ListTree, Search } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
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
  MAX_SEARCH_LENGTH,
  PORTAL_OVERVIEW_GROUP_BYS,
  PORTAL_OVERVIEW_SORTS,
  defaultSortDirection,
  type PortalOverviewGroupBy,
  type PortalOverviewSearch,
  type PortalOverviewSort,
  type SortDirection,
} from './portal-overview-search-schema'
import { offersAttentionFilter } from './portal-attention'

const SORT_LABEL: Readonly<Record<PortalOverviewSort, string>> = {
  name: 'Name',
  attention: 'Needs attention',
  scans: 'Qualified scans',
}

const DIRECTION_LABEL: Readonly<
  Record<PortalOverviewSort, Readonly<Record<SortDirection, string>>>
> = {
  name: { asc: 'A to Z', desc: 'Z to A' },
  attention: { desc: 'Most first', asc: 'Fewest first' },
  scans: { desc: 'Most first', asc: 'Fewest first' },
}

const GROUP_BY_LABEL: Readonly<Record<PortalOverviewGroupBy, string>> = {
  group: 'Portal group',
  none: 'None',
}

type Props = Readonly<{
  /**
   * The All properties page lists Portals under their Properties, so a search
   * also matches a Property's name, and the filter and the grouping (a Property's
   * own groups show when it has them) are not offered there, as on board 10.
   */
  scope?: 'property' | 'organization'
  search: PortalOverviewSearch
  matched: number
  total: number
  /** Every Portal that needs attention, before the search (`PortalOverviewPage`). */
  needingAttention?: number
  /** Offered only where the results are shown to this reader. */
  canSortByScans: boolean
  onChange: (patch: Partial<PortalOverviewSearch>) => void
}>

/** The sort's natural direction first ("A to Z" before "Z to A"). */
const directions = (sort: PortalOverviewSort): readonly SortDirection[] =>
  defaultSortDirection(sort) === 'asc' ? ['asc', 'desc'] : ['desc', 'asc']

export function PortalOverviewToolbar({
  scope = 'property',
  search,
  matched,
  total,
  needingAttention = 0,
  canSortByScans,
  onChange,
}: Props) {
  const sort = search.sort ?? DEFAULT_PORTAL_OVERVIEW_SORT
  const dir = search.dir ?? defaultSortDirection(sort)
  const groupBy = search.groupBy ?? DEFAULT_PORTAL_OVERVIEW_GROUP_BY
  const sortOptions = PORTAL_OVERVIEW_SORTS.filter(
    (option) => option !== 'scans' || canSortByScans,
  )
  const narrowed = (search.q ?? '').trim() !== '' || search.show !== undefined
  const attentionOnly = search.show === 'attention'
  const searchLabel =
    scope === 'organization' ? 'Search portals or properties' : 'Search portals'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="w-full sm:w-72">
        <InputGroupAddon>
          <Search aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          maxLength={MAX_SEARCH_LENGTH}
          value={search.q ?? ''}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </InputGroup>

      {scope === 'property' ? (
        <>
          {offersAttentionFilter(needingAttention, search) ? (
            <Button
              variant="outline"
              aria-pressed={attentionOnly}
              className={cn(
                attentionOnly && 'border-primary bg-primary/10 hover:bg-primary/15',
              )}
              onClick={() => onChange({ show: attentionOnly ? undefined : 'attention' })}
            >
              <ListFilter aria-hidden="true" />
              Needs attention
              <span className="text-muted-foreground tabular-nums">
                {needingAttention}
              </span>
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
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
                  <DropdownMenuRadioItem key={option} value={option}>
                    {GROUP_BY_LABEL[option]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
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
            {sortOptions.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
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
              <DropdownMenuRadioItem key={option} value={option}>
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
          onClick={() => onChange({ q: undefined, show: undefined })}
        >
          Clear
        </Button>
      ) : null}
    </div>
  )
}
