// Portal context — create portal form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { useRef } from 'react'
import { z } from 'zod/v4'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import { createPortalInputSchema } from '#/contexts/portal/application/dto/create-portal.dto'
import { PortalNameSlugGroup } from './portal-name-slug-group'

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

type PreviewState = {
  name: string
  description: string
  primaryColor: string
}

type Props = Readonly<{
  propertyId: string
  mutation: Action<CreatePortalVariables>
  onPreviewChange?: (preview: PreviewState) => void
}>

export function CreatePortalForm({ propertyId, mutation, onPreviewChange }: Props) {
  const previousNameRef = useRef<string>('')

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
    <>
      {/*
        Subscribe to form values reactively.
        Replaces the old dep-less useEffect that ran every render.
        Uses TanStack Form's Subscribe component with selector.
      */}
      <form.Subscribe
        selector={(state) => ({
          name: state.values.name,
          description: state.values.description,
          primaryColor: state.values.primaryColor,
        })}
        children={(values) => {
          onPreviewChange?.(values)

          // Auto-generate slug from name when name changes
          if (values.name && values.name !== previousNameRef.current) {
            const currentSlug = form.getFieldValue('slug') as string
            if (!currentSlug) {
              const generated = values.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '')
              form.setFieldValue('slug', generated)
            }
            previousNameRef.current = values.name
          }

          return null
        }}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          form.handleSubmit()
        }}
        className="space-y-4"
      >
        <FormErrorBanner error={mutation.error} />

        <PortalNameSlugGroup form={form} />

        <SubmitButton mutation={mutation} form={form}>
          Create Portal
        </SubmitButton>
      </form>
    </>
  )
}
