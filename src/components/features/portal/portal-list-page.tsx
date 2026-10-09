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
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { AddAction } from '#/components/ui/add-action'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupDialog } from './portal-group/portal-group-dialogs'
import { PortalNewDialog } from './portal-new/portal-new-dialog'
import type { PortalNewData } from './portal-new/portal-new-types'
import { PortalGroupMenu } from './portal-group/portal-group-menu'
import type { PortalGroupMutations } from './portal-group/portal-group-mutations'
import type { PortalArchiveMutations } from './portal-overview/portal-archive-dialog'
import { uncountedScanPortals } from './portal-overview/portal-attention'
import { PortalChangesOffNote } from './portal-overview/portal-changes-off-note'
import { PortalListHeaderActions } from './portal-overview/portal-list-header-actions'
import {
  PortalOverviewEmpty,
  PortalOverviewNoMatch,
} from './portal-overview/portal-overview-empty'
import type { UncountedScanPortal } from './portal-overview/portal-overview-uncounted-note'
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
import {
  PORTAL_OVERVIEW_LONG_LIST,
  PortalOverviewToolbar,
} from './portal-overview/portal-overview-toolbar'
import { sortFiguresWithoutUncounted } from './portal-overview/portal-overview-uncounted'
import { usePortalAccess } from './portal-overview/use-portal-access'
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

const describe = (count: number, propertyName: string): readonly string[] | undefined => {
  if (count === 0) return undefined
  return [`${count === 1 ? '1 portal' : `${count} portals`} at ${propertyName}`]
}

type PortalListBodyProps = Readonly<{
  isEmpty: boolean
  /** The Property has a group, so the list is headed by groups and offers Group by. */
  hasGroups: boolean
  newPortalButton: ReactNode
  results: PortalListPageProps['results']
  inboxWaiting: number | null
  uncounted: readonly UncountedScanPortal[]
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
  hasGroups,
  newPortalButton,
  results,
  inboxWaiting,
  uncounted,
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
    <PortalOverviewEmpty action={newPortalButton} />
  ) : (
    <>
      {results ? (
        <PortalOverviewResultsStrip
          controls={results}
          propertyId={propertyId}
          inboxWaiting={inboxWaiting}
          uncounted={uncounted}
        />
      ) : null}
      <section aria-label="Portal list" className="flex flex-col gap-4">
        <PortalOverviewToolbar
          hasGroups={hasGroups}
          search={listSearch}
          matched={overview.matched}
          total={overview.total}
          needingAttention={overview.needingAttention}
          canSortByScans={resultsState.status !== 'off'}
          onChange={onChange}
        />
        {overview.matched === 0 && overview.sections.length === 0 ? (
          <PortalOverviewNoMatch
            searching={(listSearch.q ?? '').trim() !== ''}
            onClear={() => onChange({ q: undefined, show: undefined })}
          />
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
            {/* "Showing 1–5 of 5" says nothing a short list does not already show. */}
            {overview.lastPage > 1 || overview.total >= PORTAL_OVERVIEW_LONG_LIST ? (
              <PortalOverviewPager
                overview={overview}
                onPage={(page) => onChange({ page })}
              />
            ) : null}
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
  const access = usePortalAccess()
  const [creatingGroup, setCreatingGroup] = useState(false)
  const resultsState: PortalOverviewResultsState = results?.state ?? { status: 'off' }
  // Without results there is nothing to sort by scans, whatever a bookmark says.
  const searchWithScans =
    resultsState.status === 'off' && search.sort === 'scans'
      ? { ...search, sort: undefined, dir: undefined }
      : search
  // A Property with no group has no group to head: the list is flat, and Group by
  // is not offered until the first group exists.
  const hasGroups = groups.length > 0 || rows.some((row) => row.group !== null)
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
  const update = (patch: Partial<PortalOverviewSearch>) =>
    onSearchChange(portalOverviewSearchPatch(search, patch))

  // Making a group or a portal is a Portal create, which the server also refuses
  // while the organisation's `portal.write` capability is off.
  const { canCreate } = access
  const openNewPortal = () => update({ new: true })
  const newPortalButton = canCreate ? (
    <AddAction onClick={openNewPortal}>New portal</AddAction>
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
        meta={describe(rows.length, propertyName)}
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName },
          NAV_LABEL.portals,
        )}
        actions={
          <PortalListHeaderActions
            propertyId={propertyId}
            // The look is read by everyone who may read portals; only an Account Admin edits it.
            showPropertyLook={can('portal.read')}
            onNewGroup={canCreate ? () => setCreatingGroup(true) : undefined}
            newPortalButton={newPortalButton}
            newPortalFromSm={hasPhoneBar}
          />
        }
      />
      <PortalChangesOffNote />
      <PortalListBody
        isEmpty={isEmpty}
        hasGroups={hasGroups}
        newPortalButton={newPortalButton}
        results={results}
        inboxWaiting={inboxWaiting}
        uncounted={uncountedScanPortals(rows)}
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
