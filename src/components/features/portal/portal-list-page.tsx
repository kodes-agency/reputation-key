// Portal list page — extracted from route for testability and separation of concerns
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { EmptyState } from '#/components/ui/empty-state'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import { Plus, Globe, Search } from 'lucide-react'
import { PortalListTable } from './portal-list-table'
import { PortalGroupManagement, type PortalGroupView } from './portal-group-management'
import type { PortalListItem } from './portal-list-types'
import type { Action } from '#/components/hooks/use-action'

// A QR code per room means a property can hold hundreds of portals, so the table
// is paged. Client-side: `listPortals` returns the whole authorized collection
// in one call and the group editor below needs every portal anyway.
const PAGE_SIZE = 20

export interface PortalListPageProps {
  portals: readonly PortalListItem[]
  propertyId: string
  propertyName: string
  deleteMutation: Action<{ data: { portalId: string } }>
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
}

export function PortalListPage({
  portals,
  propertyId,
  propertyName,
  deleteMutation,
  portalGroups,
  createGroupMutation,
  updateGroupMutation,
  deleteGroupMutation,
  addPortalToGroupMutation,
  removePortalFromGroupMutation,
}: PortalListPageProps) {
  const { can } = usePermissions()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return portals
    return portals.filter((portal) => portal.name.toLowerCase().includes(needle))
  }, [portals, search])

  // Clamped rather than reset in an effect: deleting the last row of the last
  // page must not leave the table blank.
  const lastPage = Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage)
  const pageStart = currentPage * PAGE_SIZE
  const visible = matches.slice(pageStart, pageStart + PAGE_SIZE)

  const addPortalButton = can('portal.create') ? (
    <Button asChild className="min-h-11 sm:min-h-9">
      <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
        <Plus />
        Add Portal
      </Link>
    </Button>
  ) : undefined

  return (
    <PageShell>
      <PageHeader
        title="Portals"
        description="Manage guest-facing portal pages for this property."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Portals' },
        ]}
        actions={addPortalButton}
      />
      <FormErrorBanner error={deleteMutation.error} />

      {portals.length === 0 ? (
        <EmptyState icon={Globe} title="No portals yet">
          <p className="text-sm text-muted-foreground">
            Create a portal to set up a guest-facing page with links.
          </p>
          {addPortalButton}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.currentTarget.value)
                setPage(0)
              }}
              placeholder="Search portals by name"
              aria-label="Search portals by name"
              className="pl-9"
            />
          </div>

          {matches.length === 0 ? (
            <EmptyState icon={Search} title={`No portals match “${search.trim()}”`}>
              <p className="text-sm text-muted-foreground">
                Try a shorter search, or clear it to see all {portals.length} portals.
              </p>
            </EmptyState>
          ) : (
            <>
              <PortalListTable
                portals={visible}
                propertyId={propertyId}
                canDelete={can('portal.delete')}
                deleteMutation={deleteMutation}
              />
              <div className="flex items-center justify-between gap-4">
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  Showing {pageStart + 1}–{pageStart + visible.length} of {matches.length}
                </p>
                {lastPage > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={currentPage === lastPage}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
      <PortalGroupManagement
        propertyId={propertyId}
        groups={portalGroups}
        portals={portals.map((portal) => ({ id: portal.id, name: portal.name }))}
        createMutation={createGroupMutation}
        updateMutation={updateGroupMutation}
        deleteMutation={deleteGroupMutation}
        addPortalMutation={addPortalToGroupMutation}
        removePortalMutation={removePortalFromGroupMutation}
      />
    </PageShell>
  )
}
