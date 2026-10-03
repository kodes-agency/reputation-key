// Portals across the whole Organization (docs/design/portal-experience/round-4-admin,
// board 10): the Organization's results strip, then every Portal under the
// Property it belongs to, each Property headed by its own subtotal. The page of
// one Property stays the place to work with groups; here a Property's groups show
// only when it has them.
//
// Presentational, like `PortalListPage`: the route owns the reads and the URL.
// The results arrive as a separate read and are optional: a role that may not
// read results gets the list without them.
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import {
  PortalAllPropertiesNewPortal,
  type NewPortalProperty,
} from './portal-all-properties-new-portal'
import type { PortalArchiveMutations } from './portal-overview/portal-archive-dialog'
import { PortalAllPropertiesTable } from './portal-overview/portal-all-properties-table'
import {
  buildAllPropertiesOverview,
  describeAllProperties,
  type PortalPropertyInfo,
} from './portal-overview/portal-all-properties-view'
import {
  PortalOverviewEmpty,
  PortalOverviewNoMatch,
} from './portal-overview/portal-overview-empty'
import { PortalOverviewPager } from './portal-overview/portal-overview-pager'
import {
  PortalOverviewResultsFooter,
  PortalOverviewResultsStrip,
  type PortalOverviewResultsControls,
} from './portal-overview/portal-overview-results-strip'
import type { PortalOverviewResultsState } from './portal-overview/portal-overview-results'
import {
  defaultSortDirection,
  portalOverviewSearchPatch,
  type AllPropertiesSearch,
} from './portal-overview/portal-overview-search-schema'
import { PortalOverviewToolbar } from './portal-overview/portal-overview-toolbar'
import {
  PORTAL_OVERVIEW_PAGE_SIZE,
  type PortalManagerName,
} from './portal-overview/portal-overview-view'
import { useCollapsedProperties } from './portal-overview/use-collapsed-properties'

export type PortalAllPropertiesPageProps = PortalArchiveMutations &
  Readonly<{
    rows: readonly PortalOverviewRow[]
    /** Names (and Google's state) for the Properties the Portals are in. */
    properties: readonly PortalPropertyInfo[]
    /** The Properties a new Portal can be made in. */
    newPortalProperties: readonly NewPortalProperty[]
    /** Names for the responsible managers; without them a disc has no initials. */
    members?: readonly PortalManagerName[]
    organizationName?: string
    /** The reader's Property access is the whole Organization, not an assignment. */
    organizationWide: boolean
    /** The results beside the list; left out, the list is shown without them. */
    results?: PortalOverviewResultsControls
    search: AllPropertiesSearch
    onSearchChange: (next: AllPropertiesSearch) => void
  }>

// Without results there is nothing to sort by scans, whatever a bookmark says.
function searchWithoutScansSort(
  search: AllPropertiesSearch,
  state: PortalOverviewResultsState,
): AllPropertiesSearch {
  return state.status === 'off' && search.sort === 'scans'
    ? { ...search, sort: undefined, dir: undefined }
    : search
}

function scansOrderOf(search: AllPropertiesSearch) {
  return search.sort === 'scans'
    ? (search.dir ?? defaultSortDirection('scans'))
    : undefined
}

type ListProps = PortalArchiveMutations &
  Readonly<{
    overview: ReturnType<typeof buildAllPropertiesOverview>
    results: PortalOverviewResultsControls | undefined
    resultsState: PortalOverviewResultsState
    search: AllPropertiesSearch
    collapsed: readonly string[]
    onToggleProperty: (propertyId: string) => void
    onPage: (page: number) => void
  }>

function PortalAllPropertiesList({
  overview,
  results,
  resultsState,
  search,
  collapsed,
  onToggleProperty,
  onPage,
  archiveMutation,
  restoreMutation,
  disableMutation,
}: ListProps) {
  return (
    <>
      <PortalAllPropertiesTable
        properties={overview.properties}
        results={resultsState}
        busy={results?.busy}
        scansOrder={scansOrderOf(search)}
        collapsed={collapsed}
        onToggleProperty={onToggleProperty}
        archiveMutation={archiveMutation}
        restoreMutation={restoreMutation}
        disableMutation={disableMutation}
      />
      {/* A folded Property's Portals are not on any page: count what is. */}
      <PortalOverviewPager
        overview={{ ...overview, matched: overview.listed }}
        onPage={onPage}
      />
      {results ? (
        <PortalOverviewResultsFooter controls={results} propertyId={null} />
      ) : null}
    </>
  )
}

export function PortalAllPropertiesPage({
  rows,
  properties,
  newPortalProperties,
  members = [],
  organizationName,
  organizationWide,
  results,
  search,
  onSearchChange,
  archiveMutation,
  restoreMutation,
  disableMutation,
}: PortalAllPropertiesPageProps) {
  const { collapsed, toggle } = useCollapsedProperties()
  const resultsState: PortalOverviewResultsState = results?.state ?? { status: 'off' }
  const listSearch = searchWithoutScansSort(search, resultsState)
  const overview = buildAllPropertiesOverview(
    rows,
    properties,
    listSearch,
    members,
    PORTAL_OVERVIEW_PAGE_SIZE,
    resultsState.status === 'ready' ? resultsState.index.sortFigures : undefined,
    collapsed,
  )
  const update = (patch: Partial<AllPropertiesSearch>) =>
    onSearchChange(portalOverviewSearchPatch(search, patch))
  const newPortal = <PortalAllPropertiesNewPortal properties={newPortalProperties} />

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Portals"
        description={describeAllProperties(
          {
            properties: overview.propertyCount,
            portals: overview.total,
            known: properties.length,
            organizationWide,
          },
          organizationName,
        )}
        actions={newPortal}
      />
      <FormErrorBanner
        error={archiveMutation.error ?? restoreMutation.error ?? disableMutation?.error}
      />

      {rows.length === 0 ? (
        <PortalOverviewEmpty action={newPortal} />
      ) : (
        <>
          {results ? (
            <PortalOverviewResultsStrip
              controls={results}
              propertyId={null}
              propertiesListed={overview.propertyCount}
            />
          ) : null}
          <section aria-label="All portals, by property" className="flex flex-col gap-4">
            <PortalOverviewToolbar
              scope="organization"
              search={listSearch}
              matched={overview.matched}
              total={overview.total}
              canSortByScans={resultsState.status !== 'off'}
              onChange={update}
            />
            {overview.matched === 0 ? (
              <PortalOverviewNoMatch
                clearLabel="Clear search"
                onClear={() => update({ q: undefined })}
              />
            ) : (
              <PortalAllPropertiesList
                overview={overview}
                results={results}
                resultsState={resultsState}
                search={listSearch}
                collapsed={collapsed}
                onToggleProperty={toggle}
                onPage={(page) => update({ page })}
                archiveMutation={archiveMutation}
                restoreMutation={restoreMutation}
                disableMutation={disableMutation}
              />
            )}
          </section>
        </>
      )}
    </PageShell>
  )
}
