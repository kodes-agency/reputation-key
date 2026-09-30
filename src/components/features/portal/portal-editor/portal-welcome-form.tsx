// The Welcome section's own fields: the portal's name, its address and its
// description. They are part of the portal's draft, so they save as they are
// typed (portal-editor/use-portal-form-autosave.ts). The form still owns its
// schema; autosave only decides when `handleSubmit` runs.

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
import type { Action } from '#/components/hooks/use-action'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { BasicInfoSection } from '../portal-form/basic-info-section'
import { usePortalFormAutosave } from './use-portal-form-autosave'
import type { PortalData, UpdatePortalVariables } from '../shared/types'

const welcomeFormSchema = updatePortalInputSchema
  .pick({ name: true, slug: true, description: true })
  .required()
  .extend({ description: z.string().max(500) })
type FormValues = z.infer<typeof welcomeFormSchema>

/**
 * The slug is written when its field is left, not while it is typed: a
 * half-typed address would otherwise be saved, and a saved slug unlinks every
 * hand-typed URL that spells the old one.
 */
const SLUG_IS_SAVED_ON_BLUR: ReadonlyArray<string> = ['slug']

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  disabled?: boolean
}>

export function PortalWelcomeForm({ portal, mutation, disabled = false }: Props) {
  const { can } = usePermissions()
  const isDisabled = disabled || !can('portal.update')

  const defaults = {
    name: portal.name,
    slug: portal.slug,
    description: portal.description ?? '',
  } satisfies FormValues
  const autosave = usePortalFormAutosave('welcome', defaults, SLUG_IS_SAVED_ON_BLUR)

  const form = useForm({
    defaultValues: defaults,
    listeners: autosave.listeners,
    validators: { onSubmit: welcomeFormSchema },
    onSubmit: async ({ value: typed }) => {
      // The slug is the one last left, not one still being typed.
      const value = autosave.effective(typed)
      await mutation({
        data: {
          portalId: portal.id,
          name: value.name,
          slug: value.slug,
          description: value.description || null,
        },
      })
    },
  })

  return (
    // The write is the coordinator's, so Enter must not also submit natively.
    <form className="flex flex-col gap-6" onSubmit={(event) => event.preventDefault()}>
      <BasicInfoSection form={form} persistedSlug={portal.slug} disabled={isDisabled} />
    </form>
  )
}
