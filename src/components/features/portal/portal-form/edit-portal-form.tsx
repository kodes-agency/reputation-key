// Portal context — edit portal settings form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { useState } from 'react'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import { FormTextarea } from '#/components/forms/form-textarea'
import { ImageUploadField } from '#/components/forms/image-upload-field'
import { putFilePresigned } from '#/components/forms/image-upload-field/put-file-presigned'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import type { BaseFieldApiTextarea } from '#/components/forms/form-textarea'
import type { Action } from '#/components/hooks/use-action'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const editFormSchema = updatePortalInputSchema
  .pick({ name: true, slug: true, description: true })
  .required()
  .extend({ description: z.string().max(500) })

type FormValues = z.infer<typeof editFormSchema>

type UpdatePortalVariables = {
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    theme?: { primaryColor: string }
    smartRoutingEnabled?: boolean
    smartRoutingThreshold?: number
  }
}

type PortalData = Readonly<{
  id: string
  name: string
  slug: string
  description: string | null
  theme: { primaryColor: string }
  smartRoutingEnabled: boolean
  smartRoutingThreshold: number
  heroImageUrl: string | null
}>

type Props = Readonly<{
  portal: PortalData
  mutation: Action<UpdatePortalVariables>
  formRef?: React.RefObject<{
    handleSubmit: () => void
  } | null>
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
  formRef,
  requestUploadUrl,
  finalizeUpload,
}: Props) {
  const { can } = usePermissions()
  const [heroImageUrl, setHeroImageUrl] = useState(portal.heroImageUrl)

  const form = useForm({
    defaultValues: {
      name: portal.name,
      slug: portal.slug,
      description: portal.description ?? '',
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
        theme: portal.theme,
        smartRoutingEnabled: portal.smartRoutingEnabled,
        smartRoutingThreshold: portal.smartRoutingThreshold,
      }
      await mutation({ data })
    },
  })

  if (formRef) formRef.current = form

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

      {/* Hero image */}
      <div className="flex flex-col gap-4">
        <h3 className="font-semibold">Hero Image</h3>
        <ImageUploadField
          imageUrl={heroImageUrl}
          onImageUrlChange={setHeroImageUrl}
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
          disabled={!can('portal.update')}
          variant="rect"
          acceptedTypes={ACCEPTED_TYPES}
          maxFileSize={MAX_FILE_SIZE}
          emptyLabel="Upload hero image"
        />
      </div>

      {/* Basic info */}
      <div className="flex flex-col gap-4">
        <h3 className="font-semibold">Basic Info</h3>
        <FieldGroup>
          <form.Field name="name">
            {(field: BaseFieldApi) => (
              <FormTextField
                field={field}
                label="Name"
                id="edit-portal-name"
                disabled={!can('portal.update')}
              />
            )}
          </form.Field>

          <form.Field name="description">
            {(field: BaseFieldApiTextarea) => (
              <FormTextarea
                field={field}
                label="Description"
                id="edit-portal-description"
                rows={3}
                disabled={!can('portal.update')}
              />
            )}
          </form.Field>
        </FieldGroup>
      </div>
    </form>
  )
}
