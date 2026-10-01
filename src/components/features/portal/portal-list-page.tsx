// Portals — every portal of a property, grouped, with the few that need
// something marked (docs/design/portal-experience/round-4-admin, boards 01 and
// 11). Status is deliberately not a panel: a live portal that needs nothing
// shows only its name, its code and its languages.
//
// Presentational: the route owns the reads and the URL; this page receives the
// search and reports changes through `onSearchChange`. The results (the strip
// above the table and the measure columns in it) arrive as a separate read and
// are optional: a role that may not read results gets the list without them.
// Groups are made in the New group dialog and managed on each group's page; the
// head of a group in the table links there and carries the group's actions.
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { FolderPlus, Globe, Plus, SearchX } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupDialog } from './portal-group/portal-group-dialogs'
import { PortalGroupMenu } from './portal-group/portal-group-menu'
import type { PortalGroupMutations } from './portal-group/portal-group-mutations'
import type { PortalArchiveMutations } from './portal-overview/portal-archive-dialog'
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
  type PortalOverviewSearch,
} from './portal-overview/portal-overview-search-schema'
import { PortalOverviewTable } from './portal-overview/portal-overview-table'
import { PortalOverviewToolbar } from './portal-overview/portal-overview-toolbar'
import {
  PORTAL_OVERVIEW_PAGE_SIZE,
  buildPortalOverview,
  type PortalManagerName,
} from './portal-overview/portal-overview-view'

export type PortalListPageProps = PortalArchiveMutations &
  Readonly<{
    rows: readonly PortalOverviewRow[]
    /** Names for the responsible managers; without them a disc has no initials. */
    members?: readonly PortalManagerName[]
    propertyId: string
    propertyName: string
    /** The results beside the list; left out, the list is shown without them. */
    results?: PortalOverviewResultsControls
    search: PortalOverviewSearch
    onSearchChange: (next: PortalOverviewSearch) => void
    /** Every group of the Property, so one with no Portal can still be reached. */
    groups: readonly NonNullable<PortalOverviewRow['group']>[]
  }> &
  Pick<PortalGroupMutations, 'createMutation' | 'renameMutation' | 'archiveGroupMutation'>

const describe = (count: number, propertyName: string): string | undefined => {
  if (count === 0) return undefined
  return `${count === 1 ? '1 portal' : `${count} portals`} at ${propertyName}`
}

type PortalListBodyProps = Readonly<{
  isEmpty: boolean
  newPortalButton: ReactNode
  results: PortalListPageProps['results']
  resultsState: PortalOverviewResultsState
  listSearch: PortalOverviewSearch
  overview: ReturnType<typeof buildPortalOverview>
  propertyId: string
  propertyName: string
  archiveMutation: PortalListPageProps['archiveMutation']
  restoreMutation: PortalListPageProps['restoreMutation']
  renameMutation: PortalListPageProps['renameMutation']
  archiveGroupMutation: PortalListPageProps['archiveGroupMutation']
  onChange: (patch: Partial<PortalOverviewSearch>) => void
}>

