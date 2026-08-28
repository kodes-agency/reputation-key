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
      <DialogContent>
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
