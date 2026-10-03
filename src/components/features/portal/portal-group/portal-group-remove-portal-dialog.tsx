// "Remove from group" asks before it acts. The row menu only chooses the portal;
// this dialog is rendered by the group's portal list, outside every menu,
// because a dialog inside a DropdownMenu unmounts when the menu closes.
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'

export type PortalChosenForRemoval = Readonly<{
  portalId: PortalOverviewRow['portalId']
  name: string
}>

/**
 * `portal` stays set after the dialog closes (only `open` flips), so the title
 * does not change while the dialog fades out.
 */
export function PortalGroupRemovePortalDialog({
  portal,
  groupName,
  open,
  onOpenChange,
  onConfirm,
}: Readonly<{
  portal: PortalChosenForRemoval | null
  groupName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rejects with the refusal, which the confirmation says in place. */
  onConfirm: (portalId: PortalChosenForRemoval['portalId']) => Promise<unknown>
}>) {
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${portal?.name ?? 'this portal'} from ${groupName}?`}
      description="The portal stays; it only leaves this group. You can add it back from this page."
      cancelLabel="Keep in group"
      confirmLabel="Remove from group"
      pendingLabel="Removing…"
      onConfirm={() => (portal ? onConfirm(portal.portalId) : undefined)}
    />
  )
}
