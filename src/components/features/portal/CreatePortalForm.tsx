// Portal context — create portal form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { useEffect, useRef } from 'react'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import { FormTextarea } from '#/components/forms/FormTextarea'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import type { BaseFieldApiTextarea } from '#/components/forms/FormTextarea'
import type { Action } from '#/components/hooks/use-action'
import { ThemePresetSelector } from './ThemePresetSelector'

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
  onPreviewChange?: (preview: {
    name: string
    description: string
    primaryColor: string
  }) => void
}>

export function CreatePortalForm({ propertyId, mutation, onPreviewChange }: Props) {
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

  // Track previous name to detect changes
  const previousNameRef = useRef<string>('')

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

      {/* Track form changes for preview */}
      <form.Subscribe
        selector={(state) => ({
          name: state.values.name,
          description: state.values.description,
          primaryColor: state.values.primaryColor,
        })}
      >
        {(previewState) => {
          useEffect(() => {
            onPreviewChange?.(previewState)
          }, [previewState])
          return null
        }}
      </form.Subscribe>

      <FieldGroup>
        <form.Field name="name">
          {(field: BaseFieldApi) => {
            // Auto-generate slug from name when name changes and slug is empty
            const currentValue = field.state.value
            useEffect(() => {
              if (currentValue && currentValue !== previousNameRef.current) {
                const currentSlug = form.getFieldValue('slug')
                if (!currentSlug) {
                  const generated = currentValue
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')
                  form.setFieldValue('slug', generated)
                }
                previousNameRef.current = currentValue
              }
            }, [currentValue])

            return (
              <FormTextField
                field={field}
                label="Name"
                id="portal-name"
                placeholder="My Portal"
              />
            )
          }}
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
          {(field) => (
            <div className="space-y-2">
              <h3 className="font-semibold">Theme</h3>
              <ThemePresetSelector
                primaryColor={field.state.value}
                onPrimaryColorChange={(color) => field.handleChange(color)}
              />
            </div>
          )}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Create Portal
      </SubmitButton>
    </form>
  )
}
