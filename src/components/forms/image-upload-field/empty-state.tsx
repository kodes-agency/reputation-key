// Empty state component for ImageUploadField.

import { ImageIcon, Loader2 } from 'lucide-react'

type EmptyStateProps = Readonly<{
  uploading: boolean
  uploadProgress: number
  acceptedTypes: string[]
  maxFileSize: number
  label?: string
}>

export function EmptyState({
  uploading,
  uploadProgress,
  acceptedTypes,
  maxFileSize,
  label = 'Upload image',
}: EmptyStateProps) {
  return (
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
            <span className="font-medium text-primary">Click to upload</span> or drag and
            drop
          </p>
          <p className="text-xs">{label}</p>
          <p className="text-xs">
            {acceptedTypes.map((t) => t.split('/')[1].toUpperCase()).join(', ')} up to{' '}
            {maxFileSize / 1024 / 1024} MB
          </p>
        </>
      )}
    </div>
  )
}
