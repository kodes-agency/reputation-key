import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { Action } from '#/components/hooks/use-action'

const setNewPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type SetNewPasswordValues = z.infer<typeof setNewPasswordSchema>

type Props = Readonly<{
  mutation: Action<SetNewPasswordValues>
}>

export function SetNewPasswordForm({ mutation }: Props) {
  const form = useForm({
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    } satisfies SetNewPasswordValues,
    validators: { onSubmit: setNewPasswordSchema },
    onSubmit: async ({ value }: { value: SetNewPasswordValues }) => {
      await mutation(value)
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="newPassword">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="New password"
              id="new-password"
              type="password"
              placeholder="Enter your new password"
              autoComplete="new-password"
            />
          )}
        </form.Field>

        <form.Field name="confirmPassword">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Confirm password"
              id="confirm-new-password"
              type="password"
              placeholder="Confirm your new password"
              autoComplete="new-password"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form} className="w-full">
        Save new password
      </SubmitButton>
    </form>
  )
}
