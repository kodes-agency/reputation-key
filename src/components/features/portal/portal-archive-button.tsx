// Portal archive button with confirmation dialog.
// The server transition is a soft deletion: content and authorized history are retained.

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
import { Archive } from 'lucide-react'
import type { Action } from '#/components/hooks/use-action'

interface PortalArchiveButtonProps {
  portalId: string
  portalName: string
  deleteMutation: Action<{ data: { portalId: string } }>
}

export function PortalArchiveButton({
  portalId,
  portalName,
  deleteMutation,
}: PortalArchiveButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 text-destructive hover:text-destructive sm:min-h-8"
          disabled={deleteMutation.isPending}
        >
          <Archive className="size-3.5" />
          Archive
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {portalName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Guests will no longer be able to open this portal. Its configuration, links,
            and authorized history are retained.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              void deleteMutation({ data: { portalId } }).catch(() => undefined)
            }}
            disabled={deleteMutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteMutation.isPending ? 'Archiving…' : 'Archive portal'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
