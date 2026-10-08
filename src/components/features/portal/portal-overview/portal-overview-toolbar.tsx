// Search, filter, group and sort for the Portals overview, built from the same
// list-toolbar parts as the Properties list's (`#/components/ui`). Every control
// writes the URL through `onChange`; nothing here keeps state of its own. Sort
// lives in a menu at every width, because the stacked layout has no column
// headers to click. The one filter is a toggle that names what it keeps and how
// many, and it is left out while no Portal needs attention, as it would keep
// nothing: that, the grouping and the results-dependent scans sort are what this
// toolbar has that the Properties list has not.
//
// The common customer has one Property and a few Portals, so the toolbar earns each
// control (`toolbarParts`): a search and a sort once the list is long enough to
// need them, Group by once the Property has a group, the filter while something
// needs attention. A short list with none of those has no toolbar at all.
import { ListFilter, ListTree } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { ListChoiceMenu } from '#/components/ui/list-choice-menu'
import { ListSortMenu } from '#/components/ui/list-sort-menu'
import { ListToolbar, ListToolbarStatus } from '#/components/ui/list-toolbar'
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

/** From this many Portals a list wants a search, a sort and a count of its pages. */
export const PORTAL_OVERVIEW_LONG_LIST = 6

export type PortalOverviewToolbarParts = Readonly<{
  search: boolean
  sort: boolean
  groupBy: boolean
  attention: boolean
}>

/**
 * Which controls the toolbar draws. A searched list keeps its search and sort
 * whatever its length, so a bookmarked search can always be undone. The filter
 * does not bring them: its own toggle undoes it, and a search field arriving in
 * front of the toggle would move it out from under the finger that pressed it.
 */
export function toolbarParts(
  input: Readonly<{
    scope: 'property' | 'organization'
    total: number
    hasGroups: boolean
    needingAttention: number
    search: PortalOverviewSearch
  }>,
): PortalOverviewToolbarParts {
  const searched = (input.search.q ?? '').trim() !== ''
  // The All properties page exists for a reader with several Properties: always long.
  const long =
    input.scope === 'organization' || input.total >= PORTAL_OVERVIEW_LONG_LIST || searched
  return {
    search: long,
    sort: long,
    groupBy: input.scope === 'property' && input.hasGroups,
    attention: offersAttentionFilter(input.needingAttention, input.search),
  }
}

type Props = Readonly<{
  /**
   * The All properties page lists Portals under their Properties, so a search
   * also matches a Property's name, and the grouping (a Property's own groups show
   * when it has them) is not offered there, as on board 10. Its filter is the same
   * "Needs attention", over every Property.
   */
  scope?: 'property' | 'organization'
  /** The Property has a group, so Group by has something to do. Only the Property scope reads it. */
  hasGroups?: boolean
  search: PortalOverviewSearch
  matched: number
  total: number
  /** Every Portal that needs attention, before the search (`PortalOverviewPage`). */
  needingAttention?: number
  /** Offered only where the results are shown to this reader. */
  canSortByScans: boolean
  onChange: (patch: Partial<PortalOverviewSearch>) => void
}>

/** "Needs attention N": keeps only the Portals that need attention; pressed while it does. */
function AttentionToggle({
  on,
  count,
  onChange,
}: Readonly<{
  on: boolean
  count: number
  onChange: Props['onChange']
}>) {
  return (
    <Button
      variant="outline"
      aria-pressed={on}
      className={cn(on && 'border-primary bg-primary/10 hover:bg-primary/15')}
      onClick={() => onChange({ show: on ? undefined : 'attention' })}
    >
      <ListFilter aria-hidden="true" />
      Needs attention
      <span className="text-muted-foreground tabular-nums">{count}</span>
    </Button>
  )
}

/** "Showing 3 of 12", and the way back to the whole list while it is narrowed. */
function ToolbarStatus({
  search,
  matched,
  total,
  filterOffered,
  onChange,
}: Readonly<{
  search: PortalOverviewSearch
  matched: number
  total: number
  /** A list with no filter on offer says "Clear search", not a reset it lacks. */
  filterOffered: boolean
  onChange: Props['onChange']
}>) {
  const searching = (search.q ?? '').trim() !== ''
  const narrowed = searching || search.show !== undefined
  return (
    <ListToolbarStatus>
      <ResultCount shown={matched} total={total} active={narrowed} />
      {narrowed ? (
        <ClearFiltersButton
          searching={searching}
          filters={filterOffered || search.show !== undefined}
          onClear={() => onChange({ q: undefined, show: undefined })}
        />
      ) : null}
    </ListToolbarStatus>
  )
}

export function PortalOverviewToolbar({
  scope = 'property',
  hasGroups = true,
  search,
  matched,
  total,
  needingAttention = 0,
  canSortByScans,
  onChange,
}: Props) {
  const parts = toolbarParts({ scope, total, hasGroups, needingAttention, search })
  if (!Object.values(parts).some(Boolean)) return null
  const sort = search.sort ?? DEFAULT_PORTAL_OVERVIEW_SORT

  return (
    <ListToolbar>
      {parts.search ? (
        <SearchField
          label={
            scope === 'organization' ? 'Search portals or properties' : 'Search portals'
          }
          value={search.q ?? ''}
          onValueChange={(q) => onChange({ q })}
        />
      ) : null}

      {parts.attention ? (
        <AttentionToggle
          on={search.show === 'attention'}
          count={needingAttention}
          onChange={onChange}
        />
      ) : null}

      {parts.groupBy ? (
        <ListChoiceMenu
          label="Group by"
          icon={ListTree}
          value={search.groupBy ?? DEFAULT_PORTAL_OVERVIEW_GROUP_BY}
          options={GROUP_BY_OPTIONS}
          onChange={(next) => onChange({ groupBy: next })}
        />
      ) : null}

      {parts.sort ? (
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
      ) : null}

      {parts.search ? (
        <ToolbarStatus
          search={search}
          matched={matched}
          total={total}
          filterOffered={parts.attention}
          onChange={onChange}
        />
      ) : null}
    </ListToolbar>
  )
}
