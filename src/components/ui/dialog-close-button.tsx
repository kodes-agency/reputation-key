// The corner close of a dialog or a sheet (UI consistency scan: ACT-15).
//
// It was a bare 16px glyph with no padding at 70% opacity, which no other close
// in the app resembled. It is a ghost icon Button now, so it has the Button's
// touch height and focus ring, and one name, "Close", everywhere it appears.
// A dialog whose footer already has a Cancel may drop it (`showCloseButton`
// false, as the Inbox's two do for the phone pane); a dialog with no footer
// exit keeps it.
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { IconButton } from '#/components/ui/icon-button'
import { cn } from '#/lib/utils'

export function DialogCloseButton({
  className,
  disabled,
}: Readonly<{
  className?: string
  /** A request is in flight, so the dialog cannot be dismissed (see dialog-dismissal.ts). */
  disabled?: boolean
}>) {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton
        data-slot="dialog-close"
        label="Close"
        size="icon-sm"
        tooltip={false}
        disabled={disabled}
        className={cn('absolute top-3 right-3', className)}
      >
        <XIcon />
      </IconButton>
    </DialogPrimitive.Close>
  )
}
