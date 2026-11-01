import { StaffAccountsProvider } from '#/components/features/staff/accounts/staff-accounts-provider'
import {
  StaffAccountsList,
  StaffAddAction,
} from '#/components/features/staff/accounts/staff-accounts-list'
import { useStaffAccounts } from '#/components/features/staff/accounts/staff-accounts-context'
// Property Staff (the URL stays /people): personal Portal accounts above the
// existing participation profiles. Organization manager logins stay in Members.
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

function PeoplePageBody({
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
  const accounts = useStaffAccounts()
  const [createParticipationOpen, setCreateParticipationOpen] = useState(false)
  return (
    <PageShell tier="dashboard">
      <PeopleHeader
        propertyId={propertyId}
        propertyName={propertyName}
        accountsEnabled={accounts !== null}
      />

      <StaffAccountsList />
      <StaffTab
        lockedParticipationIds={accounts?.members.map((member) => member.participationId)}
        accountsEnabled={accounts !== null}
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

export function PeoplePage(props: PeoplePageProps) {
  return (
    <StaffAccountsProvider propertyId={props.propertyId}>
      <PeoplePageBody {...props} />
    </StaffAccountsProvider>
  )
}

function PeopleHeader({
  propertyId,
  propertyName,
  accountsEnabled,
}: Readonly<{ propertyId: string; propertyName: string; accountsEnabled: boolean }>) {
  const breadcrumbs = trailCrumbs(
    'property',
    { propertyId, propertyName },
    NAV_LABEL.staff,
  )
  return accountsEnabled ? (
    <PageHeader title="Staff" breadcrumbs={breadcrumbs} actions={<StaffAddAction />} />
  ) : (
    <PageHeader
      title="Staff"
      description="Who works at this property and the Portals they are responsible for; people who sign in are managed in Settings › Members."
      breadcrumbs={breadcrumbs}
    />
  )
}
