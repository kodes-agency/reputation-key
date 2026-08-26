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

// heroImageUrl remains display/removal form state. New non-null values are
// server-owned derivatives published by the upload worker; this form may send
// only explicit `null` removal.
const editFormSchema = updatePortalInputSchema
  .pick({
    name: true,
    slug: true,
    description: true,
    privateFeedbackThreshold: true,
  })
  .required()
  .extend({
    description: z.string().max(500),
    // Display state can contain the current server-published derivative even
    // though updatePortal accepts only `null` removal.
    heroImageUrl: z.url().nullable(),
  })

type FormValues = z.infer<typeof editFormSchema>

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  theme: PortalThemeDraft
  disabled?: boolean
  formRef?: React.RefObject<FormLike | null>
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; uploadId: string }>
  finalizeUpload: (input: { data: { portalId: string; uploadId: string } }) => Promise<{
    heroImageUrl: string | null
    processing: boolean
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
      privateFeedbackThreshold: portal.privateFeedbackThreshold,
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
        // A non-null image URL is server-owned derivative state. The form may
        // request removal, but it may never submit a replacement URL.
        ...(portal.heroImageUrl !== null && value.heroImageUrl === null
          ? { heroImageUrl: null }
          : {}),
        theme,
        privateFeedbackThreshold: value.privateFeedbackThreshold,
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
          const { uploadUrl, uploadId } = await requestUploadUrl({
            data: { portalId: portal.id, contentType: file.type, fileSize: file.size },
          })
          await putFilePresigned(uploadUrl, file, onProgress)
          const { heroImageUrl: url } = await finalizeUpload({
            data: { portalId: portal.id, uploadId },
          })
          return url
        }}
        disabled={isDisabled}
      />

      <BasicInfoSection form={form} persistedSlug={portal.slug} disabled={isDisabled} />

      <form.Field name="privateFeedbackThreshold">
        {(field) => (
          <label
            className="block space-y-2 text-sm"
            htmlFor="edit-private-feedback-threshold"
          >
            <span className="font-medium">Private feedback threshold</span>
            <select
              id="edit-private-feedback-threshold"
              value={field.state.value}
              disabled={isDisabled}
              onChange={(event) => field.handleChange(Number(event.target.value))}
              className="block w-full rounded-md border bg-background px-3 py-2"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} star{value === 1 ? '' : 's'} or below
                </option>
              ))}
            </select>
            <span className="block text-muted-foreground">
              Controls when optional private feedback appears after the private rating. It
              never changes access to the Google review action.
            </span>
          </label>
        )}
      </form.Field>
    </form>
  )
}
