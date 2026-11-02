import { Users } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { useStaffFunctions } from './staff-account-functions'
import { Button } from '#/components/ui/button'
import { Link } from '@tanstack/react-router'
import {
  useActionMutation,
  actionErrorMessage,
} from '#/components/hooks/use-action-mutation'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { AddAction } from '#/components/ui/add-action'
import { OwnerDisc } from '#/components/ui/owner-disc'
import { personInitials } from '#/components/inbox/person-initials'
import {
  DataTable,
  DataTableBody,
  DataTableRow,
  DataTableCell,
  DataTableHeader,
  DataTableHead,
} from '#/components/ui/data-table'
import { useStaffAccounts } from './staff-accounts-context'
import { staffAccessLine } from './staff-account-view'
import { StaffMemberMenu, StaffRetry } from './staff-member-actions'

export function StaffAddAction({
  variant = 'default',
}: Readonly<{ variant?: 'default' | 'outline' }> = {}) {
  const accounts = useStaffAccounts()
  return accounts?.canInvite ? (
    <AddAction variant={variant} onClick={() => accounts.openAdd()}>
      Add staff
    </AddAction>
  ) : null
}
export function StaffAccountsList() {
  const accounts = useStaffAccounts()
  const { setColleagueListEnabled } = useStaffFunctions()
  const setting = useActionMutation(setColleagueListEnabled, {
    errorMessage: actionErrorMessage,
    onSuccess: () => accounts?.refresh().then(() => undefined),
  })
  if (!accounts) return null
  return (
    <section aria-label="Personal portals" className="space-y-4">
      {accounts.members.length ? (
        <DataTable label="Staff with personal portals" from="3xl">
          <DataTableHeader>
            <DataTableHead>Staff member</DataTableHead>
            <DataTableHead>Access</DataTableHead>
            <DataTableHead>Portal</DataTableHead>
            <DataTableHead actions />
          </DataTableHeader>
          <DataTableBody>
            {[...accounts.members]
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
              .map((member) => (
                <DataTableRow key={member.participationId}>
                  <DataTableCell>
                    <span className="inline-flex items-center gap-2">
                      <OwnerDisc
                        initials={personInitials(member.displayName)}
                        isAssigned
                        tone="neutral"
                      />
                      {member.displayName}
                    </span>
                  </DataTableCell>
                  <DataTableCell>
                    {staffAccessLine(member.access)} <StaffRetry member={member} />
                  </DataTableCell>
                  <DataTableCell>
                    {member.portalId ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to="/properties/$propertyId/portals/$portalId"
                          params={{
                            propertyId: accounts.propertyId,
                            portalId: member.portalId,
                          }}
                          search={{ tab: 'page' }}
                        >
                          Edit
                        </Link>
                      </Button>
                    ) : null}
                  </DataTableCell>
                  <DataTableCell>
                    <StaffMemberMenu member={member} />
                  </DataTableCell>
                </DataTableRow>
              ))}
          </DataTableBody>
        </DataTable>
      ) : accounts.ready ? (
        <EmptyState icon={Users} title="No staff yet" action={<StaffAddAction />} />
      ) : null}
      {accounts.canSettings ? (
        <SettingSwitchRow
          id="staff-colleague-list"
          label="Show staff each other's scans"
          description="Everyone at this property sees all staff scan counts, in name order."
          checked={accounts.colleagueListEnabled}
          commit="immediate"
          disabled={accounts.ready === false}
          pending={setting.isPending}
          onCheckedChange={(enabled) =>
            setting({ data: { propertyId: accounts.propertyId, enabled } })
          }
        />
      ) : null}
    </section>
  )
}
