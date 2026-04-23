// Login form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { signInInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { UseMutationResult } from '@tanstack/react-query'

type SignInVariables = { email: string; password: string }

type Props = Readonly<{
  mutation: UseMutationResult<unknown, unknown, SignInVariables, unknown>
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
      await mutation.mutateAsync(value)
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