function PortalListBody({
  isEmpty,
  newPortalButton,
  results,
  resultsState,
  listSearch,
  overview,
  propertyId,
  propertyName,
  archiveMutation,
  restoreMutation,
  renameMutation,
  archiveGroupMutation,
  onChange,
}: PortalListBodyProps) {
  return isEmpty ? (
    <EmptyState icon={Globe} title="No portals yet">
      <p className="text-sm text-muted-foreground">
        Create a portal to set up a guest-facing page with links.
      </p>
      {newPortalButton}
    </EmptyState>
  ) : (
    <>
      {results ? (
        <PortalOverviewResultsStrip controls={results} propertyId={propertyId} />
      ) : null}
      <section aria-label="Portal list" className="flex flex-col gap-4">
        <PortalOverviewToolbar
          search={listSearch}
          matched={overview.matched}
          total={overview.total}
          canSortByScans={resultsState.status !== 'off'}
          onChange={onChange}
        />
        {overview.matched === 0 && overview.sections.length === 0 ? (
          <EmptyState icon={SearchX} title="No portals match">
            <Button
              variant="outline"
              onClick={() => onChange({ q: undefined, show: undefined })}
            >
              Clear search and filter
            </Button>
          </EmptyState>
        ) : (
          <>
            <PortalOverviewTable
              sections={overview.sections}
              propertyId={propertyId}
              propertyName={propertyName}
              archiveMutation={archiveMutation}
              restoreMutation={restoreMutation}
              results={resultsState}
              busy={results?.busy}
              groupActions={(group) => (
                <PortalGroupMenu
                  group={group}
                  propertyId={propertyId}
                  where="overview"
                  renameMutation={renameMutation}
                  archiveGroupMutation={archiveGroupMutation}
                />
              )}
              scansOrder={
                listSearch.sort === 'scans'
                  ? (listSearch.dir ?? defaultSortDirection('scans'))
                  : undefined
              }
            />
            <PortalOverviewPager
              overview={overview}
              onPage={(page) => onChange({ page })}
            />
            {results ? (
              <PortalOverviewResultsFooter controls={results} propertyId={propertyId} />
            ) : null}
          </>
        )}
      </section>
    </>
  )
}

export function PortalListPage({
  rows,
  members = [],
  propertyId,
  propertyName,
  results,
  search,
  onSearchChange,
  archiveMutation,
  restoreMutation,
  groups,
  createMutation,
  renameMutation,
  archiveGroupMutation,
}: PortalListPageProps) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const [creatingGroup, setCreatingGroup] = useState(false)
  const resultsState: PortalOverviewResultsState = results?.state ?? { status: 'off' }
  // Without results there is nothing to sort by scans, whatever a bookmark says.
  const listSearch =
    resultsState.status === 'off' && search.sort === 'scans'
      ? { ...search, sort: undefined, dir: undefined }
      : search
  const overview = buildPortalOverview(
    rows,
    listSearch,
    members,
    PORTAL_OVERVIEW_PAGE_SIZE,
    resultsState.status === 'ready' ? resultsState.index.sortFigures : undefined,
    groups,
  )
  const update = (patch: Partial<PortalOverviewSearch>) =>
    onSearchChange(portalOverviewSearchPatch(search, patch))

  // Creating a group is a Portal create, which the server also refuses while the
  // organisation's `portal.write` capability is off.
  const newGroupButton =
    can('portal.create') && has('portal.write') ? (
      <Button
        variant="outline"
        className="min-h-11 sm:min-h-9"
        onClick={() => setCreatingGroup(true)}
      >
        <FolderPlus />
        New group
      </Button>
    ) : undefined

  const newPortalButton = can('portal.create') ? (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
        <Plus />
        New portal
      </Link>
    </Button>
  ) : undefined

  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Portals"
        description={describe(rows.length, propertyName)}
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Portals' },
        ]}
        actions={
          <>
            {newGroupButton}
            {newPortalButton}
          </>
        }
      />
      <FormErrorBanner
        error={
          archiveMutation.error ??
          restoreMutation.error ??
          archiveGroupMutation.error ??
          renameMutation.error
        }
      />

      <PortalListBody
        isEmpty={rows.length === 0 && groups.length === 0}
        newPortalButton={newPortalButton}
        results={results}
        resultsState={resultsState}
        listSearch={listSearch}
        overview={overview}
        propertyId={propertyId}
        propertyName={propertyName}
        archiveMutation={archiveMutation}
        restoreMutation={restoreMutation}
        renameMutation={renameMutation}
        archiveGroupMutation={archiveGroupMutation}
        onChange={update}
      />
      <PortalGroupDialog
        open={creatingGroup}
        onOpenChange={setCreatingGroup}
        propertyId={propertyId}
        rows={rows}
        createMutation={createMutation}
      />
    </PageShell>
  )
}
