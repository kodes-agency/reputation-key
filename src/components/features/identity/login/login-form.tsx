// Login form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { signInInputSchema } from '#/contexts/identity/application/dto/invitation.dto'

type SignInVariables = { email: string; password: string }

import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  mutation: Action<{ data: SignInVariables }>
}>

export function LoginForm({ mutation }: Props) {
  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    } satisfies SignInVariables,
    validators: {
      onSubmit: signInInputSchema,
    },
    onSubmit: async ({ value }: { value: SignInVariables }) => {
      await mutation({ data: value })
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
              id="login-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Password"
              id="login-password"
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form} className="w-full">
        Sign in
      </SubmitButton>
    </form>
  )
}
