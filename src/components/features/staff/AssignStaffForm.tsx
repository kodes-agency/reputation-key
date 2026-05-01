// Assign staff form — used in property staff page
// Multi-select: pick multiple members, optionally assign to a team, submit all at once.

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
import { Checkbox } from '#/components/ui/checkbox'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'
import { z } from 'zod/v4'
import { toast } from 'sonner'

// fallow-ignore-next-line unused-type
export type MemberOption = Readonly<{
  userId: string
  name: string
  email: string
}>

// fallow-ignore-next-line unused-type
export type TeamOption = Readonly<{
  id: string
  name: string
}>

const formSchema = z.object({
  userIds: z.array(z.string()).min(1, 'Select at least one staff member'),
  propertyId: z.string(),
  teamId: z.string().nullable(),
})

import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  propertyId: string
  mutation: Action<{ data: CreateStaffAssignmentInput }>
  members: ReadonlyArray<MemberOption>
  teams: ReadonlyArray<TeamOption>
  assignedUserIds: ReadonlySet<string>
  onSuccess?: (count: number) => void
}>

export function AssignStaffForm({
  propertyId,
  mutation,
  members,
  teams,
  assignedUserIds,
  onSuccess,
}: Props) {
  const unassigned = members.filter((m) => !assignedUserIds.has(m.userId))

  const form = useForm({
    defaultValues: {
      userIds: [] as string[],
      propertyId,
      teamId: null as string | null,
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      const results = await Promise.allSettled(
        value.userIds.map((userId) =>
          mutation({
            data: {
              userId,
              propertyId: value.propertyId,
              teamId: value.teamId ?? undefined,
            },
          }),
        ),
      )

      const succeeded = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      if (succeeded > 0) {
        toast.success(
          failed > 0
            ? `${succeeded} staff member${succeeded > 1 ? 's' : ''} assigned (${failed} failed)`
            : `${succeeded} staff member${succeeded > 1 ? 's' : ''} assigned`,
        )
        onSuccess?.(succeeded)
      } else if (failed > 0) {
        toast.error('Failed to assign staff members')
      }
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
        {/* Multi-select member picker */}
        <form.Field name="userIds">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            const selected = new Set(field.state.value)
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel>
                  Staff members{' '}
                  {selected.size > 0 && (
                    <span className="font-normal text-muted-foreground">
                      ({selected.size} selected)
                    </span>
                  )}
                </FieldLabel>
                {unassigned.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    All members are already assigned.
                  </p>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border p-3">
                    {unassigned.map((m) => (
                      <label
                        key={m.userId}
                        className="flex cursor-pointer items-center gap-3 rounded-sm px-1 py-1.5 hover:bg-accent"
                      >
                        <Checkbox
                          checked={selected.has(m.userId)}
                          onCheckedChange={(checked) => {
                            const next = checked
                              ? [...field.state.value, m.userId]
                              : field.state.value.filter((id: string) => id !== m.userId)
                            field.handleChange(next)
                          }}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium leading-none">{m.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.email}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
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
