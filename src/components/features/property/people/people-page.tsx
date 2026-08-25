import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { z } from 'zod'
import type { Action } from '#/components/hooks/use-action'
import { DirectoryTab } from '#/components/features/property/people/directory-tab'
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { PageHeader } from '#/components/layout/page-header'
import { ErrorState, LoadingState } from '#/components/layout/page-states'
import { PageShell } from '#/components/layout/page-shell'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import type { PortalOption } from '#/components/features/staff/portal-selector'
import type {
  ArchiveStaffParticipationMutationInput,
  CreateStaffParticipationMutationInput,
  MemberOption,
  PortalResponsibilitySelection,
  StaffParticipationView,
  UpdatePortalResponsibilitiesMutationInput,
} from '#/components/features/staff/types'

export const peopleSearchSchema = z.object({
  tab: z.enum(['staff', 'directory']).optional(),
})

type DirectoryMember = Readonly<{
  userId: string
  name: string
  email: string
  role: string | null
}>

interface PeoplePageProps {
  propertyId: string
  propertyName: string
  participations: ReadonlyArray<StaffParticipationView>
  responsibilities: ReadonlyArray<PortalResponsibilitySelection>
  members: ReadonlyArray<DirectoryMember>
  portals: ReadonlyArray<PortalOption>
  portalsDenied: boolean
  canManageStaff?: boolean
  state?: 'ready' | 'loading' | 'error' | 'forbidden'
  errorMessage?: string
  onRetry?: () => void
  tab: string | undefined
  onTabChange: (tab: string) => void
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
  state = 'ready',
  errorMessage,
  onRetry,
  tab,
  onTabChange,
  createParticipationMutation,
  archiveParticipationMutation,
  updateResponsibilitiesMutation,
}: PeoplePageProps) {
  const activeTab = tab ?? 'staff'
  const [createParticipationOpen, setCreateParticipationOpen] = useState(false)
  const memberOptions: MemberOption[] = members.map((member) => ({
    userId: member.userId,
    name: member.name,
    email: member.email,
  }))
  const activeUserIds = new Set(
    participations
      .filter(
        (participation) =>
          participation.status === 'active' && participation.endedAt == null,
      )
      .map((participation) => participation.userId),
  )

  return (
    <PageShell>
      <PageHeader
        title="People"
        description="Manage property participation and Portal responsibility."
        breadcrumbs={[
          { label: 'Properties', to: '/properties' },
          { label: propertyName, to: `/properties/${propertyId}` },
          { label: 'People' },
        ]}
      />

      {state === 'loading' ? (
        <LoadingState label="Loading people" />
      ) : state === 'error' ? (
        <ErrorState
          message={errorMessage ?? 'People could not be loaded.'}
          onRetry={onRetry}
        />
      ) : state === 'forbidden' ? (
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>People management is unavailable</AlertTitle>
          <AlertDescription>
            You do not have permission to view people at this property.
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="directory">Directory</TabsTrigger>
          </TabsList>

          <StaffTab
            propertyId={propertyId}
            participations={participations}
            responsibilities={responsibilities}
            memberOptions={memberOptions}
            portalOptions={portals}
            portalsDenied={portalsDenied}
            canManageStaff={canManageStaff}
            activeUserIds={activeUserIds}
            createMutation={createParticipationMutation}
            archiveMutation={archiveParticipationMutation}
            createOpen={createParticipationOpen}
            onCreateOpenChange={setCreateParticipationOpen}
            updateResponsibilitiesMutation={updateResponsibilitiesMutation}
          />
          <DirectoryTab members={members} />
        </Tabs>
      )}
    </PageShell>
  )
}
