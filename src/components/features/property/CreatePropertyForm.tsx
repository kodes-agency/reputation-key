// Property context — create property form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).
//
// Derives the form schema from the DTO schema via .required().extend().
// This ensures validation rules (lengths, formats) stay in sync with the DTO.
// Empty optional fields are stripped to undefined before submission.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { TimezoneCombobox } from './TimezoneCombobox'
import { createPropertyInputSchema } from '#/contexts/property/application/dto/create-property.dto'

// Derive form schema from DTO: .required() removes optional wrappers,
// .extend() overrides fields that need form-specific shape (all-string, UX messages).
// Validation rules for name and timezone are inherited directly from the DTO.
const createFormSchema = createPropertyInputSchema.required().extend({
  slug: z.string().max(64, 'Slug must be at most 64 characters'),
  gbpPlaceId: z.string().max(500, 'GBP Place ID must be at most 500 characters'),
})

type FormValues = z.infer<typeof createFormSchema>

type CreatePropertyVariables = {
  data: {
    name: string
    slug?: string
    timezone: string
    gbpPlaceId?: string
  }
}

import type { Action } from '#/components/hooks/use-action'

type Props = Readonly<{
  mutation: Action<CreatePropertyVariables>
}>

export function CreatePropertyForm({ mutation }: Props) {
  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
      timezone: 'UTC',
      gbpPlaceId: '',
    } satisfies FormValues,
    validators: {
      onSubmit: createFormSchema,
    },
    onSubmit: async ({ value }) => {
      // Strip empty optional fields so the server gets clean input
      const data = {
        name: value.name,
        slug: value.slug || undefined,
        timezone: value.timezone,
        gbpPlaceId: value.gbpPlaceId || undefined,
      }
      await mutation({ data })
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
              label="Name"
              id="property-name"
              placeholder="Grand Hotel"
            />
          )}
        </form.Field>

        <form.Field name="slug">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Slug (optional)"
              id="property-slug"
              placeholder="grand-hotel"
            />
          )}
        </form.Field>

        <form.Field name="timezone">
          {(field: BaseFieldApi) => (
            <TimezoneCombobox field={field} label="Timezone" id="property-timezone" />
          )}
        </form.Field>

        <form.Field name="gbpPlaceId">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="GBP Place ID (optional)"
              id="property-gbp-place-id"
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
            />
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Create Property
      </SubmitButton>
    </form>
  )
}
