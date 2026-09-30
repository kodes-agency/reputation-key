/**
 * InvitationTable — the Organization's open invitations: who was invited as
 * what, for which properties, when it was sent and when it lapses. Resend
 * renews the same invitation's expiry and emails it again; an expired one is
 * renewed the same way, so there is one row per person.
 */

import { TriangleAlert } from 'lucide-react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { RoleBadge } from '#/components/features/identity/shared/role-badge'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { Action } from '#/components/hooks/use-action'
import type { OrganizationInvitation } from '#/contexts/identity/application/dto/invitation.dto'
import { formatInvitationDay } from './invitation-day'
import { summarizeProperties } from './property-summary'

export type InvitationRow = OrganizationInvitation

/**
 * The route's Actions report their own outcome (toasts); a refusal still rejects
 * the call, so each click settles the promise rather than leaking it.
 */
type Props = Readonly<{
  invitations: ReadonlyArray<InvitationRow>
  resendAction: Action<{ data: { invitationId: string } }>
  cancelAction: Action<{ data: { invitationId: string } }>
}>

function InvitedProperties({ invitation }: Readonly<{ invitation: InvitationRow }>) {
  if (invitation.role === 'AccountAdmin') return <span>All properties</span>
  if (invitation.properties.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-warn">
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        None chosen
      </span>
    )
  }
  const { shown, hiddenCount, all } = summarizeProperties(invitation.properties)
  return (
    <span title={hiddenCount > 0 ? all : undefined}>
      {shown.join(', ')}
      {hiddenCount > 0 ? (
        <span className="text-muted-foreground"> +{hiddenCount} more</span>
      ) : null}
    </span>
  )
}

function ExpiryCell({ invitation }: Readonly<{ invitation: InvitationRow }>) {
  if (invitation.status === 'expired') {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="outline" className="border-warn-line text-warn">
          Expired
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatInvitationDay(invitation.expiresAt)}
        </span>
      </div>
    )
  }
  return <span>{formatInvitationDay(invitation.expiresAt)}</span>
}

function CancelInvitationDialog({
  invitation,
  cancelAction,
}: Readonly<{ invitation: InvitationRow; cancelAction: Props['cancelAction'] }>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
        >
          Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel invitation to {invitation.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            The invitation link will no longer work. You can always send a new invitation
            later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep invitation</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              void cancelAction({ data: { invitationId: invitation.id } }).catch(
                () => undefined,
              )
            }
            disabled={cancelAction.isPending}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {cancelAction.isPending ? 'Cancelling…' : 'Cancel invitation'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function InvitationTable({ invitations, resendAction, cancelAction }: Props) {
  const { can } = usePermissions()
  const canManage = can('invitation.cancel') || can('invitation.resend')

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Invitations</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Properties</TableHead>
            <TableHead>Invited by</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Expires</TableHead>
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
                <InvitedProperties invitation={inv} />
              </TableCell>
              <TableCell
                className={inv.inviterName ? undefined : 'text-muted-foreground'}
              >
                {inv.inviterName ?? 'Unknown'}
              </TableCell>
              <TableCell>{formatInvitationDay(inv.createdAt)}</TableCell>
              <TableCell>
                <ExpiryCell invitation={inv} />
              </TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {can('invitation.resend') ? (
                      <Button
                        variant="outline"
                        size="sm"
                        title="Resend and renew the expiry"
                        disabled={resendAction.isPending}
                        onClick={() =>
                          void resendAction({ data: { invitationId: inv.id } }).catch(
                            () => undefined,
                          )
                        }
                      >
                        {inv.status === 'expired' ? 'New link' : 'Resend'}
                      </Button>
                    ) : null}
                    {can('invitation.cancel') ? (
                      <CancelInvitationDialog
                        invitation={inv}
                        cancelAction={cancelAction}
                      />
                    ) : null}
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
