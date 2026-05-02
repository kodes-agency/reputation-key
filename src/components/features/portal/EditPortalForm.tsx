// Portal context — edit portal settings form component.
// Per conventions: receives mutation as prop, uses TanStack Form + Zod schema from DTO.
// Never imports server functions directly (dependency rules).

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'
import { FieldGroup } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { FormTextField } from '#/components/forms/FormTextField'
import { FormTextarea } from '#/components/forms/FormTextarea'
import type { BaseFieldApi } from '#/components/forms/FormTextField'
import type { BaseFieldApiTextarea } from '#/components/forms/FormTextarea'
import type { Action } from '#/components/hooks/use-action'

// Minimal form type for ref that avoids TanStack Form's complex generic signature
type FormLike = {
  handleSubmit: () => void
}
import { Button } from '#/components/ui/button'
import { Upload, ImageIcon, X, Loader2 } from 'lucide-react'
import { useState, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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
  formRef?: React.RefObject<FormLike | null>
  requestUploadUrl: Action<{
    data: { portalId: string; contentType: string; fileSize: number }
  }>
  finalizeUpload: Action<{ data: { portalId: string; key: string } }>
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
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error('Please select a valid image file (JPG, PNG, or WebP)')
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error('File size must be less than 10 MB')
        return
      }

      setUploading(true)
      setUploadProgress(0)
      try {
        const { uploadUrl, key } = await requestUploadUrl({
          data: {
            portalId: portal.id,
            contentType: file.type,
            fileSize: file.size,
          },
        })

        // Use XMLHttpRequest for upload progress tracking
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', uploadUrl)
          xhr.setRequestHeader('Content-Type', file.type)

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100))
            }
          })

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve()
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`))
            }
          })

          xhr.addEventListener('error', () => reject(new Error('Upload failed')))
          xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
          xhr.send(file)
        })

        const { heroImageUrl: url } = await finalizeUpload({
          data: { portalId: portal.id, key },
        })

        setHeroImageUrl(url)
        toast.success('Image uploaded successfully')
      } catch (err: unknown) {
        const message =
          (err instanceof Error ? err.message : '') ||
          (typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : '') ||
          'Upload failed. Please try again.'
        toast.error(message)
      } finally {
        setUploading(false)
        setUploadProgress(0)
      }
    },
    [portal.id],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (can('portal.update') && !uploading) {
        setDragOver(true)
      }
    },
    [can, uploading],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)

      if (!can('portal.update') || uploading) return

      const file = e.dataTransfer.files[0]
      if (file) {
        void handleImageUpload(file)
      }
    },
    [can, uploading, handleImageUpload],
  )

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
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() =>
            can('portal.update') && !uploading && fileInputRef.current?.click()
          }
          className={[
            'relative flex items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border',
            can('portal.update') && !uploading ? 'cursor-pointer' : '',
            heroImageUrl ? 'h-48' : 'h-32',
          ].join(' ')}
        >
          {heroImageUrl ? (
            <>
              <img
                src={heroImageUrl}
                alt="Portal hero"
                className="h-full w-full object-cover"
              />
              {uploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50">
                  <Loader2 className="mb-2 size-6 animate-spin text-white" />
                  <div className="h-2 w-48 overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full rounded-full bg-white transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-white">{uploadProgress}%</p>
                </div>
              )}
              {can('portal.update') && !uploading && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setHeroImageUrl(null)
                  }}
                  className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white transition-colors hover:bg-black/80"
                >
                  <X className="size-4" />
                </button>
              )}
              {can('portal.update') && !uploading && !dragOver && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/30">
                  <span className="rounded bg-black/60 px-3 py-1.5 text-sm text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Drop or click to replace
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 p-4 text-muted-foreground">
              {uploading ? (
                <>
                  <Loader2 className="size-8 animate-spin" />
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs">{uploadProgress}%</p>
                </>
              ) : (
                <>
                  <ImageIcon className="size-8" />
                  <p className="text-sm">
                    <span className="font-medium text-primary">Click to upload</span> or
                    drag and drop
                  </p>
                  <p className="text-xs">JPG, PNG, WebP up to 10 MB</p>
                </>
              )}
            </div>
          )}

          {dragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
              <p className="font-medium text-primary">Drop image here</p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImageUpload(file)
            e.target.value = ''
          }}
          disabled={uploading}
        />

        {can('portal.update') && !heroImageUrl && (
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="self-start"
          >
            <Upload className="mr-2 size-4" />
            {uploading ? 'Uploading...' : 'Upload Image'}
          </Button>
        )}
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
