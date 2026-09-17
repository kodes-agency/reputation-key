import { useMemo, useState } from 'react'
import { useForm, useStore } from '@tanstack/react-form'
import { Bug, Lightbulb } from 'lucide-react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { useAction } from '#/components/hooks/use-action'
import { Button } from '#/components/ui/button'
import { DialogClose, DialogFooter } from '#/components/ui/dialog'
import { Kbd } from '#/components/ui/kbd'
import { betaFeedbackInputSchema } from '#/shared/beta-feedback-contract'
import type {
  BetaFeedbackImpact,
  BetaFeedbackType,
} from '#/shared/beta-feedback-contract'
import { latestRecordedError } from '#/shared/observability/recorded-browser-errors'
import { BetaFeedbackChoiceGroup, type BetaFeedbackChoice } from './beta-feedback-choice'
import { BetaFeedbackErrorNotice } from './beta-feedback-error-notice'
import {
  type BetaFeedbackFormProps,
  currentBetaFeedbackContext,
} from './beta-feedback-form-context'
import {
  betaFeedbackFormSchema,
  emptyBetaFeedbackForm,
  impactForType,
  impactOptionsFor,
  toBetaFeedbackInput,
} from './beta-feedback-form-model'

const TYPE_OPTIONS: ReadonlyArray<BetaFeedbackChoice<BetaFeedbackType>> = [
  {
    value: 'bug',
    label: 'Something is broken',
    hint: 'An error, a wrong result, or a step that will not complete',
    icon: <Bug className="size-4" />,
  },
  {
    value: 'suggestion',
    label: 'I have an idea',
    hint: 'A change that would make your work easier',
    icon: <Lightbulb className="size-4" />,
  },
]

export function BetaFeedbackForm({ submitFeedback, onSubmitted }: BetaFeedbackFormProps) {
  const submit = useAction(submitFeedback)
  // Read once on mount: the list must not shift while the reporter is typing.
  const [recordedError] = useState(() => latestRecordedError())

  const form = useForm({
    defaultValues: emptyBetaFeedbackForm,
    validators: { onSubmit: betaFeedbackFormSchema },
    onSubmit: async ({ value }) => {
      const values = betaFeedbackFormSchema.parse(value)
      const data = betaFeedbackInputSchema.parse(
        toBetaFeedbackInput(
          values,
          currentBetaFeedbackContext(),
          recordedError?.eventId ?? null,
        ),
      )
      const receipt = await submit({ data })
      onSubmitted(receipt.reference)
    },
  })

  const kind = useStore(form.store, (state) => state.values.kind) as BetaFeedbackType
  const isBug = kind === 'bug'
  const impactOptions = useMemo(() => impactOptionsFor(kind), [kind])

  const onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void form.handleSubmit()
    }
  }

  return (
    <form onSubmit={submitHandler(form)} onKeyDown={onKeyDown} className="space-y-5">
      <FormErrorBanner error={submit.error} />

      <form.Field name="kind">
        {(field) => (
          <BetaFeedbackChoiceGroup
            legend="What would you like to tell us?"
            name="beta-feedback-kind"
            layout="cards"
            value={field.state.value as BetaFeedbackType}
            options={TYPE_OPTIONS}
            disabled={submit.isPending}
            onChange={(next) => {
              field.handleChange(next)
              // Impact scales differ per type; keep the form in a valid state.
              form.setFieldValue(
                'impact',
                impactForType(next, form.getFieldValue('impact') as BetaFeedbackImpact),
              )
            }}
          />
        )}
      </form.Field>

      {isBug && recordedError && (
        <form.Field name="includeRecordedError">
          {(field) => (
            <BetaFeedbackErrorNotice
              eventId={recordedError.eventId}
              checked={field.state.value === true}
              onCheckedChange={field.handleChange}
              disabled={submit.isPending}
            />
          )}
        </form.Field>
      )}

      <div className="space-y-4">
        {isBug && (
          <form.Field name="context">
            {(field: BaseFieldApiTextarea) => (
              <FormTextarea
                field={field}
                id="beta-feedback-context"
                label="What were you doing?"
                placeholder="Opening the Reviews page for a property…"
                rows={2}
                maxLength={2_000}
                disabled={submit.isPending}
              />
            )}
          </form.Field>
        )}

        <form.Field name="observed">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              id="beta-feedback-observed"
              label={isBug ? 'What happened?' : 'What would make your work easier?'}
              placeholder={
                isBug
                  ? 'The page stayed empty and nothing loaded.'
                  : 'Tell us what you would change, and what it would let you do.'
              }
              rows={isBug ? 3 : 5}
              maxLength={2_000}
              disabled={submit.isPending}
            />
          )}
        </form.Field>

        {isBug && (
          <form.Field name="expected">
            {(field: BaseFieldApiTextarea) => (
              <FormTextarea
                field={field}
                id="beta-feedback-expected"
                label="What did you expect instead?"
                placeholder="The reviews for that property should have appeared."
                rows={2}
                maxLength={2_000}
                disabled={submit.isPending}
              />
            )}
          </form.Field>
        )}
      </div>

      <form.Field name="impact">
        {(field) => (
          <BetaFeedbackChoiceGroup
            legend={isBug ? 'How much did this affect you?' : 'How much would this help?'}
            name="beta-feedback-impact"
            layout="rows"
            value={field.state.value as BetaFeedbackImpact}
            options={impactOptions}
            disabled={submit.isPending}
            onChange={field.handleChange}
          />
        )}
      </form.Field>

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <p className="hidden text-xs text-muted-foreground sm:block">
          <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to send
        </p>
        <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={submit.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <SubmitButton mutation={submit} form={form}>
            Send report
          </SubmitButton>
        </div>
      </DialogFooter>
    </form>
  )
}
