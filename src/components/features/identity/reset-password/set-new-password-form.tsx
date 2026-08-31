import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { Action } from '#/components/hooks/use-action'
import {
  setNewPasswordFormSchema,
  type SetNewPasswordFormInput,
} from '#/contexts/identity/application/dto/password-reset.dto'

type Props = Readonly<{
  mutation: Action<SetNewPasswordFormInput>
}>

export function SetNewPasswordForm({ mutation }: Props) {
  const form = useForm({
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    } satisfies SetNewPasswordFormInput,
    validators: { onSubmit: setNewPasswordFormSchema },
    onSubmit: async ({ value }: { value: SetNewPasswordFormInput }) => {
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
