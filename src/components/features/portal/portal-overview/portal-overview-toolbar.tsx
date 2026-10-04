// Search, filter, group and sort for the Portals overview, built from the same
// list-toolbar parts as the Properties list's (`#/components/ui`). Every control
// writes the URL through `onChange`; nothing here keeps state of its own. Sort
// lives in a menu at every width, because the stacked layout has no column
// headers to click. The one filter is a toggle that names what it keeps and how
// many, and it is left out while no Portal needs attention, as it would keep
// nothing: that, the grouping and the results-dependent scans sort are what this
// toolbar has that the Properties list has not.
import { ListFilter, ListTree } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { ListChoiceMenu } from '#/components/ui/list-choice-menu'
import { ListSortMenu } from '#/components/ui/list-sort-menu'
import { ListToolbar } from '#/components/ui/list-toolbar'
import { ResultCount } from '#/components/ui/result-count'
import { SearchField } from '#/components/ui/search-field'
import type { SortDirection } from '#/components/ui/list-sort'
import { cn } from '#/lib/utils'
import {
  DEFAULT_PORTAL_OVERVIEW_GROUP_BY,
  DEFAULT_PORTAL_OVERVIEW_SORT,
  PORTAL_OVERVIEW_GROUP_BYS,
  PORTAL_OVERVIEW_SORTS,
  defaultSortDirection,
  type PortalOverviewGroupBy,
  type PortalOverviewSearch,
  type PortalOverviewSort,
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

const GROUP_BY_OPTIONS: ReadonlyArray<
  Readonly<{ value: PortalOverviewGroupBy; label: string }>
> = PORTAL_OVERVIEW_GROUP_BYS.map((value) => ({
  value,
  label: value === 'group' ? 'Portal group' : 'None',
}))

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
  const groupBy = search.groupBy ?? DEFAULT_PORTAL_OVERVIEW_GROUP_BY
  const searching = (search.q ?? '').trim() !== ''
  const narrowed = searching || search.show !== undefined
  const attentionOnly = search.show === 'attention'
  const searchLabel =
    scope === 'organization' ? 'Search portals or properties' : 'Search portals'

  return (
    <ListToolbar>
      <SearchField
        label={searchLabel}
        value={search.q ?? ''}
        onValueChange={(q) => onChange({ q })}
      />

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

          <ListChoiceMenu
            label="Group by"
            icon={ListTree}
            value={groupBy}
            options={GROUP_BY_OPTIONS}
            onChange={(next) => onChange({ groupBy: next })}
          />
        </>
      ) : null}

      <ListSortMenu
        sort={sort}
        dir={search.dir ?? defaultSortDirection(sort)}
        options={PORTAL_OVERVIEW_SORTS.filter(
          (option) => option !== 'scans' || canSortByScans,
        )}
        labels={SORT_LABEL}
        directionLabels={DIRECTION_LABEL}
        defaultDirection={defaultSortDirection}
        onChange={onChange}
      />

      <ResultCount shown={matched} total={total} active={narrowed} />
      {narrowed ? (
        <ClearFiltersButton
          searching={searching}
          onClear={() => onChange({ q: undefined, show: undefined })}
        />
      ) : null}
    </ListToolbar>
  )
}
