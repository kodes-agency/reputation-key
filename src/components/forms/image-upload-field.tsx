// Reusable image upload field component — handles drag-and-drop, validation, progress tracking.
// Delegates actual upload logic to parent via onUpload callback (component does NOT call server functions).
// Supports two shape variants: rect (hero images) and circle (avatars/logos).
// Per conventions: shared form building blocks live in components/forms/.

import { useRef, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { ImagePreview } from '#/components/forms/image-upload-field/image-preview'
import { DropZone } from '#/components/forms/image-upload-field/drop-zone'
import { RemoveButton } from '#/components/forms/image-upload-field/remove-button'
import { useFileUpload } from '#/components/forms/image-upload-field/use-file-upload'
import { useDragDrop } from '#/components/forms/image-upload-field/use-drag-drop'

type ImageUploadFieldProps = Readonly<{
  imageUrl: string | null
  onImageUrlChange: (url: string | null) => void
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  disabled?: boolean
  variant?: 'rect' | 'circle'
  acceptedTypes?: string[]
  maxFileSize?: number
  emptyLabel?: string
}>

export function ImageUploadField({
  imageUrl,
  onImageUrlChange,
  onUpload,
  disabled = false,
  variant = 'rect',
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  maxFileSize = 10 * 1024 * 1024,
  emptyLabel = 'Upload image',
}: ImageUploadFieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploading, uploadProgress, handleFileSelect } = useFileUpload({
    acceptedTypes,
    maxFileSize,
    onUpload,
    onImageUrlChange,
  })
  const { dragOver, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    disabled,
    uploading,
    onDropFile: handleFileSelect,
  })

  const handleClick = useCallback(() => {
    if (!disabled && !uploading) {
      fileInputRef.current?.click()
    }
  }, [disabled, uploading])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        void handleFileSelect(file)
      }
      e.target.value = ''
    },
    [handleFileSelect],
  )

  const handleRemove = useCallback(() => {
    onImageUrlChange(null)
  }, [onImageUrlChange])

  return (
    <div className="flex flex-col gap-2">
      {variant === 'circle' && imageUrl ? (
        <div
          className="relative size-24 mx-auto cursor-pointer group"
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <ImagePreview imageUrl={imageUrl} />
          {uploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-black/50">
              <Loader2 className="mb-1 size-6 animate-spin text-white" />
              <p className="text-xs text-white">{uploadProgress}%</p>
            </div>
          )}
          {!disabled && !uploading && (
            <>
              <RemoveButton onClick={handleRemove} aria-label="Remove image" />
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 transition-colors hover:bg-black/30">
                <span className="rounded bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                  Replace
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <DropZone
          imageUrl={imageUrl}
          variant={variant}
          uploading={uploading}
          uploadProgress={uploadProgress}
          dragOver={dragOver}
          disabled={disabled}
          acceptedTypes={acceptedTypes}
          maxFileSize={maxFileSize}
          emptyLabel={emptyLabel}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
          onRemove={handleRemove}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        className="sr-only"
        onChange={handleFileInputChange}
        disabled={disabled || uploading}
      />
    </div>
  )
}
