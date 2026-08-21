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
  // The revoke dialog is controlled so the reason field can live in a real
  // <form>: Enter must submit it (the field was previously unreachable by
  // keyboard alone). The submit button is a plain Button rather than
  // AlertDialogAction because AlertDialogAction closes the dialog from its own
  // click handler, which can unmount the form before the browser dispatches
  // `submit`; closing from submitRevoke instead keeps one deterministic path.
  const [revokeOpen, setRevokeOpen] = useState(false)

  const submitRevoke = () => {
    const reason = revokeReason.trim()
    if (!reason || revokeMutation.isPending) return
    // Close on submit rather than on success, matching the previous behaviour:
    // a failed revoke surfaces in the page-level error banner, which sits
    // behind the dialog overlay.
    setRevokeOpen(false)
    void revokeMutation({ data: { portalId, reason } })
      .then(() => {
        onLinksRevoked()
        setRevokeReason('')
      })
      .catch(() => undefined)
  }

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
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                submitRevoke()
              }}
            >
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
                <Button
                  type="submit"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={!revokeReason.trim() || revokeMutation.isPending}
                >
                  {revokeMutation.isPending ? 'Revoking…' : 'Revoke links'}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  )
}
