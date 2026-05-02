// Edit team form — inline form for editing team name, description, and team lead
// Per architecture: receives mutation as a prop, uses DTO schema for validation.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { FormTextarea } from '#/components/forms/FormTextarea'
import type { BaseFieldApiTextarea } from '#/components/forms/FormTextarea'
import { TeamLeadSelect } from '#/components/features/team/TeamLeadSelect'
import { Button } from '#/components/ui/button'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import type { UpdateTeamInput } from '#/contexts/team/application/dto/update-team.dto'
import { updateTeamInputSchema } from '#/contexts/team/application/dto/update-team.dto'

type MemberOption = { userId: string; name: string; email: string }

const formSchema = updateTeamInputSchema.required().extend({
  description: z.string().max(500),
  teamLeadId: z.string(),
})

import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  teamId: string
  initialName: string
  initialDescription: string | null
  initialTeamLeadId: string | null
  members?: ReadonlyArray<MemberOption>
  mutation: Action<{ data: UpdateTeamInput }>
  onCancel: () => void
}>

export function EditTeamForm({
  teamId,
  initialName,
  initialDescription,
  initialTeamLeadId,
  members,
  mutation,
  onCancel,
}: Props) {
  const form = useForm({
    defaultValues: {
      teamId,
      name: initialName,
      description: initialDescription ?? '',
      teamLeadId: initialTeamLeadId ?? '',
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation({
        data: {
          teamId: value.teamId,
          name: value.name,
          description: value.description || null,
          teamLeadId: value.teamLeadId || null,
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

        {members && members.length > 0 && (
          <form.Field name="teamLeadId">
            {(field: BaseFieldApi) => (
              <TeamLeadSelect field={field} members={members} label="Team lead" />
            )}
          </form.Field>
        )}
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
