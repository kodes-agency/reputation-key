import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { Action } from '#/components/hooks/use-action'
import { DialogErrorBanner } from '#/components/forms/dialog-error-banner'
import { submitHandler } from '#/components/forms/form-submit'
import { SubmitButton } from '#/components/forms/submit-button'
import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import { DialogCancel, DialogFooter } from '#/components/ui/dialog'
import type { CreateStaffParticipationMutationInput } from '#/components/features/staff/types'
import { createStaffParticipationInputSchema } from '#/contexts/identity/application/dto/staff-participation.dto'

const formSchema = createStaffParticipationInputSchema.omit({ propertyId: true })

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
    <form className="space-y-4" onSubmit={submitHandler(form)}>
      <FieldGroup>
        <form.Field name="displayName">
          {(field) => (
            <FormTextField
              field={field}
              id="staff-display-name"
              label="Name"
              autoComplete="name"
              placeholder="e.g. Alex Morgan"
            />
          )}
        </form.Field>
      </FieldGroup>
      <DialogErrorBanner error={mutation.error} />
      <DialogFooter>
        <DialogCancel />
        <SubmitButton mutation={mutation} form={form}>
          Add staff
        </SubmitButton>
      </DialogFooter>
    </form>
  )
}
