// Create team form — used in property teams page
// Per architecture: receives mutation as a prop, uses DTO schema for validation.

import { useForm } from '@tanstack/react-form'
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
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { createTeamInputSchema } from '#/contexts/team/application/dto/create-team.dto'
import type { UseMutationResult } from '@tanstack/react-query'
import type { CreateTeamInput } from '#/contexts/team/application/dto/create-team.dto'

type MemberOption = { userId: string; name: string; email: string }

// Derive form schema from DTO — omit fields the server sets or that aren't needed in the form
const formSchema = createTeamInputSchema
  .pick({ propertyId: true, name: true, description: true, teamLeadId: true })
  .required()

type Props = Readonly<{
  propertyId: string
  mutation: UseMutationResult<unknown, unknown, { data: CreateTeamInput }>
  members?: ReadonlyArray<MemberOption>
}>

export function CreateTeamForm({ propertyId, mutation, members }: Props) {
  const form = useForm({
    defaultValues: {
      propertyId,
      name: '',
      description: '' as string | undefined,
      teamLeadId: '' as string | undefined,
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        data: {
          ...value,
          description: value.description || undefined,
          teamLeadId: value.teamLeadId || undefined,
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
      className="space-y-4"
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
                  placeholder="Front Desk"
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
                  onChange={(e) => field.handleChange(e.target.value || undefined)}
                  aria-invalid={isInvalid}
                  placeholder="Describe this team's responsibilities"
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
                  <FieldLabel>Team lead (optional)</FieldLabel>
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

      <SubmitButton mutation={mutation} form={form}>
        Create team
      </SubmitButton>
    </form>
  )
}
