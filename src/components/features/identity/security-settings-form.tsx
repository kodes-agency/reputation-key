import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { Shield } from 'lucide-react'
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
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="space-y-6"
      >
        <FormErrorBanner error={changePassword.error} />
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Update your password to keep your account secure.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
          <div className="px-6 pb-2 flex gap-2">
            <Button type="button" variant="outline" asChild>
              <Link to="/settings/profile">Cancel</Link>
            </Button>
            <SubmitButton mutation={changePassword} form={form}>
              Update password
            </SubmitButton>
          </div>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-muted-foreground" />
            <CardTitle>Two-factor authentication</CardTitle>
          </div>
          <CardDescription>
            Add an extra layer of security to your account with TOTP-based two-factor
            authentication. Coming soon.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
