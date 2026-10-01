// The open Account Admin invitations of an Organization that has no Account
// Admin (ADR 0063): the address, when it lapses, Resend and Cancel.
//
// Each line owns its Resend and Cancel state (`useAction` over the shared
// Actions), so a click disables that line's buttons, not every line's. The
// route's Actions report the outcome by toast; a refusal still rejects the
// call, so each click settles the promise rather than leaking it.

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
import { useAction, type Action } from '#/components/hooks/use-action'
import type {
  OrganizationInvitationInput,
  PlatformAdminInvitationView,
  ResendOrganizationAdminInvitationResult,
} from '#/contexts/identity/application/dto/platform-console.dto'
import { formatInvitationExpiry } from './platform-console-model'

export type ResendAdminInvitationAction = Action<
  { data: OrganizationInvitationInput },
  ResendOrganizationAdminInvitationResult
>
export type CancelAdminInvitationAction = Action<{ data: OrganizationInvitationInput }>

type LineProps = Readonly<{
  organizationId: string
  organizationName: string
  invitation: PlatformAdminInvitationView
  /** Resend needs an active Organization; Cancel does not. */
  canResend: boolean
  resend: ResendAdminInvitationAction
  cancel: CancelAdminInvitationAction
}>

function AdminInvitationLine({
  organizationId,
  organizationName,
  invitation,
  canResend,
  resend,
  cancel,
}: LineProps) {
  const resendInvitation = useAction(resend)
  const cancelInvitation = useAction(cancel)
  const input = { data: { organizationId, invitationId: invitation.id } }
  const busy = resendInvitation.isPending || cancelInvitation.isPending

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {invitation.email}
          {invitation.expired ? <Badge variant="outline">Expired</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatInvitationExpiry(invitation)}
        </span>
      </div>
      <div className="flex gap-2">
        {canResend ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={`Resend invitation to ${invitation.email}`}
            onClick={() => void resendInvitation(input).catch(() => undefined)}
          >
            Resend
          </Button>
        ) : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={`Cancel invitation to ${invitation.email}`}
              className="text-destructive hover:text-destructive"
            >
              Cancel
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Cancel invitation to {invitation.email}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The link stops working. While {organizationName} has no Account Admin you
                can invite this address again, or another one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep invitation</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void cancelInvitation(input).catch(() => undefined)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Cancel invitation
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  )
}

type Props = Readonly<{
  organizationId: string
  organizationName: string
  invitations: ReadonlyArray<PlatformAdminInvitationView>
  canResend: boolean
  resend: ResendAdminInvitationAction
  cancel: CancelAdminInvitationAction
}>

export function PlatformAdminInvitations({ invitations, ...rest }: Props) {
  if (invitations.length === 0) return null
  return (
    <ul
      aria-label={`Open Account Admin invitations for ${rest.organizationName}`}
      className="divide-y rounded-md border"
    >
      {invitations.map((invitation) => (
        <AdminInvitationLine key={invitation.id} invitation={invitation} {...rest} />
      ))}
    </ul>
  )
}
