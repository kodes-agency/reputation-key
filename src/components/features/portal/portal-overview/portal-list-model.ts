import type { PortalListPageProps } from '../portal-list-page'
import type { PortalOverviewResultsState } from './portal-overview-results'
import { sortFiguresWithoutUncounted } from './portal-overview-uncounted'
import { buildPortalOverview, PORTAL_OVERVIEW_PAGE_SIZE } from './portal-overview-view'
export function portalListModel({
  rows,
  results,
  search,
  groups,
  members = [],
}: Pick<PortalListPageProps, 'rows' | 'results' | 'search' | 'groups' | 'members'>) {
  const resultsState: PortalOverviewResultsState = results?.state ?? { status: 'off' }
  // Without results there is nothing to sort by scans, whatever a bookmark says.
  const searchWithScans =
    resultsState.status === 'off' && search.sort === 'scans'
      ? { ...search, sort: undefined, dir: undefined }
      : search
  // A Property with no group has no group to head: the list is flat, and Group by
  // is not offered until the first group exists.
  const hasGroups =
    groups.length > 0 || rows.some((row) => row.group !== null || row.kind === 'personal')
  const listSearch = hasGroups
    ? searchWithScans
    : { ...searchWithScans, groupBy: 'none' as const }
  const overview = buildPortalOverview(
    rows,
    listSearch,
    members,
    PORTAL_OVERVIEW_PAGE_SIZE,
    sortFiguresWithoutUncounted(
      resultsState.status === 'ready' ? resultsState.index.sortFigures : undefined,
      rows,
    ),
    groups,
  )
  return { resultsState, hasGroups, listSearch, overview }
}
