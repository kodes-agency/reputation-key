import { useForm, useStore } from '@tanstack/react-form'
import { useEffect, useRef } from 'react'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import {
  createPortalFormInputSchema,
  type CreatePortalFormInput,
} from '#/contexts/portal/application/dto/create-portal.dto'
import { normalizeSlug } from '#/shared/domain/slug'
import { PortalNameSlugGroup } from './portal-name-slug-group'
import { PortalFeedbackThresholdField } from './portal-feedback-threshold-field'
import type { PortalThemeDraft } from '../shared/types'

// Shared seed keeps the form and live preview on the domain's default palette.
export const CREATE_PORTAL_DEFAULT_THEME: PortalThemeDraft = {
  primaryColor: '#6366f1',
}
type CreatePortalVariables = {
  data: {
    name: string
    slug?: string
    description?: string
    propertyId: string
    theme?: PortalThemeDraft
    privateFeedbackThreshold?: number
  }
}
type PreviewState = {
  name: string
  description: string
  theme: PortalThemeDraft
}
type Props = Readonly<{
  propertyId: string
  mutation: Action<CreatePortalVariables>
  onPreviewChange?: (preview: PreviewState) => void
}>

export function CreatePortalForm({ propertyId, mutation, onPreviewChange }: Props) {
  const previousPreviewRef = useRef<PreviewState>({
    name: '',
    description: '',
    theme: CREATE_PORTAL_DEFAULT_THEME,
  })

  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      theme: CREATE_PORTAL_DEFAULT_THEME,
      privateFeedbackThreshold: 3,
    } satisfies CreatePortalFormInput,
    validators: {
      onSubmit: createPortalFormInputSchema,
    },
    onSubmit: async ({ value }) => {
      const typedSlug = value.slug.trim()
      const data = {
        name: value.name,
        // Blank field → omit the slug rather than send `''`: the DTO's slug is
        // `.min(2).optional()`, and `createPortal` derives it with the same
        // `normalizeSlug` the validator above already proved yields a valid one.
        slug: typedSlug.length > 0 ? typedSlug : undefined,
        description: value.description || undefined,
        propertyId,
        theme: value.theme,
        privateFeedbackThreshold: value.privateFeedbackThreshold,
      }
      await mutation({ data })
    },
  })

  // Keep deriving until the user owns the slug; clearing it hands derivation back.
  const name = useStore(form.store, (state) => state.values.name)
  const lastDerivedRef = useRef('')
  useEffect(() => {
    const current = form.getFieldValue('slug')
    if (current !== '' && current !== lastDerivedRef.current) return
    const derived = normalizeSlug(name)
    lastDerivedRef.current = derived
    form.setFieldValue('slug', derived)
  }, [form, name])

  const theme = useStore(form.store, (state) => state.values.theme)

  return (
    <>
      {/* Defer preview changes outside render so React keeps batched keystrokes. */}
      <form.Subscribe
        selector={(state) => ({
          name: state.values.name,
          description: state.values.description,
          theme: state.values.theme,
        })}
        children={(values) => {
          const prev = previousPreviewRef.current
          if (
            values.name !== prev.name ||
            values.description !== prev.description ||
            values.theme !== prev.theme
          ) {
            const next = {
              name: values.name,
              description: values.description,
              theme: values.theme,
            }
            previousPreviewRef.current = next
            queueMicrotask(() => onPreviewChange?.(next))
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

        <PortalNameSlugGroup
          form={form}
          theme={theme}
          onThemeChange={(next) => form.setFieldValue('theme', next)}
        />

        <form.Field name="privateFeedbackThreshold">
          {(field) => (
            <PortalFeedbackThresholdField
              field={field}
              id="private-feedback-threshold"
              description="Guests at or below this rating may also send a private note. The Google review option remains available to every rating."
            />
          )}
        </form.Field>

        <SubmitButton mutation={mutation} form={form}>
          Create Portal
        </SubmitButton>
      </form>
    </>
  )
}
