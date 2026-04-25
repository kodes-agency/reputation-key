// Edit team form — inline form for editing team name, description, and team lead
// Per architecture: receives mutation as a prop, uses DTO schema for validation.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { Field, FieldGroup, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Button } from '#/components/ui/button'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import type { UseMutationResult } from '@tanstack/react-query'
import type { UpdateTeamInput } from '#/contexts/team/application/dto/update-team.dto'

type MemberOption = { userId: string; name: string; email: string }

// Form schema — form uses strings, converts to DTO shape on submit
const formSchema = z.object({
  teamId: z.string().min(1),
  name: z
    .string()
    .min(1, 'Team name is required')
    .max(100, 'Team name must be at most 100 characters'),
  description: z.string().max(500),
  teamLeadId: z.string(),
})

type Props = Readonly<{
  teamId: string
  initialName: string
  initialDescription: string | null
  initialTeamLeadId: string | null
  members?: ReadonlyArray<MemberOption>
  mutation: UseMutationResult<unknown, unknown, { data: UpdateTeamInput }>
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
      await mutation.mutateAsync({
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
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Team name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="description">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Description (optional)</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value ?? ''}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  rows={2}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        {members && members.length > 0 && (
          <form.Field name="teamLeadId">
            {(field) => {
              const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel>Team lead</FieldLabel>
                  <Select
                    value={field.state.value || '__none__'}
                    onValueChange={(value) =>
                      field.handleChange(value === '__none__' ? '' : value)
                    }
                  >
                    <SelectTrigger aria-invalid={isInvalid}>
                      <SelectValue placeholder="No team lead" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="__none__">
                          <span className="italic text-muted-foreground">None</span>
                        </SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.name} — {m.email}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
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
