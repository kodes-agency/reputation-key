// The "New Organization" form (ADR 0063): a name, the slug it will be known by,
// and the first Account Admin's email. The slug follows the name until the
// operator edits it, using the same derivation the server falls back to.
//
// The operator does not become a member of what they create: the first
// Account Admin is invited, and an invitation-bound registration is the only
// way that person gets an account.

import { useRef } from 'react'
import { useForm } from '@tanstack/react-form'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField, type BaseFieldApi } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { submitForm } from '#/components/forms/form-submit'
import type { Action } from '#/components/hooks/use-action'
import {
  provisionOrganizationInputSchema,
  type ProvisionOrganizationInput,
  type ProvisionOrganizationResult,
} from '#/contexts/identity/application/dto/platform-console.dto'
import { suggestedSlug } from './platform-console-model'

// The form always submits a slug (the one on screen); the DTO leaves it optional.
const createFormSchema = provisionOrganizationInputSchema.required({ slug: true })

type Props = Readonly<{
  provision: Action<{ data: ProvisionOrganizationInput }, ProvisionOrganizationResult>
  /**
   * Called with the address being invited just BEFORE the request goes out, so a
   * caller that prints it on the result already holds it when the result arrives.
   */
  onAttempt: (adminEmail: string) => void
}>

export function CreateOrganizationForm({ provision, onAttempt }: Props) {
  // Whether the operator has typed in the slug field; until then it tracks the name.
  const slugEdited = useRef(false)
  const form = useForm({
    defaultValues: { name: '', slug: '', adminEmail: '' },
    validators: { onSubmit: createFormSchema },
    onSubmit: async ({ value }) => {
      onAttempt(value.adminEmail.trim().toLowerCase())
      await provision({ data: value })
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void submitForm(form)
      }}
      className="flex flex-col gap-4"
    >
      <FormErrorBanner error={provision.error} />

      <FieldGroup>
        <form.Field
          name="name"
          listeners={{
            onChange: ({ value }) => {
              if (!slugEdited.current) form.setFieldValue('slug', suggestedSlug(value))
            },
          }}
        >
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Organization name"
              id="create-organization-name"
              placeholder="Hotel Riviera"
              autoComplete="off"
            />
          )}
        </form.Field>

        <form.Field name="slug">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <FormTextField
                field={{
                  name: field.name,
                  state: field.state,
                  handleBlur: field.handleBlur,
                  handleChange: (value) => {
                    slugEdited.current = true
                    field.handleChange(value)
                  },
                }}
                label="Slug"
                id="create-organization-slug"
                placeholder="hotel-riviera"
                autoComplete="off"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers and hyphens. Each slug can be used once.
              </p>
            </div>
          )}
        </form.Field>

        <form.Field name="adminEmail">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="First Account Admin's email"
              id="create-organization-admin-email"
              type="email"
              placeholder="owner@example.com"
              autoComplete="off"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={provision} form={form} className="self-end">
        Create and send invitation
      </SubmitButton>
    </form>
  )
}
