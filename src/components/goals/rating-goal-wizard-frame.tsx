// The frame the Google rating goal wizard sits in: a dialog on a desktop and a
// full-screen sheet on a phone (ADR 0067, decision 10), one component and one
// set of steps. The dialog and the sheet are the shared `GoalSheetFrame` (a
// request in flight keeps it from being dismissed, the title and description
// name it for a screen reader, the step's title takes the focus when the step
// changes, and it opens on the step's own first stop: the setup's goal numeral).
// At the end of a Google import it sits inside the setup frame instead
// (`inline`): the same steps on the page, no overlay and nothing to dismiss, and
// each step's way out reads "Not now". The `Dialog` root is still there, not
// modal and with no content of its own, so the steps' titles and buttons work as
// they do in it.
import type { ReactNode, Ref } from 'react'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { Dialog } from '#/components/ui/dialog'
import { GoalSheetFrame, GoalSheetHeader } from './goal-sheet-frame'
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
            <GoalSheetHeader
              title={title}
              description={description}
              titleRef={titleRef}
              phone={phone}
            />
            {children}
          </section>
        </RatingGoalInlineCancelLabel>
      </Dialog>
    )
  }
  return (
    <GoalSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      marker="data-wizard-frame"
      title={title}
      description={description}
      titleRef={titleRef}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {children}
    </GoalSheetFrame>
  )
}
