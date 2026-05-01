// Portal context — create portal form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { Field, FieldLabel, FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import { FormTextarea } from '#/components/forms/FormTextarea'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import type { BaseFieldApiTextarea } from '#/components/forms/FormTextarea'
import type { Action } from '#/components/hooks/use-action'
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerEyeDropper,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from '#/components/ui/color-picker'

const createFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z.string().max(64, 'Slug must be at most 64 characters'),
  description: z.string().max(500, 'Description must be at most 500 characters'),
  primaryColor: z.string().min(1, 'Color is required'),
})

type FormValues = z.infer<typeof createFormSchema>

type CreatePortalVariables = {
  data: {
    name: string
    slug?: string
    description?: string
    propertyId: string
  }
}

type Props = Readonly<{
  propertyId: string
  mutation: Action<CreatePortalVariables>
}>

export function CreatePortalForm({ propertyId, mutation }: Props) {
  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      primaryColor: '#6366f1',
    } satisfies FormValues,
    validators: {
      onSubmit: createFormSchema,
    },
    onSubmit: async ({ value }) => {
      const data = {
        name: value.name,
        slug: value.slug || undefined,
        description: value.description || undefined,
        propertyId,
        theme: { primaryColor: value.primaryColor },
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
              id="portal-name"
              placeholder="My Portal"
            />
          )}
        </form.Field>

        <form.Field name="slug">
          {(field: BaseFieldApi) => (
            <FormTextField
              field={field}
              label="Slug (optional)"
              id="portal-slug"
              placeholder="auto-generated from name"
            />
          )}
        </form.Field>

        <form.Field name="description">
          {(field: BaseFieldApiTextarea) => (
            <FormTextarea
              field={field}
              label="Description (optional)"
              id="portal-description"
              placeholder="A short description of this portal"
              rows={3}
            />
          )}
        </form.Field>

        <form.Field name="primaryColor">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor="portal-primary-color">Primary Color</FieldLabel>
                <ColorPicker
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                  name="primaryColor"
                >
                  <div className="flex items-center gap-2">
                    <ColorPickerTrigger>
                      <ColorPickerSwatch />
                    </ColorPickerTrigger>
                    <ColorPickerContent>
                      <ColorPickerArea />
                      <ColorPickerHueSlider />
                      <div className="flex items-center gap-2">
                        <ColorPickerInput withoutAlpha />
                        <ColorPickerFormatSelect />
                        <ColorPickerEyeDropper />
                      </div>
                    </ColorPickerContent>
                  </div>
                </ColorPicker>
              </Field>
            )
          }}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Create Portal
      </SubmitButton>
    </form>
  )
}
