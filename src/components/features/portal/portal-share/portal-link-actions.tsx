import { useState } from 'react'
import { RefreshCw, ShieldX } from 'lucide-react'
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
import { Field, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Separator } from '#/components/ui/separator'
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
  const [revokeReason, setRevokeReason] = useState('')

  return (
    <>
      <Separator />
      <div className="flex flex-col gap-2 sm:flex-row">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={isPending}>
              <RefreshCw data-icon="inline-start" /> Rotate link
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rotate this public link?</AlertDialogTitle>
              <AlertDialogDescription>
                A new link will be shown once. Existing printed links remain valid only
                through their recorded grace period.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={rotateMutation.isPending}
                onClick={() => {
                  void rotateMutation({ data: { portalId } })
                    .then((link) => onLinkIssued({ publicUrl: link.publicUrl }))
                    .catch(() => undefined)
                }}
              >
                {rotateMutation.isPending ? 'Rotating…' : 'Rotate link'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
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
            <Field className="py-2">
              <FieldLabel htmlFor="portal-revoke-reason">Reason</FieldLabel>
              <Input
                id="portal-revoke-reason"
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
                maxLength={500}
                placeholder="Printed code was misplaced"
                autoFocus
                required
              />
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={!revokeReason.trim() || revokeMutation.isPending}
                onClick={() => {
                  const reason = revokeReason.trim()
                  if (!reason) return
                  void revokeMutation({ data: { portalId, reason } })
                    .then(() => {
                      onLinksRevoked()
                      setRevokeReason('')
                    })
                    .catch(() => undefined)
                }}
              >
                {revokeMutation.isPending ? 'Revoking…' : 'Revoke links'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  )
}
