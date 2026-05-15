import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { ImageUploadField } from '#/components/forms/image-upload-field'

type Props = Readonly<{
  avatarUrl: string | null
  onAvatarUrlChange: (url: string | null) => void
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  disabled: boolean
}>

export function AvatarCard({ avatarUrl, onAvatarUrlChange, onUpload, disabled }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Avatar</CardTitle>
        <CardDescription>
          Upload a profile image. JPG, PNG, WebP, and GIF up to 5MB.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ImageUploadField
          imageUrl={avatarUrl}
          onImageUrlChange={onAvatarUrlChange}
          onUpload={onUpload}
          variant="circle"
          maxFileSize={5 * 1024 * 1024}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  )
}
