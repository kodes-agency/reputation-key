import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import type { PrivateFeedbackHandlingOutcome } from '#/contexts/inbox/application/public-api'
import {
  FeedbackHandlingForm,
  type FeedbackHandlingDecision,
} from './feedback-handling-form'

export type { FeedbackHandlingDecision } from './feedback-handling-form'

type Props = Readonly<{
  mode: 'mark' | 'correct'
  open: boolean
  onOpenChange: (open: boolean) => void
  initialOutcome?: PrivateFeedbackHandlingOutcome
  initialNote?: string | null
  mutation: Readonly<{ isPending: boolean; error: unknown }>
  onConfirm: (decision: FeedbackHandlingDecision) => Promise<unknown>
}>

export function FeedbackHandlingDialog(props: Props) {
  const title =
    props.mode === 'mark' ? 'Mark feedback as handled' : 'Correct handling outcome'
  const description =
    props.mode === 'mark'
      ? 'Choose the result that best reflects what happened. This closes the current feedback work.'
      : 'This adds a correction to the history. The original completion time and timing result stay unchanged.'

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* No mobile class on this dialog any more. v1's row 15 raised the two
          controls this dialog owns but does not render itself — the outcome
          `SelectTrigger` and the footer's two buttons, both inside
          `feedback-handling-form.tsx`, a private half of this component with
          no `className` surface — from 36 px to 44 below `md`, through two
          descendant selectors on `DialogContent`
          (`max-md:[&_[data-slot=dialog-footer]_button]:h-11` and the compound
          `max-md:[&_[data-slot=select-trigger][data-size=default]]:h-11`, the
          compound because the primitive's `data-[size=default]:h-9` only TIES
          a plain descendant on specificity).

          Row 20 lowers controls to 36 px (WCAG 2.5.8 AA asks for 24; 44 is
          what inflated the phone pane), and 36 is what both primitives already
          draw: `ui/select.tsx`'s `data-[size=default]:h-9` and `ui/button.tsx`'s
          default `h-9`. So the sweep deletes both selectors rather than
          re-spelling them at `h-9`, which would only restate the defaults
          through two arbitrary variants. The outcome OPTIONS are menu
          items and keep their 44 px on the item itself
          (`feedback-handling-form.tsx`), because a Radix portal puts them
          outside this element, where no selector here could reach them.

          Measured in Chromium against Storybook dev
          (`inbox-mobile-390--feedback-open`, dialog and select opened) at 390
          and 320: outcome trigger, Cancel and Mark as handled 44 px tall
          before, 36 after; the five options 44 px, unchanged. From 768 px up
          nothing matched before either, so the desktop dialog is unchanged.

          `showCloseButton={false}` follows the mobile sheet
          (`inbox-detail-sheet.tsx:95`): the primitive's corner X measures
          16x16, v1 found no room to grow it to 44 beside the title on a
          288 px-wide dialog, and the form's own full-width `Cancel` is the
          properly sized exit. It also keeps the pane's count of controls
          named exactly `Close` at zero — the number `inbox-triage.spec.ts:85`
          and `:222` assert. Escape and the overlay still dismiss. */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <FeedbackHandlingForm
          mode={props.mode}
          initialOutcome={props.initialOutcome}
          initialNote={props.initialNote}
          mutation={props.mutation}
          onCancel={() => props.onOpenChange(false)}
          onConfirm={async (decision) => {
            await props.onConfirm(decision)
            props.onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
