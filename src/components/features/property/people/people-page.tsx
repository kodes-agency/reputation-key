import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { Action } from '#/components/hooks/use-action'
import type { Role } from '#/shared/domain/roles'
import { DirectoryTab } from '#/components/features/property/people/directory-tab'
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { PageHeader } from '#/components/layout/page-header'
import { PageShell } from '#/components/layout/page-shell'
import { LinkTab, LinkTabs } from '#/components/ui/link-tabs'
import type { PortalOption } from '#/components/features/staff/portal-selector'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
  PortalResponsibilitySelection,
  StaffParticipationView,
  UpdatePortalResponsibilitiesMutationInput,
} from '#/components/features/staff/types'

type DirectoryMember = Readonly<{
  userId: string
  name: string
  email: string
  role: Role | null
  rawRole: string
}>

type PeopleView = 'staff' | 'directory'

const PEOPLE_VIEWS: ReadonlyArray<Readonly<{ value: PeopleView; label: string }>> = [
  { value: 'staff', label: 'Staff' },
  { value: 'directory', label: 'Directory' },
]

interface PeoplePageProps {
  propertyId: string
  propertyName: string
  participations: ReadonlyArray<StaffParticipationView>
  responsibilities: ReadonlyArray<PortalResponsibilitySelection>
  members: ReadonlyArray<DirectoryMember>
  portals: ReadonlyArray<PortalOption>
  portalsDenied: boolean
  canManageStaff?: boolean
  /** The view the URL names (`?tab=`); Staff when it names none. */
  tab: string | undefined
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
  members,
  portals,
  portalsDenied,
  canManageStaff = true,
  tab,
  createParticipationMutation,
  archiveParticipationMutation,
  updateResponsibilitiesMutation,
}: PeoplePageProps) {
  const activeView: PeopleView = tab === 'directory' ? 'directory' : 'staff'
  const [createParticipationOpen, setCreateParticipationOpen] = useState(false)
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="People"
        description="Manage property participation and Portal responsibility."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'People' },
        ]}
      />

      <div className="flex flex-col gap-4">
        <LinkTabs aria-label="People views">
          {PEOPLE_VIEWS.map((view) => (
            <LinkTab key={view.value} active={view.value === activeView}>
              <Link
                to="/properties/$propertyId/people"
                params={{ propertyId }}
                search={{ tab: view.value }}
              >
                {view.label}
              </Link>
            </LinkTab>
          ))}
        </LinkTabs>

        {activeView === 'staff' ? (
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
        ) : (
          <DirectoryTab members={members} />
        )}
      </div>
    </PageShell>
  )
}
