// Assign staff form — used in property staff page
// Per architecture: receives mutation + members + teams as props, uses DTO schema for validation.
// The route fetches members and teams from server functions and passes them here.

import { useForm } from '@tanstack/react-form'
import { Field, FieldGroup, FieldLabel, FieldError } from '#/components/ui/field'
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
import type { UseMutationResult } from '@tanstack/react-query'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'
import { Skeleton } from '#/components/ui/skeleton'
import { z } from 'zod/v4'

export type MemberOption = Readonly<{
  userId: string
  name: string
  email: string
}>

export type TeamOption = Readonly<{
  id: string
  name: string
}>

const formSchema = z.object({
  userId: z.string().min(1, 'Select a staff member'),
  propertyId: z.string().min(1),
  teamId: z.string().nullable(),
})

type Props = Readonly<{
  propertyId: string
  mutation: UseMutationResult<unknown, unknown, { data: CreateStaffAssignmentInput }>
  members: ReadonlyArray<MemberOption>
  teams: ReadonlyArray<TeamOption>
  isLoadingMembers?: boolean
}>

export function AssignStaffForm({
  propertyId,
  mutation,
  members,
  teams,
  isLoadingMembers,
}: Props) {
  const form = useForm({
    defaultValues: {
      userId: '',
      propertyId,
      teamId: null as string | null,
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        data: {
          userId: value.userId,
          propertyId: value.propertyId,
          teamId: value.teamId ?? undefined,
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
        {/* Member picker */}
        <form.Field name="userId">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel>Staff member</FieldLabel>
                {isLoadingMembers ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : (
                  <Select
                    value={field.state.value || undefined}
                    onValueChange={(value) => field.handleChange(value)}
                  >
                    <SelectTrigger aria-invalid={isInvalid}>
                      <SelectValue placeholder="Select a staff member…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {members.map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.name} — {m.email}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        {/* Team picker (optional) */}
        {teams.length > 0 && (
          <form.Field name="teamId">
            {(field) => (
              <Field>
                <FieldLabel>Assign to team (optional)</FieldLabel>
                <Select
                  value={field.state.value ?? '__none__'}
                  onValueChange={(value) =>
                    field.handleChange(value === '__none__' ? null : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No team" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="__none__">
                        <span className="italic text-muted-foreground">
                          No team (direct to property)
                        </span>
                      </SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        )}
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Assign staff
      </SubmitButton>
    </form>
  )
}
