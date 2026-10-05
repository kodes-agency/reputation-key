/**
 * InvitationTable — extracted from settings/members.tsx route.
 * Displays pending invitations; a pending one has a menu to resend or cancel it.
 */

import { SectionTitle } from '#/components/ui/section-title'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import { StatusBadge } from '#/components/ui/status-badge'
import { INVITATION_STATUS } from './invitation-status'
import { InvitationRowActions } from './invitation-row-actions'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '#/components/ui/data-table'
import { Shield } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'
import type { Role } from '#/shared/domain/roles'

export interface InvitationRow {
  id: string
  email: string
  role: Role | null
  rawRole: string
  status: string
}

/**
 * What the two Actions do when they refuse is `InvitationRowActions`' to say: the
 * resend is settled there, and the cancellation's rejection goes to its dialog.
 */
type Props = Readonly<{
  invitations: ReadonlyArray<InvitationRow>
  resendAction: Action<{ data: { invitationId: string } }>
  cancelAction: Action<{ data: { invitationId: string } }>
}>

export function InvitationTable({ invitations, resendAction, cancelAction }: Props) {
  const { can } = usePermissions()
  const canManage = can('invitation.cancel')

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle className="flex items-center gap-2">
        <Shield aria-hidden="true" />
        Pending invitations
      </SectionTitle>
      <DataTable label="Pending invitations" from="3xl">
        <DataTableHeader>
          <DataTableHead>Email</DataTableHead>
          <DataTableHead>Role</DataTableHead>
          <DataTableHead>Status</DataTableHead>
          {canManage ? <DataTableHead actions /> : null}
        </DataTableHeader>
        <DataTableBody>
          {invitations.map((inv) => (
            <DataTableRow key={inv.id}>
              <DataTableCell className="col-start-1 row-start-1 min-w-0 self-center font-medium whitespace-normal">
                {inv.email}
              </DataTableCell>
              <DataTableCell className="col-start-1 row-start-2">
                <RoleBadge role={inv.role} rawRole={inv.rawRole} />
              </DataTableCell>
              <DataTableCell className="col-start-2 row-start-2 justify-self-end">
                <StatusBadge status={inv.status} map={INVITATION_STATUS} />
              </DataTableCell>
              {canManage ? (
                <DataTableCell actions className="col-start-2 row-start-1">
                  {inv.status === 'pending' ? (
                    <InvitationRowActions
                      invitationId={inv.id}
                      email={inv.email}
                      resendAction={resendAction}
                      cancelAction={cancelAction}
                    />
                  ) : null}
                </DataTableCell>
              ) : null}
            </DataTableRow>
          ))}
        </DataTableBody>
      </DataTable>
    </div>
  )
}
