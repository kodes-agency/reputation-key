// Property context — edit property form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).
//
// Derives the form schema from the DTO schema via .omit().required().extend().
// This ensures validation rules (lengths, formats) stay in sync with the DTO.
// Pre-populates fields from the loaded property data.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import { TimezoneSelect } from './TimezoneSelect'
import type { UseMutationResult } from '@tanstack/react-query'
import { Button } from '#/components/ui/button'
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'

// Derive form schema from DTO: .omit() removes server-only fields (propertyId),
// .required() removes optional wrappers, .extend() overrides fields that need
// form-specific shape (slug is required for editing, gbpPlaceId as plain string).
const editFormSchema = updatePropertyInputSchema
  .omit({ propertyId: true })
  .required()
  .extend({
    slug: z
      .string()
      .min(1, 'Slug is required')
      .max(64, 'Slug must be at most 64 characters'),
    gbpPlaceId: z.string().max(500, 'GBP Place ID must be at most 500 characters'),
  })

type FormValues = z.infer<typeof editFormSchema>

type UpdatePropertyVariables = {
  data: {
    propertyId: string
    name?: string
    slug?: string
    timezone?: string
    gbpPlaceId?: string | null
  }
}

type PropertyData = Readonly<{
  id: string
  name: string
  slug: string
  timezone: string
  gbpPlaceId: string | null
}>

type Props = Readonly<{
  property: PropertyData
  mutation: UseMutationResult<unknown, unknown, UpdatePropertyVariables, unknown>
  onCancel: () => void
}>

export function EditPropertyForm({ property, mutation, onCancel }: Props) {
  const form = useForm({
    defaultValues: {
      name: property.name,
      slug: property.slug,
      timezone: property.timezone,
      gbpPlaceId: property.gbpPlaceId ?? '',
    } satisfies FormValues,
    validators: {
      onSubmit: editFormSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        data: {
          propertyId: property.id,
          name: value.name,
          slug: value.slug,
          timezone: value.timezone,
          gbpPlaceId: value.gbpPlaceId || null,
        },
      })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="max-w-lg space-y-4"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="name">
          {(field: BaseFieldApi) => (
            <FormTextField field={field} label="Name" id="edit-property-name" />
          )}
        </form.Field>

        <form.Field name="slug">
          {(field: BaseFieldApi) => (
            <FormTextField field={field} label="Slug" id="edit-property-slug" />
          )}
        </form.Field>

        <form.Field name="timezone">
          {(field: BaseFieldApi) => (
            <TimezoneSelect field={field} label="Timezone" id="edit-property-timezone" />
          )}
        </form.Field>

        <form.Field name="gbpPlaceId">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="GBP Place ID (optional)"
              id="edit-property-gbp-place-id"
            />
          )}
        </form.Field>
      </FieldGroup>

      <div className="flex gap-3 pt-2">
        <SubmitButton mutation={mutation} form={form}>
          Save Changes
        </SubmitButton>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
