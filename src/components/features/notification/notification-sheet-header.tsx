// The phone sheet's header while its lazy body is not there (D8).
//
// The body renders the sheet's title and Close itself, beside "Mark all
// read". Until its chunk arrives — the first open on a phone, where a tap
// gives the preload no head start — or when it cannot be loaded at all, the
// sheet would otherwise be a nameless full-screen dialog with no way out but
// a reload. Only ever rendered inside the sheet: a Dialog title needs its
// Dialog.

import { X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { SheetTitle } from '#/components/ui/sheet'

export function NotificationSheetHeader({ onClose }: Readonly<{ onClose: () => void }>) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
      <SheetTitle className="text-sm font-semibold">Notifications</SheetTitle>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        aria-label="Close notifications"
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  )
}
