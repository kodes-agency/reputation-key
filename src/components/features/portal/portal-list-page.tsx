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
import { FolderPlus, Globe, Palette, Plus, SearchX } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupDialog } from './portal-group/portal-group-dialogs'
import { PortalNewDialog } from './portal-new/portal-new-dialog'
import type { PortalNewData } from './portal-new/portal-new-types'
import { PortalGroupMenu } from './portal-group/portal-group-menu'
import type { PortalGroupMutations } from './portal-group/portal-group-mutations'
import type { PortalArchiveMutations } from './portal-overview/portal-archive-dialog'
import { PortalOverviewPager } from './portal-overview/portal-overview-pager'
import {
  PHONE_NEW_PORTAL_BAR_CLEARANCE,
  PortalPhoneNewPortalBar,
} from './portal-overview/portal-phone-new-portal-bar'
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
    /** Items waiting in the Property's Inbox; the strip links to them. Null leaves it out. */
    inboxWaiting?: number | null
    search: PortalOverviewSearch
    onSearchChange: (next: PortalOverviewSearch) => void
    /** Every group of the Property, so one with no Portal can still be reached. */
    groups: readonly NonNullable<PortalOverviewRow['group']>[]
    /** What the New portal dialog needs; null until the Property's options have loaded. */
    newPortal: Readonly<{ data: PortalNewData | null; loadError?: unknown }>
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
  inboxWaiting: number | null
  resultsState: PortalOverviewResultsState
  listSearch: PortalOverviewSearch
  overview: ReturnType<typeof buildPortalOverview>
  propertyId: string
  propertyName: string
  archiveMutation: PortalListPageProps['archiveMutation']
  restoreMutation: PortalListPageProps['restoreMutation']
  disableMutation: PortalListPageProps['disableMutation']
  renameMutation: PortalListPageProps['renameMutation']
  archiveGroupMutation: PortalListPageProps['archiveGroupMutation']
  onChange: (patch: Partial<PortalOverviewSearch>) => void
}>

// fallow-ignore-next-line complexity
function PortalListBody({
  isEmpty,
  newPortalButton,
  results,
  inboxWaiting,
  resultsState,
  listSearch,
  overview,
  propertyId,
  propertyName,
  archiveMutation,
  restoreMutation,
  disableMutation,
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
        <PortalOverviewResultsStrip
          controls={results}
          propertyId={propertyId}
          inboxWaiting={inboxWaiting}
        />
      ) : null}
      <section aria-label="Portal list" className="flex flex-col gap-4">
        <PortalOverviewToolbar
          search={listSearch}
          matched={overview.matched}
          total={overview.total}
          needingAttention={overview.needingAttention}
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
              disableMutation={disableMutation}
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

// fallow-ignore-next-line complexity
export function PortalListPage({
  rows,
  members = [],
  propertyId,
  propertyName,
  results,
  inboxWaiting = null,
  search,
  onSearchChange,
  archiveMutation,
  restoreMutation,
  disableMutation,
  groups,
  createMutation,
  renameMutation,
  archiveGroupMutation,
  newPortal,
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

  // The look is read by everyone who may read portals; only an Account Admin edits it.
  const propertyLookButton = can('portal.read') ? (
    <Button variant="outline" className="min-h-11 sm:min-h-9" asChild>
      <Link to="/properties/$propertyId/portals/look" params={{ propertyId }}>
        <Palette />
        Property look
      </Link>
    </Button>
  ) : undefined

  const canCreate = can('portal.create')
  const openNewPortal = () => update({ new: true })
  const newPortalButton = canCreate ? (
    <Button className="min-h-11 sm:min-h-9" onClick={openNewPortal}>
      <Plus />
      New portal
    </Button>
  ) : undefined
  const isEmpty = rows.length === 0 && groups.length === 0
  // An empty list offers New portal in its own message; a list has the phone bar.
  const hasPhoneBar = canCreate && !isEmpty

  return (
    <PageShell
      tier="dashboard"
      className={hasPhoneBar ? PHONE_NEW_PORTAL_BAR_CLEARANCE : undefined}
    >
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
            {propertyLookButton}
            {newGroupButton}
            {hasPhoneBar ? (
              <span className="hidden sm:contents">{newPortalButton}</span>
            ) : (
              newPortalButton
            )}
          </>
        }
      />
      <FormErrorBanner
        error={
          archiveMutation.error ??
          restoreMutation.error ??
          disableMutation?.error ??
          archiveGroupMutation.error ??
          renameMutation.error
        }
      />

      <PortalListBody
        isEmpty={isEmpty}
        newPortalButton={newPortalButton}
        results={results}
        inboxWaiting={inboxWaiting}
        resultsState={resultsState}
        listSearch={listSearch}
        overview={overview}
        propertyId={propertyId}
        propertyName={propertyName}
        archiveMutation={archiveMutation}
        restoreMutation={restoreMutation}
        disableMutation={disableMutation}
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
      {hasPhoneBar ? <PortalPhoneNewPortalBar onClick={openNewPortal} /> : null}
      {canCreate ? (
        <PortalNewDialog
          open={search.new === true}
          onOpenChange={(open) => update({ new: open ? true : undefined })}
          data={newPortal.data}
          loadError={newPortal.loadError}
        />
      ) : null}
    </PageShell>
  )
}
