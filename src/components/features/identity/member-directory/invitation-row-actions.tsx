// A pending invitation's actions: one "more actions" menu, like every other list row
// (UI consistency scan: COLL-02, ACT-06). Resend sends at once and reports its own
// outcome (toasts); a refusal still rejects the call, so the click settles the
// promise rather than leaking it. Cancelling cannot be taken back, so it is the
// destructive item and asks first, in a dialog this holds outside the menu (a dialog
// inside a menu item closes with the menu). The dialog stays open and says a refusal
// in place, so that Action's rejection goes to the dialog.
import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import {
  RowActionsItem,
  RowActionsMenu,
  RowActionsSeparator,
} from '#/components/ui/row-actions-menu'

type InvitationAction = Action<{ data: { invitationId: string } }>

type Props = Readonly<{
  invitationId: string
  email: string
  resendAction: InvitationAction
  cancelAction: InvitationAction
}>

export function InvitationRowActions({
  invitationId,
  email,
  resendAction,
  cancelAction,
}: Props) {
  const [cancelling, setCancelling] = useState(false)
  return (
    <>
      <RowActionsMenu name={email}>
        <RowActionsItem
          disabled={resendAction.isPending}
          onSelect={() =>
            void resendAction({ data: { invitationId } }).catch(() => undefined)
          }
        >
          Resend invitation
        </RowActionsItem>
        <RowActionsSeparator />
        <RowActionsItem destructive opensDialog onSelect={() => setCancelling(true)}>
          Cancel invitation
        </RowActionsItem>
      </RowActionsMenu>
      <ConfirmationDialog
        open={cancelling}
        onOpenChange={setCancelling}
        tone="destructive"
        title={`Cancel invitation to ${email}?`}
        description="The invitation link will no longer work. You can always send a new invitation later."
        cancelLabel="Keep invitation"
        confirmLabel="Cancel invitation"
        pendingLabel="Cancelling…"
        onConfirm={() => cancelAction({ data: { invitationId } })}
      />
    </>
  )
}
