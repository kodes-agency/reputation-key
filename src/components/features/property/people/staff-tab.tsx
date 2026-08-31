import { useMemo, useState } from 'react'
import { LockKeyhole, Plus } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { PortalResponsibilitiesModal } from '#/components/features/staff/portal-responsibilities-modal'
import {
  StaffParticipationForm,
  StaffParticipationList,
} from '#/components/features/staff'
import type { PortalOption } from '#/components/features/staff/portal-selector'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { TabsContent } from '#/components/ui/tabs'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
  PortalResponsibilitySelection,
  StaffParticipationView,
  UpdatePortalResponsibilitiesMutationInput,
} from '#/components/features/staff/types'

interface StaffTabProps {
  propertyId: string
  participations: ReadonlyArray<StaffParticipationView>
  responsibilities: ReadonlyArray<PortalResponsibilitySelection>
  portalOptions: ReadonlyArray<PortalOption>
  portalsDenied: boolean
  canManageStaff?: boolean
  createMutation: Action<{ data: CreateStaffParticipationMutationInput }>
  archiveMutation: Action<{ data: ArchiveStaffParticipationMutationInput }>
  createOpen: boolean
  onCreateOpenChange: (open: boolean) => void
  updateResponsibilitiesMutation: Action<{
    data: UpdatePortalResponsibilitiesMutationInput
  }>
}

export function StaffTab({
  propertyId,
  participations,
  responsibilities,
  portalOptions,
  portalsDenied,
  canManageStaff = true,
  createMutation,
  archiveMutation,
  createOpen,
  onCreateOpenChange,
  updateResponsibilitiesMutation,
}: StaffTabProps) {
  const [editingParticipationId, setEditingParticipationId] = useState<string | null>(
    null,
  )
  const editingParticipation = useMemo(
    () =>
      participations.find(
        (participation) => participation.id === editingParticipationId,
      ) ?? null,
    [editingParticipationId, participations],
  )
  const editingResponsibilities = useMemo(
    () =>
      responsibilities.find(
        (responsibility) =>
          responsibility.staffParticipationId === editingParticipationId,
      ) ?? null,
    [editingParticipationId, responsibilities],
  )

  if (!canManageStaff) {
    return (
      <TabsContent value="staff" className="mt-4">
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Staff management is unavailable</AlertTitle>
          <AlertDescription>
            You do not have permission to manage participation at this property.
          </AlertDescription>
        </Alert>
      </TabsContent>
    )
  }

  return (
    <TabsContent value="staff" className="mt-4 space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus aria-hidden="true" />
              Add staff
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add staff participation</DialogTitle>
              <DialogDescription>
                Add a person to this property for operational attribution. A login account
                is not required, and Portal responsibilities are managed separately.
              </DialogDescription>
            </DialogHeader>
            <StaffParticipationForm
              propertyId={propertyId}
              mutation={createMutation}
              onSuccess={() => onCreateOpenChange(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {portalsDenied && (
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Portal responsibilities are unavailable</AlertTitle>
          <AlertDescription>
            You can still manage staff participation. Portal responsibility controls
            require access to this property's portals.
          </AlertDescription>
        </Alert>
      )}

      <StaffParticipationList
        participations={participations}
        archiveAction={archiveMutation}
        canManageResponsibilities={!portalsDenied}
        onEditResponsibilities={setEditingParticipationId}
      />

      {editingParticipation && !portalsDenied && (
        <PortalResponsibilitiesModal
          key={editingParticipation.id}
          staffParticipationId={editingParticipation.id}
          displayName={editingParticipation.displayName}
          currentPrimaryPortalId={editingResponsibilities?.primaryPortalId ?? null}
          currentSupportingPortalIds={editingResponsibilities?.supportingPortalIds ?? []}
          expectedRevision={editingParticipation.revision}
          allPortals={portalOptions}
          updateAction={updateResponsibilitiesMutation}
          onOpenChange={(open) => {
            if (!open) setEditingParticipationId(null)
          }}
        />
      )}
    </TabsContent>
  )
}
