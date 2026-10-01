// Login form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { submitForm } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { signInInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import { isEmailNotVerified } from './email-not-verified'
import { UnverifiedEmailNotice } from './unverified-email-notice'

type SignInVariables = { email: string; password: string }

import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  mutation: Action<{ data: SignInVariables }>
  /** Mails a fresh verification link, for an address sign-in found unverified. */
  resendVerification: (input: { data: { email: string } }) => Promise<unknown>
}>

export function LoginForm({ mutation, resendVerification }: Props) {
  // The attempt that was just made: the field may be edited afterwards, but the
  // notice is about the attempt. Its id keys the notice, so each attempt gets a
  // fresh one: what a resend did for one attempt (link sent, or refused by the
  // rate limit) is never shown for the next, even when the refusal comes back
  // before React has rendered the pending state in between.
  const [attempt, setAttempt] = useState({ id: 0, email: '' })
  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    } satisfies SignInVariables,
    validators: {
      onSubmit: signInInputSchema,
    },
    onSubmit: async ({ value }: { value: SignInVariables }) => {
      setAttempt((previous) => ({ id: previous.id + 1, email: value.email }))
      await mutation({ data: value })
    },
  })

  return (
    <form
      method="post"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void submitForm(form)
      }}
      className="space-y-4"
    >
      {isEmailNotVerified(mutation.error) ? (
        <UnverifiedEmailNotice
          key={attempt.id}
          email={attempt.email}
          resendVerification={resendVerification}
        />
      ) : (
        <FormErrorBanner error={mutation.error} />
      )}

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
