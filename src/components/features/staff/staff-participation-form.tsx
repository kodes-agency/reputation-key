import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldGroup } from '#/components/ui/field'
import { MemberSelector } from './member-selector'
import type {
  CreateStaffParticipationMutationInput,
  MemberOption,
} from '#/components/features/staff/types'

const formSchema = z.object({
  userIds: z.array(z.string()).min(1, 'Select at least one staff member'),
})

type Props = Readonly<{
  propertyId: string
  mutation: Action<{ data: CreateStaffParticipationMutationInput }>
  members: ReadonlyArray<MemberOption>
  activeUserIds: ReadonlySet<string>
  onSuccess?: (count: number) => void
}>

export function StaffParticipationForm({
  propertyId,
  mutation,
  members,
  activeUserIds,
  onSuccess,
}: Props) {
  const availableMembers = members.filter((member) => !activeUserIds.has(member.userId))
  const form = useForm({
    defaultValues: { userIds: [] as string[] },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      const results = await Promise.allSettled(
        value.userIds.map((userId) => {
          const member = members.find((candidate) => candidate.userId === userId)
          if (!member) return Promise.reject(new Error('Selected member is unavailable.'))
          return mutation({
            data: { propertyId, userId, displayName: member.name },
          })
        }),
      )
      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.length - succeeded
      if (succeeded > 0) {
        toast.success(
          failed > 0
            ? `${succeeded} staff participant${succeeded === 1 ? '' : 's'} added; ${failed} failed`
            : `${succeeded} staff participant${succeeded === 1 ? '' : 's'} added`,
        )
        if (failed === 0) onSuccess?.(succeeded)
      }
    },
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
    >
      <FormErrorBanner error={mutation.error} />
      <FieldGroup>
        <form.Field name="userIds">
          {(field) => <MemberSelector field={field} available={availableMembers} />}
        </form.Field>
      </FieldGroup>
      <SubmitButton mutation={mutation} form={form}>
        Add staff
      </SubmitButton>
    </form>
  )
}
