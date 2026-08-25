import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { SubmitButton } from '#/components/forms/submit-button'
import { Field, FieldError, FieldGroup, FieldLabel } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import type { CreateStaffParticipationMutationInput } from '#/components/features/staff/types'

const formSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter the staff member’s name').max(255),
})

type Props = Readonly<{
  propertyId: string
  mutation: Action<{ data: CreateStaffParticipationMutationInput }>
  onSuccess?: (count: number) => void
}>

export function StaffParticipationForm({ propertyId, mutation, onSuccess }: Props) {
  const form = useForm({
    defaultValues: { displayName: '' },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      await mutation({ data: { propertyId, displayName: value.displayName.trim() } })
      toast.success('Staff participant added')
      form.reset()
      onSuccess?.(1)
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
        <form.Field name="displayName">
          {(field) => (
            <Field data-invalid={!field.state.meta.isValid}>
              <FieldLabel htmlFor="staff-display-name">Name</FieldLabel>
              <Input
                id="staff-display-name"
                autoComplete="name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="e.g. Alex Morgan"
                aria-invalid={!field.state.meta.isValid}
              />
              <FieldError
                errors={
                  field.state.meta.errors as Array<{ message?: string } | undefined>
                }
              />
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      <SubmitButton mutation={mutation} form={form}>
        Add staff
      </SubmitButton>
    </form>
  )
}
