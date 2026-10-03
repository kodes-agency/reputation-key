// The foot of an image dialog (round-4 admin board 14): a line saying the live
// pages change only when the look is published, Cancel, and the primary button,
// which stays off until the dialog has what it needs.

import { EyeOff } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DialogFooter } from '#/components/ui/dialog'

type Props = Readonly<{
  /** Names the button: "Use photo", "Save", "Uploading…". */
  primaryLabel: string
  canSubmit: boolean
  isBusy: boolean
  onSubmit: () => void
  onCancel: () => void
}>

export function UploadDialogFooter({
  primaryLabel,
  canSubmit,
  isBusy,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <DialogFooter className="sm:items-center sm:justify-between">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <EyeOff className="size-4 shrink-0" aria-hidden />
        Live pages change when you publish the property look.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="ghost" disabled={isBusy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={onSubmit}>
          {primaryLabel}
        </Button>
      </div>
    </DialogFooter>
  )
}
