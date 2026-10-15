// The frame the Google rating goal wizard sits in: a dialog on a desktop and a
// full-screen sheet on a phone (ADR 0067, decision 10), one component and one
// set of steps. Both are the same Radix dialog underneath, so the app's `Dialog`
// root holds either: a request in flight keeps it from being dismissed (`busy`),
// and its title and description name it for a screen reader. At the end of a
// Google import it sits inside the setup frame instead (`inline`): the same
// steps on the page, no overlay and nothing to dismiss, and each step's way out
// reads "Not now". The `Dialog` root is still there, not modal and with no
// content of its own, so the steps' titles and buttons work as they do in it.
//
// The step's title takes the focus when the step changes (`titleRef`, tabIndex
// -1), so a keyboard or screen-reader user hears where they are now instead of
// being left on a button that is gone. The frame opens on the step's checked
// choice (Pick a plan's preselected plan) when it has one, not on the first
// button above it; a step with no choice opens as Radix opens it.
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
import { RatingGoalInlineCancelLabel } from './rating-goal-wizard-cancel'

type Props = Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A save is running: Escape, the overlay and the close are refused. */
  busy: boolean
  title: string
  /** "Step 1 of 2", or what the screen is for. */
  description: string
  titleRef?: Ref<HTMLHeadingElement>
  /** Where the focus goes on closing: there is no trigger for Radix to return it to. */
  onCloseAutoFocus?: (event: Event) => void
  /** Inside the Google import's setup frame, on the page; its way out is "Not now". */
  inline?: boolean
  /** The step's body, then its `DialogFooter`, last. */
  children: ReactNode
}>

/** Opening: the focus goes to the checked choice, when the step has one. */
function focusCheckedChoice(event: Event): void {
  const content = event.currentTarget
  if (!(content instanceof HTMLElement)) return
  const checked = content.querySelector<HTMLElement>(
    '[role="radio"][data-state="checked"]',
  )
  if (checked === null) return
  event.preventDefault()
  checked.focus()
}

export function RatingGoalWizardFrame({
  open,
  onOpenChange,
  busy,
  title,
  description,
  titleRef,
  onCloseAutoFocus,
  inline = false,
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
  if (inline) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} busy={busy} modal={false}>
        <RatingGoalInlineCancelLabel value="Not now">
          <section
            aria-label="Google rating goal"
            data-wizard-frame="inline"
            className="flex flex-col gap-4 rounded-xl border bg-background p-(--dialog-pad) [--dialog-pad:1.5rem]"
          >
            <p className="text-sm font-medium text-muted-foreground">
              Google rating goal
            </p>
            {header}
            {children}
          </section>
        </RatingGoalInlineCancelLabel>
      </Dialog>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={busy}>
      {phone ? (
        // Full screen: the sheet is the height of the window, scrolls inside, and
        // keeps the dialog's padding variable so the footer pins the same way.
        <SheetContent
          side="bottom"
          data-wizard-frame="sheet"
          onOpenAutoFocus={focusCheckedChoice}
          onCloseAutoFocus={onCloseAutoFocus}
          className="h-dvh gap-4 overflow-y-auto p-(--dialog-pad) [--dialog-pad:1rem]"
        >
          {header}
          {children}
        </SheetContent>
      ) : (
        <DialogContent
          size="lg"
          data-wizard-frame="dialog"
          onOpenAutoFocus={focusCheckedChoice}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {header}
          {children}
        </DialogContent>
      )}
    </Dialog>
  )
}
