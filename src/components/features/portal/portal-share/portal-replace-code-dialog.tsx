import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { PortalReplaceCodeForm } from './portal-replace-code-form'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

export function PortalReplaceCodeDialog({
  open,
  onOpenChange,
  portalId,
  mutation,
  onLinkIssued,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  portalId: string
  mutation: PortalShareMutations['rotateMutation']
  onLinkIssued: (link: IssuedPortalLink) => void
}>) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace the code?</AlertDialogTitle>
          <AlertDialogDescription>
            A new code is made. Its QR image and addresses are shown right after, and only
            then, so have somewhere to save them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <PortalReplaceCodeForm
          portalId={portalId}
          mutation={mutation}
          onStarted={() => onOpenChange(false)}
          onLinkIssued={onLinkIssued}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
