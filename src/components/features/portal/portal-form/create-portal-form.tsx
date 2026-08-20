// Portal context — create portal form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm, useStore } from '@tanstack/react-form'
import { useEffect, useRef } from 'react'
import { z } from 'zod/v4'
import { SubmitButton } from '#/components/forms/submit-button'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import type { Action } from '#/components/hooks/use-action'
import { createPortalInputSchema } from '#/contexts/portal/application/dto/create-portal.dto'
import { normalizeSlug, SLUG_PATTERN } from '#/shared/domain/slug'
import { PortalNameSlugGroup } from './portal-name-slug-group'
import type { PortalThemeDraft } from '../shared/types'

// Matches `buildPortal`'s default theme so a portal created without touching
// the preset selector looks the same as one created before theming was exposed.
// Exported so the live preview seeds from the same value the form starts with —
// `onPreviewChange` only fires on a change, so a divergent seed would show a
// colour the form never had.
export const CREATE_PORTAL_DEFAULT_THEME: PortalThemeDraft = {
  primaryColor: '#6366f1',
}

const SLUG_RULE_MESSAGE =
  'Use 2–64 lowercase letters, numbers or hyphens, starting and ending with a letter or number.'

const UNDERIVABLE_SLUG_MESSAGE =
  'This name has no letters or numbers to build a web address from — enter a slug such as “tokyo-suite”.'

// The DTO's `slug` is `.min(2).optional()`; the form field is always a string,
// so the picked schema would reject a blank field the label calls optional.
// Blank is legal here precisely when the name derives a slug, which is decided
// by the SAME `normalizeSlug` + `SLUG_PATTERN` the create-portal use case and
// `validateSlug` run — a client-accepted slug can no longer be rejected on
// submit (the old lookalike regex derived `caf-s-d` for “Café Süd” where the
// server derived `caf-sd`, and derived nothing at all for “東京”).
const createFormSchema = createPortalInputSchema
  .pick({ name: true, description: true, theme: true })
  .required()
  .extend({
    slug: z.string(),
  })
  .superRefine((values, ctx) => {
    const typed = values.slug.trim()
    // A typed slug is validated as-is: the use case does not normalize it.
    const candidate = typed.length > 0 ? typed : normalizeSlug(values.name)
    if (SLUG_PATTERN.test(candidate)) return
    ctx.addIssue({
      code: 'custom',
      path: ['slug'],
      message: typed.length > 0 ? SLUG_RULE_MESSAGE : UNDERIVABLE_SLUG_MESSAGE,
    })
  })

type FormValues = z.infer<typeof createFormSchema>

type CreatePortalVariables = {
  data: {
    name: string
    slug?: string
    description?: string
    propertyId: string
    theme?: PortalThemeDraft
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
    } satisfies FormValues,
    validators: {
      onSubmit: createFormSchema,
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
      }
      await mutation({ data })
    },
  })

  // Mirror the slug from the name until the user edits the slug themselves.
  // This runs in an effect (post-commit), never during render: the original
  // form.Subscribe callback wrote to the store mid-render, which React 19 flags
  // as "Cannot update a component while rendering".
  //
  // It re-derives on EVERY name change, not just the first: the previous
  // `if (form.getFieldValue('slug')) return` guard fired after one keystroke, so
  // typing "Guest Portal" left the slug as "g" — under SLUG_PATTERN's two-char
  // minimum, which the server then rejected. Ownership is detected by comparing
  // the field against what we last wrote; a user-typed slug is never clobbered,
  // and clearing the field hands mirroring back.
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
      {/*
        Renderless subscribe: reads form values and fires the preview side
        effect only when values actually change. Returns null — no DOM output.

        onPreviewChange is deferred to a microtask: calling the parent's setState
        during this render callback is dropped by React under batched keystrokes,
        so the live preview never updated. Scheduling it outside the render phase
        lets the parent re-render reliably.
      */}
      <form.Subscribe
        selector={(state) => ({
          name: state.values.name,
          description: state.values.description,
          theme: state.values.theme,
        })}
        children={(values) => {
          // Only call onPreviewChange when preview values actually changed
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

        <SubmitButton mutation={mutation} form={form}>
          Create Portal
        </SubmitButton>
      </form>
    </>
  )
}
