import { staffRosterSummary } from '#/components/features/staff/accounts/staff-list-view'
import { Users } from 'lucide-react'
import { StaffAccountsProvider } from '#/components/features/staff/accounts/staff-accounts-provider'
import {
  StaffAccountsList,
  StaffAddAction,
} from '#/components/features/staff/accounts/staff-accounts-list'
import { useStaffAccounts } from '#/components/features/staff/accounts/staff-accounts-context'
import { PageHeader } from '#/components/layout/page-header'
import { NAV_LABEL } from '#/components/layout/nav-labels'
import { trailCrumbs } from '#/components/layout/page-identity'
import { PageShell } from '#/components/layout/page-shell'
import { EmptyState } from '#/components/ui/empty-state'

export type PeoplePageProps = Readonly<{ propertyId: string; propertyName: string }>
function PeoplePageBody({ propertyId, propertyName }: PeoplePageProps) {
  const accounts = useStaffAccounts()
  return (
    <PageShell tier="dashboard">
      <PageHeader
        title="Staff"
        breadcrumbs={trailCrumbs(
          'property',
          { propertyId, propertyName },
          NAV_LABEL.staff,
        )}
        meta={
          accounts?.ready
            ? [<span key="count">{staffRosterSummary(accounts.members)}</span>]
            : undefined
        }
        actions={accounts?.members.length ? <StaffAddAction /> : undefined}
      />
      {accounts ? (
        <StaffAccountsList />
      ) : (
        <EmptyState icon={Users} title="Staff accounts are unavailable" />
      )}
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
