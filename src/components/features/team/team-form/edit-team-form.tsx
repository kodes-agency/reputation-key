// Edit team details. Lead changes use setTeamLead/clearTeamLead commands.
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import { Button } from '#/components/ui/button'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import type { UpdateTeamMutationInput } from '#/components/features/team/shared/types'

const formSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1, 'Enter a team name').max(100),
  description: z.string().max(500),
})

type Props = Readonly<{
  teamId: string
  initialName: string
  initialDescription: string | null
  mutation: Action<{ data: UpdateTeamMutationInput }>
  onCancel: () => void
}>

export function EditTeamForm({
  teamId,
  initialName,
  initialDescription,
  mutation,
  onCancel,
}: Props) {
  const form = useForm({
    defaultValues: {
      teamId,
      name: initialName,
      description: initialDescription ?? '',
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          teamId: value.teamId,
          name: value.name.trim(),
          description: value.description.trim() || null,
        },
      })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-3"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="name">
          {(field: BaseFieldApi) => (
            <FormTextField field={field} label="Team name" id="edit-team-name" />
          )}
        </form.Field>

        <form.Field name="description">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              label="Description (optional)"
              id="edit-team-description"
              rows={2}
            />
          )}
        </form.Field>
      </FieldGroup>

      <div className="flex gap-2">
        <SubmitButton mutation={mutation} form={form}>
          Save
        </SubmitButton>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
