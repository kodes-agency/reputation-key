import { useMemo, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { PortalResponsibilitiesModal } from '#/components/features/staff/portal-responsibilities-modal'
import {
  StaffParticipationForm,
  StaffParticipationList,
} from '#/components/features/staff'
import type { PortalOption } from '#/components/features/staff/portal-selector'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { AddAction } from '#/components/ui/add-action'
import { SectionTitle } from '#/components/ui/section-title'
import { cn } from '#/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
  PortalResponsibilitySelection,
  StaffParticipationView,
  UpdatePortalResponsibilitiesMutationInput,
} from '#/components/features/staff/types'

interface StaffTabProps {
  /** People with a personal Portal are listed above, under Add staff. */
  personalParticipationIds?: readonly string[]
  accountsEnabled?: boolean
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

function StaffProfilesHeader({
  accountsEnabled,
  propertyId,
  createMutation,
  createOpen,
  onCreateOpenChange,
}: Pick<
  StaffTabProps,
  'propertyId' | 'createMutation' | 'createOpen' | 'onCreateOpenChange'
> &
  Readonly<{ accountsEnabled: boolean }>) {
  return (
    <div
      className={cn(
        'flex items-center gap-4',
        accountsEnabled ? 'justify-between' : 'justify-end',
      )}
    >
      {accountsEnabled ? <SectionTitle>Profiles without a login</SectionTitle> : null}
      <Dialog
        open={createOpen}
        busy={createMutation.isPending}
        onOpenChange={onCreateOpenChange}
      >
        <DialogTrigger asChild>
          <AddAction variant={accountsEnabled ? 'outline' : undefined}>
            {accountsEnabled ? 'Add profile' : 'Add staff'}
          </AddAction>
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
  )
}

export function StaffTab({
  personalParticipationIds = [],
  accountsEnabled = false,
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
  const profiles = useMemo(
    () =>
      participations.filter(
        (participation) => !personalParticipationIds.includes(participation.id),
      ),
    [participations, personalParticipationIds],
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
      <section aria-label="Staff">
        <Alert variant="info">
          <AlertTitle>Staff management is unavailable</AlertTitle>
          <AlertDescription>
            You do not have permission to manage participation at this property.
          </AlertDescription>
        </Alert>
      </section>
    )
  }

  return (
    <section aria-label="Staff" className="space-y-4">
      <StaffProfilesHeader
        accountsEnabled={accountsEnabled}
        propertyId={propertyId}
        createMutation={createMutation}
        createOpen={createOpen}
        onCreateOpenChange={onCreateOpenChange}
      />

      {portalsDenied && (
        <Alert variant="info">
          <AlertTitle>Portal responsibilities are unavailable</AlertTitle>
          <AlertDescription>
            You can still manage staff participation. Portal responsibility controls
            require access to this property's portals.
          </AlertDescription>
        </Alert>
      )}

      {accountsEnabled && profiles.length === 0 ? null : (
        <StaffParticipationList
          participations={profiles}
          archiveAction={archiveMutation}
          canManageResponsibilities={!portalsDenied}
          onEditResponsibilities={setEditingParticipationId}
        />
      )}

      {editingParticipation &&
        !personalParticipationIds.includes(editingParticipation.id) &&
        !portalsDenied && (
          <PortalResponsibilitiesModal
            key={editingParticipation.id}
            staffParticipationId={editingParticipation.id}
            displayName={editingParticipation.displayName}
            currentPrimaryPortalId={editingResponsibilities?.primaryPortalId ?? null}
            currentSupportingPortalIds={
              editingResponsibilities?.supportingPortalIds ?? []
            }
            expectedRevision={editingParticipation.revision}
            allPortals={portalOptions}
            updateAction={updateResponsibilitiesMutation}
            onOpenChange={(open) => {
              if (!open) setEditingParticipationId(null)
            }}
          />
        )}
    </section>
  )
}
