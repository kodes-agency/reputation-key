// Portal list page — extracted from route for testability and separation of concerns
import { Link } from '@tanstack/react-router'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { EmptyState } from '#/components/ui/empty-state'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { PageShell } from '#/components/layout/page-shell'
import { PageHeader } from '#/components/layout/page-header'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import { Plus, Globe, Eye } from 'lucide-react'
import { PortalArchiveButton } from './portal-archive-button'
import { PortalGroupManagement, type PortalGroupView } from './portal-group-management'
import type { Action } from '#/components/hooks/use-action'

interface Portal {
  id: string
  name: string
  publicationState: 'draft' | 'published' | 'disabled' | 'archived'
  theme: Record<string, unknown>
}

export interface PortalListPageProps {
  portals: readonly Portal[]
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
        actions={
          can('portal.create') ? (
            <Button asChild className="min-h-11 sm:min-h-9">
              <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
                <Plus />
                Add Portal
              </Link>
            </Button>
          ) : undefined
        }
      />
      <FormErrorBanner error={deleteMutation.error} />

      {portals.length === 0 ? (
        <EmptyState icon={Globe} title="No portals yet">
          <p className="text-sm text-muted-foreground">
            Create a portal to set up a guest-facing page with links.
          </p>
          {can('portal.create') && (
            <Button asChild className="min-h-11 sm:min-h-9">
              <Link to="/properties/$propertyId/portals/new" params={{ propertyId }}>
                <Plus />
                Add Portal
              </Link>
            </Button>
          )}
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Theme</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {portals.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    to="/properties/$propertyId/portals/$portalId"
                    params={{ propertyId, portalId: p.id }}
                    search={{ tab: 'settings' }}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <div
                    className="size-5 rounded-full border"
                    style={{
                      backgroundColor:
                        (p.theme as Record<string, string>)?.primaryColor ??
                        'var(--accent)',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Badge
                    variant={p.publicationState === 'published' ? 'default' : 'outline'}
                  >
                    {p.publicationState[0].toUpperCase() + p.publicationState.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      asChild
                    >
                      <Link
                        to="/properties/$propertyId/portals/$portalId"
                        params={{ propertyId, portalId: p.id }}
                        aria-label={`View ${p.name}`}
                        search={{ tab: 'settings' }}
                      >
                        <Eye className="size-3.5" />
                      </Link>
                    </Button>
                    {can('portal.delete') && p.publicationState !== 'archived' && (
                      <PortalArchiveButton
                        portalId={p.id}
                        portalName={p.name}
                        deleteMutation={deleteMutation}
                      />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
