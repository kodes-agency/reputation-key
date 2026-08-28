import { useForm } from '@tanstack/react-form'
import { Button } from '#/components/ui/button'
import { DialogFooter } from '#/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { feedbackHandlingDecisionDto } from '#/contexts/inbox/application/dto/inbox.dto'
import {
  PRIVATE_FEEDBACK_HANDLING_OUTCOMES,
  type PrivateFeedbackHandlingOutcome,
} from '#/contexts/inbox/application/public-api'
import { feedbackHandlingOutcomeLabel } from './feedback-handling-presentation'

export type FeedbackHandlingDecision = Readonly<{
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
}>

type Props = Readonly<{
  mode: 'mark' | 'correct'
  initialOutcome?: PrivateFeedbackHandlingOutcome
  initialNote?: string | null
  mutation: Readonly<{ isPending: boolean; error: unknown }>
  onConfirm: (decision: FeedbackHandlingDecision) => Promise<unknown>
  onCancel: () => void
}>

export function FeedbackHandlingForm(props: Props) {
  const form = useForm({
    defaultValues: {
      outcome: props.initialOutcome ?? '',
      internalNote: props.initialNote ?? '',
    },
    validators: { onSubmit: feedbackHandlingDecisionDto },
    onSubmit: async ({ value }) => {
      const parsed = feedbackHandlingDecisionDto.parse(value)
      await props.onConfirm({
        outcome: parsed.outcome,
        internalNote: parsed.internalNote.trim() || null,
      })
    },
  })

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <FormErrorBanner error={props.mutation.error} />
      <form.Field name="outcome">
        {(field) => (
          <Field data-invalid={!field.state.meta.isValid}>
            <FieldLabel htmlFor="feedback-handling-outcome">Outcome</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(value) =>
                field.handleChange(value as PrivateFeedbackHandlingOutcome)
              }
              onOpenChange={(open) => {
                if (!open) field.handleBlur()
              }}
              disabled={props.mutation.isPending}
            >
              <SelectTrigger id="feedback-handling-outcome">
                <SelectValue placeholder="Choose an outcome" />
              </SelectTrigger>
              <SelectContent>
                {PRIVATE_FEEDBACK_HANDLING_OUTCOMES.map((outcome) => (
                  <SelectItem key={outcome} value={outcome}>
                    {feedbackHandlingOutcomeLabel(outcome)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError
              errors={field.state.meta.errors as Array<{ message?: string } | undefined>}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="internalNote">
        {(field) => (
          <Field data-invalid={!field.state.meta.isValid}>
            <FieldLabel htmlFor="feedback-handling-note">
              Internal note{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Textarea
              id="feedback-handling-note"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              maxLength={2_000}
              rows={4}
              placeholder="Add context that will help other managers"
              disabled={props.mutation.isPending}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Only managers with access to this property can see this note. It is never
              shown to the guest.
            </p>
            <FieldError
              errors={field.state.meta.errors as Array<{ message?: string } | undefined>}
            />
          </Field>
        )}
      </form.Field>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={props.onCancel}
          disabled={props.mutation.isPending}
        >
          Cancel
        </Button>
        <SubmitButton mutation={props.mutation} form={form}>
          {props.mode === 'mark' ? 'Mark as handled' : 'Save correction'}
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
