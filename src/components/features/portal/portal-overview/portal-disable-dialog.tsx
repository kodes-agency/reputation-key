// Taking a live Portal's page down, from the row's "more actions" menu. Guests
// reach the unavailable page instead; the codes, the saved draft and the results
// stay, and Review & publish brings the page back.
//
// Controlled, like the archive confirmation: a dialog mounted inside a menu item
// closes with the menu.
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import type { Action } from '#/components/hooks/use-action'

export type PortalDisableMutation = Action<{
  data: { portalId: string; publicationState: 'disabled' }
}>

type Props = Readonly<{
  portalId: string
  portalName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  disableMutation: PortalDisableMutation
}>

export function PortalDisableDialog({
  portalId,
  portalName,
  open,
  onOpenChange,
  disableMutation,
}: Props) {
  // Reversible (Review & publish brings the page back), so neutral, like Archive.
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Disable the public page of ${portalName}?`}
      description="Guests who scan its code or open its link will see that the page is unavailable. Its codes, draft and results stay as they are. To bring the page back, publish it again from Review & publish."
      cancelLabel="Cancel"
      confirmLabel="Disable public page"
      pendingLabel="Disabling…"
      onConfirm={() =>
        disableMutation({ data: { portalId, publicationState: 'disabled' } })
      }
    />
  )
}
