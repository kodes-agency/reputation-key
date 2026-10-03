// The foot of an image dialog (round-4 admin board 14): a line saying the live
// pages change only when the look is published, Cancel, and the primary button,
// which stays off until the dialog has what it needs.

import { EyeOff } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'

type Props = Readonly<{
  /** Names the button: "Use photo", "Save". */
  primaryLabel: string
  /** Names it while the file is on its way. */
  pendingLabel?: string
  /** The line at the start of the footer. */
  note?: string
  canSubmit: boolean
  isBusy: boolean
  onSubmit: () => void
}>

export function UploadDialogFooter({
  primaryLabel,
  pendingLabel = 'Uploading…',
  note = 'Live pages change when you publish the property look.',
  canSubmit,
  isBusy,
  onSubmit,
}: Props) {
  return (
    <DialogFooter
      note={
        <>
          <EyeOff className="size-4 shrink-0" aria-hidden />
          {note}
        </>
      }
    >
      <DialogCancel />
      <Button
        type="button"
        pending={isBusy}
        pendingLabel={pendingLabel}
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        {primaryLabel}
      </Button>
    </DialogFooter>
  )
}
