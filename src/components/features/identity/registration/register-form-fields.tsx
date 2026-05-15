import { FieldGroup } from '#/components/ui/field'
import { FormTextField } from '#/components/forms/form-text-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'

type FormFieldValues = {
  name: string
  email: string
  password: string
  confirmPassword: string
  organizationName?: string
}

type FormWithField = {
  Field: React.FC<{
    name: keyof FormFieldValues
    children: (field: BaseFieldApi) => React.ReactNode
  }>
}

type Props = Readonly<{
  form: FormWithField
  mode: 'register' | 'join'
}>

export function RegisterFormFields({ form, mode }: Props) {
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
