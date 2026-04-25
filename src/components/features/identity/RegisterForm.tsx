// Registration form component — supports two modes:
// - 'register' (default): creates user + organization (used by /register)
// - 'join': creates user only, no organization (used by /join for invited members)
//
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// The confirmPassword field is form-only (not in the server DTO).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import {
  registerUserInputSchema,
  registerMemberInputSchema,
} from '#/contexts/identity/application/dto/invitation.dto'
// MutateAsync uses `unknown` so specific mutation types are compatible via structural typing.

// ── Schemas ──────────────────────────────────────────────────────────

const registerFormSchema = registerUserInputSchema
  .extend({ confirmPassword: z.string().min(1, 'Please confirm your password') })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

const joinFormSchema = registerMemberInputSchema
  .extend({ confirmPassword: z.string().min(1, 'Please confirm your password') })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type RegisterFormValues = z.infer<typeof registerFormSchema>
type JoinFormValues = z.infer<typeof joinFormSchema>

// ── Types ────────────────────────────────────────────────────────────

type RegisterVariables = z.infer<typeof registerUserInputSchema>
type JoinVariables = z.infer<typeof registerMemberInputSchema>

type MutationLike = {
  isPending: boolean
  isError: boolean
  error: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutateAsync: (variables: any) => Promise<any>
}

type Props = Readonly<{
  mode: 'register' | 'join'
  mutation: MutationLike
}>

// ── Component ────────────────────────────────────────────────────────

export function RegisterForm({ mode, mutation }: Props) {
  const isJoinMode = mode === 'join'

  const form = useForm({
    defaultValues: isJoinMode
      ? ({
          name: '',
          email: '',
          password: '',
          confirmPassword: '',
        } satisfies JoinFormValues)
      : ({
          name: '',
          email: '',
          password: '',
          confirmPassword: '',
          organizationName: '',
        } satisfies RegisterFormValues),
    validators: {
      onSubmit: isJoinMode ? joinFormSchema : registerFormSchema,
    },
    onSubmit: async ({ value }: { value: RegisterFormValues | JoinFormValues }) => {
      const { confirmPassword: _, ...rest } = value
      if (isJoinMode) {
        await mutation.mutateAsync(rest as JoinVariables)
      } else {
        await mutation.mutateAsync(rest as RegisterVariables)
      }
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
              id={`${mode}-name`}
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
              id={`${mode}-email`}
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
          )}
        </form.Field>

        {!isJoinMode && (
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
        )}

        <form.Field name="password">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Password"
              id={`${mode}-password`}
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
              id={`${mode}-confirm-password`}
              type="password"
              placeholder="Repeat your password"
              autoComplete="new-password"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form} className="w-full">
        {isJoinMode ? 'Create account' : 'Create account & organization'}
      </SubmitButton>
    </form>
  )
}
