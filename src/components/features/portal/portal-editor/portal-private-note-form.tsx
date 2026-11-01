// The private rating switch and the threshold for offering an optional note.
// Both save through the editor's autosave.

import { useState } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { useForm } from '@tanstack/react-form'
import type { z } from 'zod/v4'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
import type { Action } from '#/components/hooks/use-action'
import { SettingSwitchRow } from '#/components/forms/setting-switch-row'
import { RatingThresholdField } from '#/components/forms/rating-threshold-field'
import { usePortalFormAutosave } from './use-portal-form-autosave'
import type { PortalData, UpdatePortalVariables } from '../shared/types'

const privateNoteFormSchema = updatePortalInputSchema
  .pick({ privateFeedbackThreshold: true, skipPrivateRating: true })
  .required()
type FormValues = z.infer<typeof privateNoteFormSchema>

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  disabled?: boolean
}>

export function PortalPrivateNoteForm({ portal, mutation, disabled = false }: Props) {
  const [error, setError] = useState<unknown>(null)
  const defaults = {
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    skipPrivateRating: portal.skipPrivateRating,
  } satisfies FormValues
  const autosave = usePortalFormAutosave('private-note', defaults)

  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: privateNoteFormSchema },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        await mutation({
          data: {
            portalId: portal.id,
            privateFeedbackThreshold: value.privateFeedbackThreshold,
            skipPrivateRating: value.skipPrivateRating,
          },
        })
      } catch (failure) {
        setError(failure)
        throw failure
      }
    },
  })

  return (
    <form
      data-reload-safe
      className="flex flex-col gap-6"
      onSubmit={(event) => event.preventDefault()}
    >
      <form.Field name="skipPrivateRating">
        {(field) => (
          <SettingSwitchRow
            id="edit-skip-private-rating"
            label="Skip the private rating"
            description="Guests go straight to the Google button. They can't leave a private rating or note on this portal."
            checked={field.state.value}
            onCheckedChange={field.handleChange}
            commit="deferred"
            unsaved={field.state.value !== portal.skipPrivateRating}
            disabled={disabled}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.skipPrivateRating}>
        {(skip) =>
          skip ? null : (
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
          )
        }
      </form.Subscribe>
      <FormErrorBanner error={error} />
    </form>
  )
}
