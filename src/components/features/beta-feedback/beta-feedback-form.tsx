import { useForm } from '@tanstack/react-form'
import type { z } from 'zod/v4'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { useAction } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import { DialogClose, DialogFooter } from '#/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '#/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { betaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
import {
  type BetaFeedbackFormProps,
  currentBetaFeedbackContext,
} from './beta-feedback-form-context'

type FeedbackFormValues = z.input<typeof betaFeedbackInputSchema>

const defaultValues: FeedbackFormValues = {
  kind: 'bug',
  message: '',
  routePath: '/',
  viewport: 'regular',
}

export function BetaFeedbackForm({ submitFeedback, onSubmitted }: BetaFeedbackFormProps) {
  const submit = useAction(submitFeedback)
  const form = useForm({
    defaultValues,
    validators: { onSubmit: betaFeedbackInputSchema },
    onSubmit: async ({ value }) => {
      const data = betaFeedbackInputSchema.parse({
        ...value,
        ...currentBetaFeedbackContext(),
      })
      const receipt = await submit({ data })
      onSubmitted(receipt.reference)
    },
  })

  return (
    <form onSubmit={submitHandler(form)} className="space-y-5">
      <FormErrorBanner error={submit.error} />
      <FieldGroup className="gap-4">
        <form.Field name="kind">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="beta-feedback-kind">Feedback type</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) =>
                  field.handleChange(value as 'bug' | 'suggestion')
                }
                disabled={submit.isPending}
              >
                <SelectTrigger id="beta-feedback-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Report a bug</SelectItem>
                  <SelectItem value="suggestion">Make a suggestion</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
        <form.Field name="message">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-feedback-message"
              label="Your feedback"
              placeholder="Tell us what happened or what would make your work easier."
              rows={6}
              maxLength={6_000}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={submit.isPending}>
            Cancel
          </Button>
        </DialogClose>
        <SubmitButton mutation={submit} form={form}>
          Send feedback
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
