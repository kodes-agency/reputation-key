/**
 * InvitationTable — extracted from settings/members.tsx route.
 * Displays pending invitations with resend/cancel actions.
 */

import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import { Button } from '#/components/ui/button'
import { StatusBadge } from '#/components/ui/status-badge'
import { INVITATION_STATUS } from './invitation-status'
import {
  ConfirmationDialog,
  ConfirmationTrigger,
} from '#/components/ui/confirmation-dialog'
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
 * Resend reports its own outcome (toasts); a refusal still rejects the call, so
 * the click settles the promise rather than leaking it. Cancelling is confirmed
 * in a dialog, which stays open and says a refusal in place: that Action's
 * rejection goes to the dialog.
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
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Shield />
        Pending Invitations
      </h3>
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
              <DataTableCell className="col-start-1 row-start-1 min-w-0 font-medium whitespace-normal">
                {inv.email}
              </DataTableCell>
              <DataTableCell className="col-start-1 row-start-2">
                <RoleBadge role={inv.role} rawRole={inv.rawRole} />
              </DataTableCell>
              <DataTableCell className="col-start-2 row-start-1 justify-self-end">
                <StatusBadge status={inv.status} map={INVITATION_STATUS} />
              </DataTableCell>
              {canManage ? (
                <DataTableCell className="col-span-2 @3xl:text-right">
                  {inv.status === 'pending' ? (
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={resendAction.isPending}
                        onClick={() =>
                          void resendAction({ data: { invitationId: inv.id } }).catch(
                            () => undefined,
                          )
                        }
                      >
                        Resend
                      </Button>
                      <ConfirmationDialog
                        trigger={
                          <ConfirmationTrigger tone="destructive" size="sm">
                            Cancel
                          </ConfirmationTrigger>
                        }
                        tone="destructive"
                        title={`Cancel invitation to ${inv.email}?`}
                        description="The invitation link will no longer work. You can always send a new invitation later."
                        cancelLabel="Keep invitation"
                        confirmLabel="Cancel invitation"
                        pendingLabel="Cancelling…"
                        onConfirm={() => cancelAction({ data: { invitationId: inv.id } })}
                      />
                    </div>
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
