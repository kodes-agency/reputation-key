// Create team form — lead appointment is a separate membership command.
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import type { CreateTeamMutationInput } from '#/components/features/team/shared/types'

const formSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a team name').max(100),
  description: z.string().max(500),
})

type Props = Readonly<{
  propertyId: string
  mutation: Action<{ data: CreateTeamMutationInput }>
  /** Called after a successful create (e.g. to close the hosting dialog). */
  onSuccess?: () => void
}>

export function CreateTeamForm({ propertyId, mutation, onSuccess }: Props) {
  const form = useForm({
    defaultValues: {
      propertyId,
      name: '',
      description: '',
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          propertyId: value.propertyId,
          name: value.name.trim(),
          description: value.description.trim() || undefined,
        },
      })
      onSuccess?.()
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="name">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Team name"
              id="team-name"
              placeholder="Front Desk"
            />
          )}
        </form.Field>

        <form.Field name="description">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              label="Description (optional)"
              id="team-description"
              placeholder="Describe this team's responsibilities"
              rows={2}
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Create team
      </SubmitButton>
    </form>
  )
}
