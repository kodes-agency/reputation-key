// Registration form component — supports two modes:
// - 'register' (default): creates user + organization (used by /register)
// - 'join': creates user only, no organization (used by /join for invited members)
//
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// The confirmPassword field is form-only (not in the server DTO).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import {
  registerUserInputSchema,
  registerMemberInputSchema,
} from '#/contexts/identity/application/dto/invitation.dto'
import { RegisterFormFields } from './register-form-fields'
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

import type { AnyAction } from '#/components/hooks/use-action'

type Props = Readonly<{
  mode: 'register' | 'join'
  mutation: AnyAction
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
        await mutation({ data: rest as JoinVariables })
      } else {
        await mutation({ data: rest as RegisterVariables })
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

      <RegisterFormFields form={form} mode={mode} />

      <SubmitButton mutation={mutation} form={form} className="w-full">
        {isJoinMode ? 'Create account' : 'Create account & organization'}
      </SubmitButton>
    </form>
  )
}
