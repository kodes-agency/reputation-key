// The Private note section's one field: how low a rating has to be before the
// guest is offered the optional private note. It saves as it is changed.

import { useForm } from '@tanstack/react-form'
import type { z } from 'zod/v4'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
import type { Action } from '#/components/hooks/use-action'
import { RatingThresholdField } from '#/components/forms/rating-threshold-field'
import { usePortalFormAutosave } from './use-portal-form-autosave'
import type { PortalData, UpdatePortalVariables } from '../shared/types'

const privateNoteFormSchema = updatePortalInputSchema
  .pick({ privateFeedbackThreshold: true })
  .required()
type FormValues = z.infer<typeof privateNoteFormSchema>

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  disabled?: boolean
}>

export function PortalPrivateNoteForm({ portal, mutation, disabled = false }: Props) {
  const defaults = {
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
  } satisfies FormValues
  const autosave = usePortalFormAutosave('private-note', defaults)

  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: privateNoteFormSchema },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          portalId: portal.id,
          privateFeedbackThreshold: value.privateFeedbackThreshold,
        },
      })
    },
  })

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => event.preventDefault()}>
      <form.Field name="privateFeedbackThreshold">
        {(field) => (
          <RatingThresholdField
            id="edit-private-feedback-threshold"
            label="Offer a private note at"
            value={field.state.value}
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
            invalid={!field.state.meta.isValid}
            errors={field.state.meta.errors}
            disabled={disabled}
            description="Guests who rate this low are offered a private note to the team. Every guest is still offered a Google review."
          />
        )}
      </form.Field>
    </form>
  )
}
