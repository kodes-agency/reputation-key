import { useState } from 'react'
import { RefreshCw, ShieldX } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { Separator } from '#/components/ui/separator'
import { PortalImmediateReplacementDialog } from './portal-immediate-replacement-dialog'
import { PortalPlannedReplacementForm } from './portal-planned-replacement-form'
import { PortalRevokeLinksForm } from './portal-revoke-links-form'
import type { IssuedPortalLink, PortalShareMutations } from './portal-share-types'

type Props = Readonly<{
  portalId: string
  isPending: boolean
  rotateMutation: PortalShareMutations['rotateMutation']
  revokeMutation: PortalShareMutations['revokeMutation']
  onLinkIssued: (link: IssuedPortalLink) => void
  onLinksRevoked: () => void
}>

export function PortalLinkActions({
  portalId,
  isPending,
  rotateMutation,
  revokeMutation,
  onLinkIssued,
  onLinksRevoked,
}: Props) {
  const [plannedReplacementOpen, setPlannedReplacementOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-2 sm:flex-row">
        <AlertDialog
          open={plannedReplacementOpen}
          onOpenChange={setPlannedReplacementOpen}
        >
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={isPending}>
              <RefreshCw data-icon="inline-start" /> Replace access materials
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Plan an access replacement?</AlertDialogTitle>
              <AlertDialogDescription>
                New QR and NFC addresses will be shown once. Existing printed and
                programmed materials keep working during the transition period so you have
                time to replace them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <PortalPlannedReplacementForm
              portalId={portalId}
              mutation={rotateMutation}
              onStarted={() => setPlannedReplacementOpen(false)}
              onLinkIssued={onLinkIssued}
            />
          </AlertDialogContent>
        </AlertDialog>

        <PortalImmediateReplacementDialog
          portalId={portalId}
          disabled={isPending}
          mutation={rotateMutation}
          onLinkIssued={onLinkIssued}
        />

        <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={isPending}
            >
              <ShieldX data-icon="inline-start" /> Revoke links
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke every public link?</AlertDialogTitle>
              <AlertDialogDescription>
                Access stops immediately, including links still within a rotation grace
                period. This does not archive the portal.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <PortalRevokeLinksForm
              portalId={portalId}
              mutation={revokeMutation}
              onStarted={() => setRevokeOpen(false)}
              onRevoked={onLinksRevoked}
            />
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  )
}
