// Portal context — create portal form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { useEffect, useRef, useState } from 'react'
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
import { createPortalInputSchema } from '#/contexts/portal/application/dto/create-portal.dto'

const createFormSchema = createPortalInputSchema
  .pick({ name: true, slug: true, description: true })
  .required()
  .extend({
    slug: z.string().max(64, 'Slug must be at most 64 characters'),
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

  // Sync preview state at component level (no hooks inside render props)
  const [prevName, setPrevName] = useState('')
  const [prevDesc, setPrevDesc] = useState('')
  const [prevColor, setPrevColor] = useState('')

  useEffect(() => {
    const name = form.getFieldValue('name') as string
    const description = form.getFieldValue('description') as string
    const primaryColor = form.getFieldValue('primaryColor') as string

    if (name !== prevName || description !== prevDesc || primaryColor !== prevColor) {
      setPrevName(name)
      setPrevDesc(description)
      setPrevColor(primaryColor)
      onPreviewChange?.({ name, description, primaryColor })
    }
  })

  useEffect(() => {
    if (prevName && prevName !== previousNameRef.current) {
      const currentSlug = form.getFieldValue('slug') as string
      if (!currentSlug) {
        const generated = prevName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
        form.setFieldValue('slug', generated)
      }
      previousNameRef.current = prevName
    }
  }, [prevName, form])

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
