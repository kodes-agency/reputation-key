// Assign staff form — used in property staff page
// Multi-select: pick multiple members, optionally assign to a team + portals, submit all at once.
// Submits one row per user × portal combination.

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
import { PortalSelector } from './portal-selector'
import type { PortalOption } from './portal-selector'
import type { MemberOption, TeamOption } from '#/components/features/team/shared/types'

const formSchema = createStaffAssignmentInputSchema.pick({ propertyId: true }).extend({
  userIds: z.array(z.string()).min(1, 'Select at least one staff member'),
  teamId: z.string().nullable(),
  portalIds: z.array(z.string()).min(1, 'Select at least one portal'),
})

import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  propertyId: string
  mutation: Action<{ data: CreateStaffAssignmentInput }>
  members: ReadonlyArray<MemberOption>
  teams: ReadonlyArray<TeamOption>
  portals: ReadonlyArray<PortalOption>
  assignedUserIds: ReadonlySet<string>
  onSuccess?: (count: number) => void
}>

export function AssignStaffForm({
  propertyId,
  mutation,
  members,
  teams,
  portals,
  assignedUserIds,
  onSuccess,
}: Props) {
  const unassigned = members.filter((m) => !assignedUserIds.has(m.userId))

  const form = useForm({
    defaultValues: {
      userIds: [] as string[],
      propertyId,
      teamId: null as string | null,
      portalIds: [] as string[],
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      // Submit one row per user × portal combination
      const rows: Array<{ data: CreateStaffAssignmentInput }> = []
      for (const userId of value.userIds) {
        for (const portalId of value.portalIds) {
          rows.push({
            data: {
              userId,
              propertyId: value.propertyId,
              teamId: value.teamId ?? undefined,
              portalId,
            },
          })
        }
      }

      // Sequential submission — shared useAction state can't handle concurrent calls
      let succeeded = 0
      let failed = 0
      for (const row of rows) {
        try {
          await mutation(row)
          succeeded++
        } catch {
          failed++
        }
      }

      if (succeeded > 0) {
        toast.success(
          failed > 0
            ? `${succeeded} assignment${succeeded > 1 ? 's' : ''} created (${failed} failed)`
            : `${succeeded} assignment${succeeded > 1 ? 's' : ''} created`,
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

        {portals.length > 0 ? (
          <form.Field name="portalIds">
            {(field) => <PortalSelector field={field} portals={portals} />}
          </form.Field>
        ) : (
          <p className="text-sm text-muted-foreground">
            No portals configured for this property. Create a portal first.
          </p>
        )}
      </FieldGroup>

      {portals.length > 0 && (
        <SubmitButton mutation={mutation} form={form}>
          Assign staff
        </SubmitButton>
      )}
    </form>
  )
}
