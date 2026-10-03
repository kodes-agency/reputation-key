// Taking a live Portal's page down, from the row's "more actions" menu. Guests
// reach the unavailable page instead; the codes, the saved draft and the results
// stay, and Review & publish brings the page back.
//
// Controlled, like the archive confirmation: a dialog mounted inside a menu item
// closes with the menu.
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
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disable the public page of {portalName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Guests who scan its code or open its link will see that the page is
            unavailable. Its codes, draft and results stay as they are. To bring the page
            back, publish it again from Review &amp; publish.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              void disableMutation({
                data: { portalId, publicationState: 'disabled' },
              }).catch(() => undefined)
            }}
            disabled={disableMutation.isPending}
          >
            {disableMutation.isPending ? 'Disabling…' : 'Disable public page'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
