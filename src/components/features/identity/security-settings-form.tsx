import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { changePasswordSchema } from '#/contexts/identity/application/dto/change-password.dto'
import type { ChangePasswordInput } from '#/contexts/identity/application/dto/change-password.dto'
import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  changePassword: Action<{ data: { currentPassword: string; newPassword: string } }>
}>

export function SecuritySettingsForm({ changePassword }: Props) {
  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    } satisfies ChangePasswordInput,
    validators: { onSubmit: changePasswordSchema },
    onSubmit: async ({ value }) => {
      await changePassword({
        data: {
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        },
      })
      form.reset()
    },
  })

  return (
    <div className="space-y-6">
      <form method="post" onSubmit={submitHandler(form)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Update your password to keep your account secure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FieldGroup>
              <form.Field name="currentPassword">
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="Current password"
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                  />
                )}
              </form.Field>
              <form.Field name="newPassword">
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="New password"
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </form.Field>
              <form.Field name="confirmPassword">
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="Confirm new password"
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </form.Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <FormActions form={form} error={changePassword.error}>
              <SubmitButton mutation={changePassword} form={form}>
                Update password
              </SubmitButton>
            </FormActions>
          </CardFooter>
        </Card>
      </form>
    </div>
  )
}
