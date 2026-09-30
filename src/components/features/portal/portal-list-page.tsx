// Portals — every portal of a property, grouped, with the few that need
// something marked (docs/design/portal-experience/round-4-admin, boards 01 and
// 11). Status is deliberately not a panel: a live portal that needs nothing
// shows only its name, its code and its languages.
//
// Presentational: the route owns the reads and the URL; this page receives the
// search and reports changes through `onSearchChange`. The results strip and the
// measure columns join in slice 25b. Portal Group management stays below the
// table until the group page (slice 38) replaces it.
import { Link } from '@tanstack/react-router'
import { Globe, Plus, SearchX } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { PortalGroupManagement, type PortalGroupView } from './portal-group-management'
import type { PortalArchiveMutations } from './portal-overview/portal-archive-dialog'
import { PortalOverviewPager } from './portal-overview/portal-overview-pager'
import {
  portalOverviewSearchPatch,
  type PortalOverviewSearch,
} from './portal-overview/portal-overview-search-schema'
import { PortalOverviewTable } from './portal-overview/portal-overview-table'
import { PortalOverviewToolbar } from './portal-overview/portal-overview-toolbar'
import {
  buildPortalOverview,
  type PortalManagerName,
} from './portal-overview/portal-overview-view'
import type { Action } from '#/components/hooks/use-action'

export type PortalListPageProps = PortalArchiveMutations &
  Readonly<{
    rows: readonly PortalOverviewRow[]
    /** Names for the responsible managers; without them a disc has no initials. */
    members?: readonly PortalManagerName[]
    propertyId: string
    propertyName: string
    search: PortalOverviewSearch
    onSearchChange: (next: PortalOverviewSearch) => void
    portalGroups: readonly PortalGroupView[]
    createGroupMutation: Action<{
      data: { propertyId: string; name: string; portalIds?: string[] }
    }>
    updateGroupMutation: Action<{ data: { portalGroupId: string; name: string } }>
    deleteGroupMutation: Action<{ data: { portalGroupId: string } }>
    addPortalToGroupMutation: Action<{
      data: { portalGroupId: string; portalId: string }
    }>
    removePortalFromGroupMutation: Action<{
      data: { portalGroupId: string; portalId: string }
    }>
  }>

const describe = (count: number, propertyName: string): string | undefined => {
  if (count === 0) return undefined
  return `${count === 1 ? '1 portal' : `${count} portals`} at ${propertyName}`
}

export function PortalListPage({
  rows,
  members = [],
  propertyId,
  propertyName,
  search,
  onSearchChange,
  archiveMutation,
  restoreMutation,
  portalGroups,
  createGroupMutation,
  updateGroupMutation,
  deleteGroupMutation,
  addPortalToGroupMutation,
  removePortalFromGroupMutation,
}: PortalListPageProps) {
  const { can } = usePermissions()
  const overview = buildPortalOverview(rows, search, members)
  const update = (patch: Partial<PortalOverviewSearch>) =>
    onSearchChange(portalOverviewSearchPatch(search, patch))

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
        actions={newPortalButton}
      />
      <FormErrorBanner error={archiveMutation.error ?? restoreMutation.error} />

      {rows.length === 0 ? (
        <EmptyState icon={Globe} title="No portals yet">
          <p className="text-sm text-muted-foreground">
            Create a portal to set up a guest-facing page with links.
          </p>
          {newPortalButton}
        </EmptyState>
      ) : (
        <section aria-label="Portal list" className="flex flex-col gap-4">
          <PortalOverviewToolbar
            search={search}
            matched={overview.matched}
            total={overview.total}
            onChange={update}
          />
          {overview.matched === 0 ? (
            <EmptyState icon={SearchX} title="No portals match">
              <Button
                variant="outline"
                onClick={() => update({ q: undefined, show: undefined })}
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
              />
              <PortalOverviewPager
                overview={overview}
                onPage={(page) => update({ page })}
              />
            </>
          )}
        </section>
      )}
      <PortalGroupManagement
        propertyId={propertyId}
        groups={portalGroups}
        portals={rows.map((row) => ({ id: row.portalId, name: row.name }))}
        createMutation={createGroupMutation}
        updateMutation={updateGroupMutation}
        deleteMutation={deleteGroupMutation}
        addPortalMutation={addPortalToGroupMutation}
        removePortalMutation={removePortalFromGroupMutation}
      />
    </PageShell>
  )
}
