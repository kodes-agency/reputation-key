// Reset password form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod validation.
// This form calls authClient.requestPasswordReset directly (client-side SDK) —
// no server function involved. The mutation wraps the client SDK call.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'

const resetPasswordSchema = z.object({
  email: z.email('A valid email address is required'),
})

type FormValues = z.infer<typeof resetPasswordSchema>

import type { AnyAction } from '#/components/hooks/use-action'

type Props = Readonly<{
  mutation: AnyAction
}>

export function ResetPasswordForm({ mutation }: Props) {
  const form = useForm({
    defaultValues: {
      email: '',
    } satisfies FormValues,
    validators: {
      onSubmit: resetPasswordSchema,
    },
    onSubmit: async ({ value }: { value: FormValues }) => {
      await mutation(value)
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
        <form.Field name="email">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Email"
              id="reset-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form} className="w-full">
        Send reset link
      </SubmitButton>
    </form>
  )
}
