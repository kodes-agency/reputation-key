import { ShieldAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

export function PortalImmediateReplacementDialog({
  portalId,
  disabled,
  mutation,
  onLinkIssued,
}: Readonly<{
  portalId: string
  disabled: boolean
  mutation: PortalShareMutations['rotateMutation']
  onLinkIssued: (link: IssuedPortalLink) => void
}>) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <ShieldAlert data-icon="inline-start" /> Replace immediately
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace access immediately?</AlertDialogTitle>
          <AlertDialogDescription>
            Use this when existing QR or NFC materials should stop working now, for
            example after one is misplaced. New addresses will be shown once and all
            existing materials will need replacing.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={() => {
              void mutation({
                data: { portalId, replacementKind: 'security' },
              })
                .then(onLinkIssued)
                .catch(() => undefined)
            }}
          >
            {mutation.isPending ? 'Replacing…' : 'Replace now'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
