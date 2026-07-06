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
  const previousPreviewRef = useRef<PreviewState>({
    name: '',
    description: '',
    primaryColor: '#6366f1',
  })

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
        Renderless subscribe: reads form values and fires side effects
        (preview update, slug auto-generation) only when values actually change.
        Returns null — no DOM output.

        onPreviewChange is deferred to a microtask: calling the parent's setState
        during this render callback is dropped by React under batched keystrokes,
        so the live preview never updated. Scheduling it outside the render phase
        lets the parent re-render reliably. The slug setFieldValue is a TanStack
        store write (not a React setState), so it stays synchronous.
      */}
      <form.Subscribe
        selector={(state) => ({
          name: state.values.name,
          description: state.values.description,
          primaryColor: state.values.primaryColor,
          slug: state.values.slug,
        })}
        children={(values) => {
          // Only call onPreviewChange when preview values actually changed
          const prev = previousPreviewRef.current
          if (
            values.name !== prev.name ||
            values.description !== prev.description ||
            values.primaryColor !== prev.primaryColor
          ) {
            const next = {
              name: values.name,
              description: values.description,
              primaryColor: values.primaryColor,
            }
            previousPreviewRef.current = next
            queueMicrotask(() => onPreviewChange?.(next))
          }

          // Auto-generate slug from name when name changes
          if (values.name && values.name !== previousNameRef.current) {
            if (!values.slug) {
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
