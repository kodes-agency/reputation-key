// Property › Staff (the address stays /people): the profiles without a login who
// work at the Property and the Portals each is responsible for. People who sign
// in are the Organization's members, managed in Settings › Members, so this page
// has no Directory of them.
import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
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
  createParticipationMutation,
  archiveParticipationMutation,
  updateResponsibilitiesMutation,
}: PeoplePageProps) {
  const [createParticipationOpen, setCreateParticipationOpen] = useState(false)
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Staff"
        description="Who works at this property and the Portals they are responsible for; people who sign in are managed in Settings › Members."
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName },
          NAV_LABEL.staff,
        )}
      />

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
    </PageShell>
  )
}
