// The frame of the Monthly portal goal's sheet, whether it sets the goal or
// changes it (PLAN PG-10, PG-14): a dialog on a desktop and a full-screen sheet
// on a phone, built on the dialog primitives and nothing of the Google rating
// goal's, with the focus in the number box when it opens. While a command is
// on its way it cannot be dismissed (`busy`).
import type { ReactNode } from 'react'
import { useIsMobile } from '#/components/hooks/use-mobile'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { SheetContent } from '#/components/ui/sheet'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A command is on its way. */
  busy: boolean
  title: string
  description: string
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
  /** The form, given whether it is drawn on a phone (the smaller figures). */
  children: (phone: boolean) => ReactNode
}>

/** Opening: the focus goes to the number box. */
function focusTheNumber(event: Event): void {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const box = content.querySelector<HTMLElement>('[data-autofocus]')
  if (box === null) return
  event.preventDefault()
  box.focus()
}

export function PortalGoalSheetFrame({
  open,
  onOpenChange,
  busy,
  title,
  description,
  onCloseAutoFocus,
  children,
}: Props) {
  const phone = useIsMobile()
  const header = (
    <DialogHeader>
      <DialogTitle className={phone ? 'pe-12' : undefined}>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {phone ? (
        // Full screen: the sheet is the window's height, scrolls inside, and
        // keeps the dialog's padding variable so the footer pins the same way.
        <SheetContent
          side="bottom"
          data-portal-goal-sheet="sheet"
          onOpenAutoFocus={focusTheNumber}
          onCloseAutoFocus={onCloseAutoFocus}
          className="h-dvh gap-4 overflow-y-auto p-(--dialog-pad) [--dialog-pad:1rem]"
        >
          {header}
          {children(true)}
        </SheetContent>
      ) : (
        <DialogContent
          size="md"
          data-portal-goal-sheet="dialog"
          onOpenAutoFocus={focusTheNumber}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {header}
          {children(false)}
        </DialogContent>
      )}
    </Dialog>
  )
}
