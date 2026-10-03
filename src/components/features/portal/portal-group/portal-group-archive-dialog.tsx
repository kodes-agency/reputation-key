// Archiving a group. The portals in it stay (they become "Not in a group") and
// the group's history stays with it; what goes is the group as a choice for new
// goals and results. Controlled, because the menu that opens it closes first.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {group.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its portals stay and become “Not in a group”. The group’s history and the
            results it earned are kept, and it is no longer offered for new goals.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={archiveGroupMutation.isPending}
            onClick={() => {
              void archiveGroupMutation({ data: { portalGroupId: group.id } }).catch(
                () => undefined,
              )
            }}
          >
            {archiveGroupMutation.isPending ? 'Archiving…' : 'Archive group'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
