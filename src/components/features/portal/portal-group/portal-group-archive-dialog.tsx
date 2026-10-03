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
  // Everything the group earned is kept, so it confirms like every Archive: neutral.
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive ${group.name}?`}
      description="Its portals stay and become “Not in a group”. The group’s history and the results it earned are kept, and it is no longer offered for new goals."
      cancelLabel="Cancel"
      confirmLabel="Archive group"
      pendingLabel="Archiving…"
      onConfirm={() => archiveGroupMutation({ data: { portalGroupId: group.id } })}
    />
  )
}
