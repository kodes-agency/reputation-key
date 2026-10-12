import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import { ImageSetting } from '#/components/forms/image-setting'

type Props = Readonly<{
  avatarUrl: string | null
  /** Stores the file and saves its address, resolving with the address to show. */
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<string>
  /** Saves the removal; a refusal rejects and the avatar stays. */
  onRemove: () => Promise<unknown>
  disabled: boolean
}>

export function AvatarCard({ avatarUrl, onUpload, onRemove, disabled }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Avatar</CardTitle>
        <CardDescription>The picture shown beside your name.</CardDescription>
      </CardHeader>
      <CardContent>
        <ImageSetting
          subject="avatar"
          imageUrl={avatarUrl}
          onUpload={onUpload}
          onRemove={onRemove}
          disabled={disabled}
        />
      </CardContent>
    </Card>
  )
}
