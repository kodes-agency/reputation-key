// The dialog every image upload sits in: controlled, so the button that opens it
// owns its state, and holding no half-made choice once it is closed (its body is
// mounted only while it is open). It cannot be dismissed while a file is on its
// way: Escape, the overlay and the close button would otherwise put the image on
// the page after the person had walked away from it. The body says when it is
// busy and closes the dialog itself once the image is in place.

import { useState, type ReactNode } from 'react'
import { Dialog, DialogContent } from '#/components/ui/dialog'
import { cn } from '#/lib/utils'

export type UploadDialogGuard = Readonly<{
  /** Tells the shell whether a file is on its way, so it stays open meanwhile. */
  onBusyChange: (isBusy: boolean) => void
  onClose: () => void
}>

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The dialog's width, as a `sm:max-w-*` class. */
  className?: string
  children: (guard: UploadDialogGuard) => ReactNode
}>

export function UploadDialogShell({ open, onOpenChange, className, children }: Props) {
  const [isBusy, setIsBusy] = useState(false)
  const close = () => {
    setIsBusy(false)
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else if (!isBusy) close()
      }}
    >
      <DialogContent
        className={cn('max-h-[calc(100dvh-2rem)] overflow-y-auto', className)}
      >
        {children({ onBusyChange: setIsBusy, onClose: close })}
      </DialogContent>
    </Dialog>
  )
}
