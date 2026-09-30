import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { PageShell } from '#/components/layout/page-shell'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import type { PortalOption } from '#/components/features/staff/portal-selector'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
  PortalResponsibilitySelection,
  StaffParticipationView,
  UpdatePortalResponsibilitiesMutationInput,
} from '#/components/features/staff/types'

interface PeoplePageProps {
  propertyId: string
  propertyName: string
  participations: ReadonlyArray<StaffParticipationView>
  responsibilities: ReadonlyArray<PortalResponsibilitySelection>
  portals: ReadonlyArray<PortalOption>
  portalsDenied: boolean
  canManageStaff?: boolean
  state?: 'ready' | 'loading' | 'error' | 'forbidden'
  errorMessage?: string
  onRetry?: () => void
  createParticipationMutation: Action<{
    data: CreateStaffParticipationMutationInput
  }>
  archiveParticipationMutation: Action<{
    data: ArchiveStaffParticipationMutationInput
  }>
  updateResponsibilitiesMutation: Action<{
    data: UpdatePortalResponsibilitiesMutationInput
  }>
}

export function PeoplePage({
  propertyId,
  propertyName,
  participations,
  responsibilities,
  portals,
  portalsDenied,
  canManageStaff = true,
  state = 'ready',
  errorMessage,
  onRetry,
  createParticipationMutation,
  archiveParticipationMutation,
  updateResponsibilitiesMutation,
}: PeoplePageProps) {
  const [createParticipationOpen, setCreateParticipationOpen] = useState(false)
  return (
    <PageShell>
      <PageHeader
        title="Staff"
        description="Who works at this property and which Portals they are responsible for. People who sign in are managed under Settings › Members."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'Staff' },
        ]}
      />

      {state === 'loading' ? (
        <LoadingState label="Loading staff" />
      ) : state === 'error' ? (
        <ErrorState
          message={errorMessage ?? 'Staff could not be loaded.'}
          onRetry={onRetry}
        />
      ) : state === 'forbidden' ? (
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Staff is unavailable</AlertTitle>
          <AlertDescription>
            You do not have permission to view staff at this property.
          </AlertDescription>
        </Alert>
      ) : (
        <StaffTab
          propertyId={propertyId}
          participations={participations}
          responsibilities={responsibilities}
          portalOptions={portals}
          portalsDenied={portalsDenied}
          canManageStaff={canManageStaff}
          createMutation={createParticipationMutation}
          archiveMutation={archiveParticipationMutation}
          createOpen={createParticipationOpen}
          onCreateOpenChange={setCreateParticipationOpen}
          updateResponsibilitiesMutation={updateResponsibilitiesMutation}
        />
      )}
    </PageShell>
  )
}
