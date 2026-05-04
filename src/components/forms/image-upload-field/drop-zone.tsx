// Drop zone component for ImageUploadField.

import { cn } from '#/lib/utils'
import { EmptyState } from './empty-state'
import { RectImagePreview } from './rect-image-preview'

type DropZoneProps = Readonly<{
  imageUrl: string | null
  variant: 'rect' | 'circle'
  uploading: boolean
  uploadProgress: number
  dragOver: boolean
  disabled: boolean
  acceptedTypes: string[]
  maxFileSize: number
  emptyLabel?: string
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onClick: () => void
  onRemove: () => void
}>

export function DropZone({
  imageUrl,
  variant,
  uploading,
  uploadProgress,
  dragOver,
  disabled,
  acceptedTypes,
  maxFileSize,
  emptyLabel,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onRemove,
}: DropZoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      className={cn(
        'relative flex items-center justify-center overflow-hidden border-2 border-dashed transition-colors',
        dragOver ? 'border-primary bg-primary/5' : 'border-border',
        !disabled && !uploading ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
        variant === 'rect' && imageUrl ? 'h-48' : variant === 'rect' ? 'h-32' : 'h-32',
        variant === 'circle' && !imageUrl ? 'rounded-full size-32' : 'rounded-lg',
      )}
    >
      {imageUrl && variant === 'rect' ? (
        <RectImagePreview
          imageUrl={imageUrl}
          uploading={uploading}
          uploadProgress={uploadProgress}
          disabled={disabled}
          onRemove={onRemove}
        />
      ) : (
        <EmptyState
          uploading={uploading}
          uploadProgress={uploadProgress}
          acceptedTypes={acceptedTypes}
          maxFileSize={maxFileSize}
          label={emptyLabel}
        />
      )}

      {dragOver && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
          <p className="font-medium text-primary">Drop image here</p>
        </div>
      )}
    </div>
  )
}
