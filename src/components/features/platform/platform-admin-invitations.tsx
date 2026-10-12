// The open Account Admin invitations of an Organization that has no Account
// Admin (ADR 0065): the address, when it lapses, Resend and Cancel.
//
// Each line owns its Resend state (`useAction` over the shared Action), so a
// click disables that line's item, not every line's; the route's Action reports
// the outcome by toast, and a refusal still rejects the call, so the click
// settles the promise rather than leaking it. Cancel is confirmed in a
// ConfirmationDialog, which stays open and says a refusal in place.

import { useState } from 'react'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'
import { StatusBadge } from '#/components/ui/status-badge'
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
  const [cancelling, setCancelling] = useState(false)
  const input = { data: { organizationId, invitationId: invitation.id } }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {invitation.email}
          {invitation.expired ? <StatusBadge tone="warn" label="Expired" /> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatInvitationExpiry(invitation)}
        </span>
      </div>
      <RowActionsMenu name={invitation.email}>
        {canResend ? (
          <>
            <RowActionsItem
              disabled={resendInvitation.isPending}
              onSelect={() => void resendInvitation(input).catch(() => undefined)}
            >
              Resend invitation
            </RowActionsItem>
            <RowActionsSeparator />
          </>
        ) : null}
        <RowActionsItem destructive opensDialog onSelect={() => setCancelling(true)}>
          Cancel invitation
        </RowActionsItem>
      </RowActionsMenu>
      <ConfirmationDialog
        open={cancelling}
        onOpenChange={setCancelling}
        tone="destructive"
        title={`Cancel invitation to ${invitation.email}?`}
        description={`The link stops working. While ${organizationName} has no Account Admin you can invite this address again, or another one.`}
        cancelLabel="Keep invitation"
        confirmLabel="Cancel invitation"
        pendingLabel="Cancelling…"
        onConfirm={() => cancel(input)}
      />
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
