// The frame the Google rating goal wizard sits in: a dialog on a desktop and a
// full-screen sheet on a phone (ADR 0067, decision 10), one component and one
// set of steps. Both are the same Radix dialog underneath, so the app's `Dialog`
// root holds either: a request in flight keeps it from being dismissed (`busy`),
// and its title and description name it for a screen reader.
//
// The step's title takes the focus when the step changes (`titleRef`, tabIndex
// -1), so a keyboard or screen-reader user hears where they are now instead of
// being left on a button that is gone.
import type { ReactNode, Ref } from 'react'
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
  /** A save is running: Escape, the overlay and the close are refused. */
  busy: boolean
  title: string
  /** "Step 1 of 2", or what the screen is for. */
  description: string
  titleRef?: Ref<HTMLHeadingElement>
  /** The step's body, then its `DialogFooter`, last. */
  children: ReactNode
}>

export function RatingGoalWizardFrame({
  open,
  onOpenChange,
  busy,
  title,
  description,
  titleRef,
  children,
}: Props) {
  const phone = useIsMobile()
  const header = (
    <DialogHeader>
      <DialogTitle
        ref={titleRef}
        tabIndex={-1}
        className={phone ? 'pe-12 outline-none' : 'outline-none'}
      >
        {title}
      </DialogTitle>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {phone ? (
        // Full screen: the sheet is the height of the window, scrolls inside, and
        // keeps the dialog's padding variable so the footer pins the same way.
        <SheetContent
          side="bottom"
          data-wizard-frame="sheet"
          className="h-dvh gap-4 overflow-y-auto p-(--dialog-pad) [--dialog-pad:1rem]"
        >
          {header}
          {children}
        </SheetContent>
      ) : (
        <DialogContent size="lg" data-wizard-frame="dialog">
          {header}
          {children}
        </DialogContent>
      )}
    </Dialog>
  )
}
