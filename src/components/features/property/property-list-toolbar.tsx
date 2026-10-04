// Search, filter and sort for the Properties list (docs/plan/property-list-table.md
// row 12). Every control writes the URL through `onChange`; nothing here keeps
// state of its own. Sort lives in a menu at every width, because the stacked
// layout has no column headers to click.
import { ClearFiltersButton } from '#/components/ui/clear-filters-button'
import { ListFilterMenu } from '#/components/ui/list-choice-menu'
import { ListSortMenu } from '#/components/ui/list-sort-menu'
import { ListToolbar } from '#/components/ui/list-toolbar'
import { ResultCount } from '#/components/ui/result-count'
import { SearchField } from '#/components/ui/search-field'
import type { SortDirection } from '#/components/ui/list-sort'
import {
  PROPERTY_LIST_SHOWS,
  PROPERTY_LIST_SORTS,
  type PropertyListSearch,
  type PropertyListShow,
  type PropertyListSort,
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

type Props = Readonly<{
  view: PropertyListView
  fleet: DataState
  setup: DataState
  shown: number
  total: number
  onChange: (patch: Partial<PropertyListSearch>) => void
}>

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
  const searching = view.q.trim() !== ''
  const narrowed = searching || view.show !== null

  return (
    <ListToolbar>
      <SearchField
        label="Search properties"
        placeholder="Search name or address"
        value={view.q}
        onValueChange={(q) => onChange({ q })}
      />

      <ListFilterMenu
        label="Show"
        value={view.show}
        allLabel="All properties"
        options={PROPERTY_LIST_SHOWS.filter(available).map((show) => ({
          value: show,
          label: SHOW_LABEL[show],
        }))}
        onChange={(show) => onChange({ show: show ?? undefined })}
      />

      <ListSortMenu
        sort={view.sort}
        dir={view.dir}
        options={PROPERTY_LIST_SORTS.filter(available)}
        labels={SORT_LABEL}
        directionLabels={DIRECTION_LABEL}
        defaultDirection={defaultSortDirection}
        onChange={onChange}
      />

      <ResultCount shown={shown} total={total} active={narrowed} />
      {narrowed ? (
        <ClearFiltersButton
          searching={searching}
          onClear={() => onChange({ q: undefined, show: undefined })}
        />
      ) : null}
    </ListToolbar>
  )
}
