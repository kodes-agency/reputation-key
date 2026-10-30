import { useForm } from '@tanstack/react-form'
import type { ReactNode } from 'react'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { Button } from '#/components/ui/button'
import { changeCauseFormDto } from '#/contexts/ai/application/dto/review-mention-correction.dto'
import { effectiveCause } from './review-cause-view'
import { causeFormLabels } from './review-correction-view'
import type { InboxMentionV3 } from '#/contexts/inbox/application/public-api'

/** The cause as a manager typed it: a box left blank says nothing. */
export type TypedCause = Readonly<{ thing: string | null; issue: string }>

/**
 * Change what a review is about: the thing it named and what was wrong with it, in the
 * manager's own words, one to three each. The server folds and checks them (the same rule
 * the AI's answer is held to), so a phrase it will not keep comes back as a sentence in the
 * banner above the buttons, and the boxes keep what was typed. The boxes open on the cause
 * as it stands.
 */
export function ReviewCauseForm({
  mention,
  mutation,
  onSubmit,
  onCancel,
}: Readonly<{
  mention: InboxMentionV3
  mutation: Readonly<{ isPending: boolean; error: unknown }>
  /** Sends the cause; a failure rejects, and the banner reports it with any refusal. */
  onSubmit: (cause: TypedCause) => Promise<unknown>
  onCancel: () => void
}>): ReactNode {
  const current = effectiveCause(mention)
  const labels = causeFormLabels(mention)
  const id = `review-cause-${mention.mentionOrdinal}`
  const form = useForm({
    defaultValues: { thing: current.thing ?? '', issue: current.issue ?? '' },
    validators: { onSubmit: changeCauseFormDto },
    onSubmit: async ({ value }) => {
      const parsed = changeCauseFormDto.parse(value)
      await onSubmit({ thing: parsed.thing.trim() || null, issue: parsed.issue })
    },
  })

  return (
    <form
      className="grid gap-3"
      onSubmit={submitHandler(form)}
      aria-label="Change the cause"
    >
      <form.Field name="thing">
        {(field) => (
          <FormTextField
            field={field}
            id={`${id}-about`}
            label={labels.about}
            optional
            maxLength={80}
            placeholder="air conditioning"
            disabled={mutation.isPending}
          />
        )}
      </form.Field>
      <form.Field name="issue">
        {(field) => (
          <FormTextField
            field={field}
            id={`${id}-said`}
            label={labels.said}
            maxLength={80}
            placeholder="not working"
            disabled={mutation.isPending}
            description="One to three English words in each box, letters a to z and hyphens. No names or numbers."
          />
        )}
      </form.Field>
      <DialogErrorBanner error={mutation.error} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton mutation={mutation} form={form} size="sm">
          Save cause
        </SubmitButton>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
