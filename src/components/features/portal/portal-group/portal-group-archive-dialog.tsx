// Archiving a group. The portals in it stay (they become "Not in a group") and
// the group's history stays with it; what goes is the group as a choice for new
// goals and results. Controlled, because the menu that opens it closes first.
import { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import type { PortalGroupMutations, PortalGroupRef } from './portal-group-mutations'

type Props = Readonly<{
  group: PortalGroupRef
  open: boolean
  onOpenChange: (open: boolean) => void
  archiveGroupMutation: PortalGroupMutations['archiveGroupMutation']
}>

export function PortalGroupArchiveDialog({
  group,
  open,
  onOpenChange,
  archiveGroupMutation,
}: Props) {
  // The one Archive that is red: the history is kept, but a group has no restore
  // anywhere in the app, so once archived it cannot be taken back (owner decision 2).
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="destructive"
      title={`Archive ${group.name}?`}
      description="Its portals stay and become “Not in a group”. The group’s history and the results it earned are kept, and it is no longer offered for new goals."
      cancelLabel="Cancel"
      confirmLabel="Archive group"
      pendingLabel="Archiving…"
      onConfirm={() => archiveGroupMutation({ data: { portalGroupId: group.id } })}
    />
  )
}
