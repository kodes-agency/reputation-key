import { useMemo, useState } from 'react'
import { FolderKanban, Plus, UserRoundX, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'
import { Skeleton } from '#/components/ui/skeleton'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { PortalGroupRow } from './portal-group-row'
import { PortalGroupCreateForm } from './portal-group-create-form'
import type { PortalGroupManagementProps } from './portal-group-types'
export type { PortalGroupView } from './portal-group-types'
export function PortalGroupManagement({
  propertyId,
  groups,
  portals,
  state = 'ready',
  error,
  onRetry,
  createMutation,
  updateMutation,
  deleteMutation,
  addPortalMutation,
  removePortalMutation,
}: PortalGroupManagementProps) {
  const { can } = usePermissions()
  const [showCreate, setShowCreate] = useState(false)
  const portalById = useMemo(
    () => new Map(portals.map((portal) => [portal.id, portal])),
    [portals],
  )
  const assignedPortalIds = useMemo(
    () => new Set(groups.flatMap((group) => group.portalIds)),
    [groups],
  )
  const eligiblePortals = portals.filter((portal) => !assignedPortalIds.has(portal.id))
  const mutationError =
    createMutation.error ??
    updateMutation.error ??
    deleteMutation.error ??
    addPortalMutation.error ??
    removePortalMutation.error
  const canCreate = can('portal.create')
  const canUpdate = can('portal.update')
  const canDelete = can('portal.delete')
  return (
    <section className="space-y-4" aria-labelledby="portal-groups-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 id="portal-groups-heading" className="text-lg font-semibold">
            Portal groups
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Organize this property’s review gateways into groups for shared goals. A
            portal can belong to one group at a time.
          </p>
        </div>
        {canCreate && state === 'ready' && (
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => setShowCreate((visible) => !visible)}
            aria-expanded={showCreate}
            aria-controls="create-portal-group-form"
          >
            {showCreate ? (
              <X data-icon="inline-start" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            {showCreate ? 'Cancel' : 'New group'}
          </Button>
        )}
      </div>

      {!canCreate && !canUpdate && !canDelete && state === 'ready' && (
        <Alert>
          <UserRoundX />
          <AlertTitle>View-only access</AlertTitle>
          <AlertDescription>
            You can view portal groups, but you do not have permission to change them.
          </AlertDescription>
        </Alert>
      )}

      {showCreate && (
        <PortalGroupCreateForm
          propertyId={propertyId}
          mutation={createMutation}
          onCreated={() => setShowCreate(false)}
        />
      )}
      <FormErrorBanner error={mutationError ?? (state === 'error' ? error : null)} />

      {state === 'loading' && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading portal groups</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {state === 'error' && onRetry && (
        <div className="flex justify-start">
          <Button variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}

      {state === 'ready' && groups.length === 0 && (
        <EmptyState icon={FolderKanban} title="No portal groups yet">
          <p className="max-w-md text-sm text-muted-foreground">
            Create a group to organize portals from this property. You can add or remove
            portals at any time.
          </p>
        </EmptyState>
      )}

      {state === 'ready' && groups.length > 0 && (
        <div className="divide-y rounded-lg border">
          {groups.map((group) => (
            <PortalGroupRow
              key={group.id}
              group={group}
              portalById={portalById}
              eligiblePortals={eligiblePortals}
              canUpdate={canUpdate}
              canDelete={canDelete}
              updateMutation={updateMutation}
              deleteMutation={deleteMutation}
              addPortalMutation={addPortalMutation}
              removePortalMutation={removePortalMutation}
            />
          ))}
        </div>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {createMutation.isPending ||
        updateMutation.isPending ||
        deleteMutation.isPending ||
        addPortalMutation.isPending ||
        removePortalMutation.isPending
          ? 'Updating portal groups'
          : ''}
      </p>
    </section>
  )
}
