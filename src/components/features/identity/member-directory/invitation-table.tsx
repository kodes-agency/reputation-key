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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {canManage && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">{inv.email}</TableCell>
              <TableCell>
                <RoleBadge role={inv.role} rawRole={inv.rawRole} />
              </TableCell>
              <TableCell>
                <StatusBadge status={inv.status} map={INVITATION_STATUS} />
              </TableCell>
              {canManage ? (
                <TableCell className="text-right">
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
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
