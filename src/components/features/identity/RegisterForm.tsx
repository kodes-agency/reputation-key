// Register form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// The confirmPassword field is form-only (not in the server DTO).
// We use a form-specific schema that extends the DTO schema with password confirmation.
// Post-submit navigation is handled by the route via the mutation's onSuccess callback,
// not inside this component.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { registerUserInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { UseMutationResult } from '@tanstack/react-query'

type RegisterVariables = z.infer<typeof registerUserInputSchema>

// Form-specific schema: extends the DTO with password confirmation.
// Per conventions: "if it's shaped differently, the DTO is wrong" — but confirmPassword
// is a client-only concern, so a local extension is the right pattern.
const registerFormSchema = registerUserInputSchema
  .extend({
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type RegisterFormValues = z.infer<typeof registerFormSchema>

type Props = Readonly<{
  mutation: UseMutationResult<unknown, unknown, RegisterVariables, unknown>
}>

export function RegisterForm({ mutation }: Props) {
  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      organizationName: '',
    } satisfies RegisterFormValues,
    validators: {
      onSubmit: registerFormSchema,
    },
    onSubmit: async ({ value }: { value: RegisterFormValues }) => {
      // Strip confirmPassword before sending to server
      const { confirmPassword: _, ...serverInput } = value
      await mutation.mutateAsync(serverInput satisfies RegisterVariables)
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
        <form.Field name="name">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Full name"
              id="register-name"
              placeholder="John Doe"
              autoComplete="name"
            />
          )}
        </form.Field>

        <form.Field name="email">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Email"
              id="register-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
          )}
        </form.Field>

        <form.Field name="organizationName">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Organization name"
              id="organization-name"
              placeholder="My Business"
              autoComplete="organization"
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Password"
              id="register-password"
              type="password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          )}
        </form.Field>

        <form.Field name="confirmPassword">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Confirm password"
              id="confirm-password"
              type="password"
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form} className="w-full">
        Create account
      </SubmitButton>
    </form>
  )
}
