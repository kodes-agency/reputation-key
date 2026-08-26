import { useForm } from '@tanstack/react-form'
import type { z } from 'zod/v4'
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
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { useAction } from '#/components/hooks/use-action'
import { bugBetaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
import {
  type BetaFeedbackFormProps,
  currentBetaFeedbackContext,
} from './beta-feedback-form-context'

type BugFormValues = z.input<typeof bugBetaFeedbackInputSchema>

export function BugFeedbackForm({ submitFeedback, onSubmitted }: BetaFeedbackFormProps) {
  const submit = useAction(submitFeedback)
  const defaultValues: BugFormValues = {
    type: 'bug',
    title: '',
    expected: '',
    actual: '',
    steps: '',
    impact: 'workaround_available',
    routePath: '/',
    viewport: 'regular',
  }
  const form = useForm({
    defaultValues,
    validators: { onSubmit: bugBetaFeedbackInputSchema },
    onSubmit: async ({ value }) => {
      const data = bugBetaFeedbackInputSchema.parse({
        ...value,
        ...currentBetaFeedbackContext(),
      })
      const receipt = await submit({ data })
      onSubmitted(receipt.reference)
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="space-y-5"
    >
      <FormErrorBanner error={submit.error} />
      <FieldGroup className="gap-4">
        <form.Field name="title">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              id="beta-bug-title"
              label="Short title"
              placeholder="What went wrong?"
              autoComplete="off"
              maxLength={120}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="expected">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-bug-expected"
              label="What did you expect?"
              placeholder="Describe the result you were trying to get."
              rows={3}
              maxLength={1_500}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="actual">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-bug-actual"
              label="What happened instead?"
              placeholder="Describe what you saw."
              rows={3}
              maxLength={1_500}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="steps">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-bug-steps"
              label="Steps to repeat it (optional)"
              placeholder="For example: open Reviews, choose a property, then…"
              rows={3}
              maxLength={1_500}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="impact">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="beta-bug-impact">How did this affect you?</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) =>
                  field.handleChange(
                    value as 'cannot_complete' | 'workaround_available' | 'small_issue',
                  )
                }
                disabled={submit.isPending}
              >
                <SelectTrigger id="beta-bug-impact" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cannot_complete">
                    I couldn&apos;t complete the task
                  </SelectItem>
                  <SelectItem value="workaround_available">
                    I found a workaround
                  </SelectItem>
                  <SelectItem value="small_issue">It was a small issue</SelectItem>
                </SelectContent>
              </Select>
            </Field>
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
          Send bug report
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
