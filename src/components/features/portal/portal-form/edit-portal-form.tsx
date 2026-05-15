// Portal context — edit portal settings form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { useState } from 'react'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { putFilePresigned } from '#/components/forms/image-upload-field/put-file-presigned'
import { HeroImageSection } from './hero-image-section'
import { BasicInfoSection } from './basic-info-section'
import type { Action } from '#/components/hooks/use-action'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'

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

      <HeroImageSection
        heroImageUrl={heroImageUrl}
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
      />

      <BasicInfoSection form={form} disabled={!can('portal.update')} />
    </form>
  )
}
