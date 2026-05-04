// Image preview component for ImageUploadField.

import { cn } from '#/lib/utils'

type ImagePreviewProps = Readonly<{
  imageUrl: string
  className?: string
}>

export function ImagePreview({ imageUrl, className }: ImagePreviewProps) {
  return (
    <img src={imageUrl} alt="Image preview" className={cn('object-cover', className)} />
  )
}
