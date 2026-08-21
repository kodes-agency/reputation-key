// Portal context — edit portal settings form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm, useStore } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { useEffect } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { putFilePresigned } from '#/components/forms/image-upload-field/put-file-presigned'
import { HeroImageSection } from './hero-image-section'
import { BasicInfoSection } from './basic-info-section'
import type { Action } from '#/components/hooks/use-action'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'
import type {
  FormLike,
  PortalData,
  PortalThemeDraft,
  UpdatePortalVariables,
} from '../shared/types'

// heroImageUrl is a form value rather than local component state (contract C3):
// uploading persisted through `finalizeUpload` but REMOVING persisted nowhere,
// because the key was absent from the submit payload of a `.strict()` schema.
const editFormSchema = updatePortalInputSchema
  .pick({ name: true, slug: true, description: true, heroImageUrl: true })
  .required()
  .extend({ description: z.string().max(500) })

type FormValues = z.infer<typeof editFormSchema>

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  theme: PortalThemeDraft
  disabled?: boolean
  formRef?: React.RefObject<FormLike | null>
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeUpload: (input: { data: { portalId: string; key: string } }) => Promise<{
    heroImageUrl: string
  }>
}>

export function EditPortalForm({
  portal,
  mutation,
  theme,
  disabled = false,
  formRef,
  requestUploadUrl,
  finalizeUpload,
}: Props) {
  const { can } = usePermissions()
  const isDisabled = disabled || !can('portal.update')

  const form = useForm({
    defaultValues: {
      name: portal.name,
      slug: portal.slug,
      description: portal.description ?? '',
      heroImageUrl: portal.heroImageUrl,
    } satisfies FormValues,
    validators: {
      onSubmit: editFormSchema,
    },
    onSubmit: async ({ value }) => {
      const data = {
        portalId: portal.id,
        name: value.name,
        slug: value.slug,
        description: value.description || null,
        heroImageUrl: value.heroImageUrl,
        theme,
      }
      await mutation({ data })
    },
  })

  // The parent drives submission from a Save button rendered outside this form,
  // so it needs a handle. Writing the ref during render is a purity violation
  // React 19 can drop; an effect runs before any click can reach that button.
  useEffect(() => {
    if (!formRef) return
    formRef.current = {
      handleSubmit: () => void form.handleSubmit(),
      // isDefaultValue, not isDirty: value-based, so undoing every edit clears
      // the unsaved-changes warning instead of latching on first keystroke.
      hasUnsavedChanges: () => !form.state.isDefaultValue,
    }
    return () => {
      formRef.current = null
    }
  }, [form, formRef])

  const heroImageUrl = useStore(form.store, (state) => state.values.heroImageUrl)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="flex flex-col gap-6"
    >
      <FormErrorBanner error={mutation.error} />

      <HeroImageSection
        heroImageUrl={heroImageUrl}
        onImageUrlChange={(url) => form.setFieldValue('heroImageUrl', url)}
        onUpload={async (file, onProgress) => {
          const { uploadUrl, key } = await requestUploadUrl({
            data: { portalId: portal.id, contentType: file.type, fileSize: file.size },
          })
          await putFilePresigned(uploadUrl, file, onProgress)
          const { heroImageUrl: url } = await finalizeUpload({
            data: { portalId: portal.id, key },
          })
          return url
        }}
        disabled={isDisabled}
      />

      <BasicInfoSection form={form} persistedSlug={portal.slug} disabled={isDisabled} />
    </form>
  )
}
