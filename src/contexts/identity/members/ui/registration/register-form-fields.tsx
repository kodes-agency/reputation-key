import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { FormWithField } from '#/components/forms/form-with-field'

type FormFieldValues = {
  name: string
  email: string
  password: string
  confirmPassword: string
  organizationName?: string
  invitationId?: string
  mode?: 'register' | 'join'
}

type Props = Readonly<{
  form: FormWithField<FormFieldValues>
  mode: 'register' | 'join'
  /** The invitation's address: prefilled and not editable. */
  emailLocked?: boolean
}>

export function RegisterFormFields({ form, mode, emailLocked = false }: Props) {
  const isJoinMode = mode === 'join'

  return (
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
            readOnly={emailLocked}
            description={
              emailLocked ? 'The invitation was sent to this address.' : undefined
            }
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
  )
}
