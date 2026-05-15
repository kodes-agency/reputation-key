// Assign staff form — used in property staff page
// Multi-select: pick multiple members, optionally assign to a team, submit all at once.

import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { CreateStaffAssignmentInput } from '#/contexts/staff/application/dto/staff-assignment.dto'
import { createStaffAssignmentInputSchema } from '#/contexts/staff/application/dto/staff-assignment.dto'
import { z } from 'zod/v4'
import { toast } from 'sonner'
import { MemberSelector } from './member-selector'
import { TeamSelector } from './team-selector'
import type { MemberOption, TeamOption } from '#/components/features/team/shared/types'

const formSchema = createStaffAssignmentInputSchema.pick({ propertyId: true }).extend({
  userIds: z.array(z.string()).min(1, 'Select at least one staff member'),
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
        <form.Field name="userIds">
          {(field) => <MemberSelector field={field} unassigned={unassigned} />}
        </form.Field>

        {teams.length > 0 && (
          <form.Field name="teamId">
            {(field) => <TeamSelector field={field} teams={teams} />}
          </form.Field>
        )}
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Assign staff
      </SubmitButton>
    </form>
  )
}
