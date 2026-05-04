// Rectangular image preview component for ImageUploadField.

import { Loader2 } from 'lucide-react'
import { ImagePreview } from './image-preview'
import { RemoveButton } from './remove-button'

type RectImagePreviewProps = Readonly<{
  imageUrl: string
  uploading: boolean
  uploadProgress: number
  disabled: boolean
  onRemove: () => void
}>

export function RectImagePreview({
  imageUrl,
  uploading,
  uploadProgress,
  disabled,
  onRemove,
}: RectImagePreviewProps) {
  return (
    <>
      <ImagePreview imageUrl={imageUrl} className="h-full w-full" />
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
      {!disabled && !uploading && (
        <>
          <RemoveButton onClick={onRemove} />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/30">
            <span className="rounded bg-black/60 px-3 py-1.5 text-sm text-white opacity-0 transition-opacity group-hover:opacity-100">
              Drop or click to replace
            </span>
          </div>
        </>
      )}
    </>
  )
}
