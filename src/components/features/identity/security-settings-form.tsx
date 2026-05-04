import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
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
import { authClient } from '#/shared/auth/auth-client'
import { Shield } from 'lucide-react'
import { toast } from 'sonner'

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormValues = z.infer<typeof passwordSchema>

export function SecuritySettingsForm() {
  const [error, setError] = useState<unknown>(null)
  const [isPending, setIsPending] = useState(false)

  const form = useForm({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    } satisfies FormValues,
    validators: { onSubmit: passwordSchema },
    onSubmit: async ({ value }) => {
      setIsPending(true)
      setError(null)
      try {
        await authClient.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        })
        toast.success('Password changed successfully')
        form.reset()
      } catch (err) {
        setError(err)
      } finally {
        setIsPending(false)
      }
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
        <FormErrorBanner error={error} />
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
          <div className="px-6 pb-2">
            <SubmitButton mutation={{ isPending, error }} form={form}>
              Update password
            </SubmitButton>
          </div>
        </Card>
      </form>

      <Card className="opacity-60">
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
