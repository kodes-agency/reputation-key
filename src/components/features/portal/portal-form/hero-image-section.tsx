import { ImageUploadField } from '#/components/forms/image-upload-field'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

type Props = Readonly<{
  heroImageUrl: string | null
  onImageUrlChange: (url: string | null) => void
  onUpload: (file: File, onProgress: (progress: number) => void) => Promise<string>
  disabled: boolean
}>

export function HeroImageSection({
  heroImageUrl,
  onImageUrlChange,
  onUpload,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-semibold">Hero Image</h3>
      <ImageUploadField
        imageUrl={heroImageUrl}
        onImageUrlChange={onImageUrlChange}
        onUpload={onUpload}
        disabled={disabled}
        variant="rect"
        acceptedTypes={ACCEPTED_TYPES}
        maxFileSize={MAX_FILE_SIZE}
        emptyLabel="Upload hero image"
      />
    </div>
  )
}
