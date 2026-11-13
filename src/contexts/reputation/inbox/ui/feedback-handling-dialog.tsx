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
    <Dialog
      open={props.open}
      busy={props.mutation.isPending}
      onOpenChange={props.onOpenChange}
    >
      {/* No mobile class on this dialog: controls are 36 px (WCAG 2.5.8 AA asks
          for 24; 44 is what inflated the phone pane), which is what both
          primitives already draw: `ui/select.tsx`'s `data-[size=default]:h-9`
          and `ui/button.tsx`'s default `h-9`. The outcome OPTIONS are menu
          items and keep their 44 px on the item itself
          (`feedback-handling-form.tsx`), because a Radix portal puts them
          outside this element, where no selector here could reach them.

          `showCloseButton={false}`: the form's own full-width `Cancel` is the
          exit (a dialog whose footer has Cancel may drop the corner close), and
          it keeps the pane's count of controls named exactly `Close` at zero —
          the number `inbox-triage.spec.ts:85` and `:222` assert. Escape and the overlay still dismiss. */}
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
          onConfirm={async (decision) => {
            await props.onConfirm(decision)
            props.onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
