import { useForm } from '@tanstack/react-form'
import type { z } from 'zod/v4'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
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
import { suggestionBetaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
import {
  type BetaFeedbackFormProps,
  currentBetaFeedbackContext,
} from './beta-feedback-form-context'

type SuggestionFormValues = z.input<typeof suggestionBetaFeedbackInputSchema>

export function SuggestionFeedbackForm({
  submitFeedback,
  onSubmitted,
}: BetaFeedbackFormProps) {
  const submit = useAction(submitFeedback)
  const defaultValues: SuggestionFormValues = {
    type: 'suggestion',
    title: '',
    desiredOutcome: '',
    currentFriction: '',
    importance: 'helpful',
    routePath: '/',
    viewport: 'regular',
  }
  const form = useForm({
    defaultValues,
    validators: { onSubmit: suggestionBetaFeedbackInputSchema },
    onSubmit: async ({ value }) => {
      const data = suggestionBetaFeedbackInputSchema.parse({
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
              id="beta-suggestion-title"
              label="Short title"
              placeholder="What could work better?"
              autoComplete="off"
              maxLength={120}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="desiredOutcome">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-suggestion-outcome"
              label="What would you like to be able to do?"
              placeholder="Describe the result that would make your work easier."
              rows={4}
              maxLength={1_500}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="currentFriction">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-suggestion-friction"
              label="What is getting in the way? (optional)"
              placeholder="Tell us about the current workaround or extra steps."
              rows={3}
              maxLength={1_500}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
        <form.Field name="importance">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="beta-suggestion-importance">
                How useful would this be?
              </FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) =>
                  field.handleChange(value as 'important' | 'helpful' | 'nice_to_have')
                }
                disabled={submit.isPending}
              >
                <SelectTrigger id="beta-suggestion-importance" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="important">Important to my work</SelectItem>
                  <SelectItem value="helpful">It would be helpful</SelectItem>
                  <SelectItem value="nice_to_have">Nice to have</SelectItem>
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
          Send suggestion
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
