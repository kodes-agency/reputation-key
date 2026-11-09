// The corner close of a dialog or a sheet: a ghost icon Button with the Button's touch
// height and focus ring, and one name, "Close". A dialog whose footer already has a
// Cancel may drop it (`showCloseButton` false); a dialog with no footer exit keeps it.
//
// A Button, not an IconButton: the beta launcher mounts a Dialog in the first paint,
// and IconButton's tooltip is not in that closure. A close needs no hint.
import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { Button } from '#/components/ui/button'
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
      <Button
        data-slot="dialog-close"
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Close"
        disabled={disabled}
        className={cn('absolute top-3 right-3', className)}
      >
        <XIcon />
      </Button>
    </DialogPrimitive.Close>
  )
}
