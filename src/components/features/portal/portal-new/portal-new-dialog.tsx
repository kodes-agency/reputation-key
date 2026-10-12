// New portal — the dialog (docs/design/portal-experience/round-4-admin, board 3).
// Asks for a name, a group, languages and what to start from, and creates a
// draft. There is no "kind of place": the product serves hotels, restaurants,
// barbers and salons alike. Presentational: the Portals page owns the open
// state (the URL), the reads and the create action.
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { PortalNewForm } from './portal-new-form'
import type { PortalNewData } from './portal-new-types'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null until the Property's options have loaded. */
  data: PortalNewData | null
  /** Why the options could not be read; the form is not offered then. */
  loadError?: unknown
}>

export function PortalNewDialog({ open, onOpenChange, data, loadError }: Props) {
  return (
    <Dialog open={open} busy={data?.mutation.isPending} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New portal</DialogTitle>
          <DialogDescription>
            A page guests reach from a QR code, an NFC tag or a link.
          </DialogDescription>
        </DialogHeader>
        {data ? (
          <PortalNewForm data={data} />
        ) : loadError ? (
          <FormErrorBanner error={loadError} />
        ) : (
          <div role="status" aria-label="Loading" className="flex flex-col gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
