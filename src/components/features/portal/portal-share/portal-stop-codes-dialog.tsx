import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { PortalRevokeLinksForm } from './portal-revoke-links-form'
import type { PortalShareMutations } from './portal-share-types'

export function PortalStopCodesDialog({
  open,
  onOpenChange,
  portalId,
  mutation,
  onStopped,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  mutation: PortalShareMutations['revokeMutation']
  onStopped: () => void
}>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop all codes?</AlertDialogTitle>
          <AlertDialogDescription>
            The public address stops working at once, including a code still in its
            transition period. This does not archive the portal, and you can make a new
            code afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <PortalRevokeLinksForm
          portalId={portalId}
          mutation={mutation}
          onStarted={() => onOpenChange(false)}
          onRevoked={onStopped}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
