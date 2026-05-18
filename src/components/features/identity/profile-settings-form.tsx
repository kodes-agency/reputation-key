import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { z } from 'zod/v4'
import { putFilePresigned } from '#/components/forms/image-upload-field/put-file-presigned'
import { Field, FieldLabel } from '#/components/ui/field'
import { FormErrorBanner } from '#/components/forms/form-error-banner'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import { Input } from '#/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { toast } from 'sonner'
import { AvatarCard } from './avatar-card'
import type { Action } from '#/components/hooks/use-action'

const profileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
})

type FormValues = z.infer<typeof profileSchema>

export type Props = Readonly<{
  user: {
    name: string
    email: string
    image: string | null
  }
  updateProfile: Action<{ data: { name: string } }>
  updateUserImage: Action<{ data: { imageUrl: string } }>
  requestAvatarUpload: (data: {
    data: { contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeAvatarUpload: (data: { data: { key: string } }) => Promise<{
    avatarUrl: string
  }>
}>

export function ProfileSettingsForm({
  user,
  updateProfile,
  updateUserImage,
  requestAvatarUpload,
  finalizeAvatarUpload,
}: Props) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.image)

  const form = useForm({
    defaultValues: {
      name: user.name,
    } satisfies FormValues,
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      await updateProfile({ data: { name: value.name } })
    },
  })

  // Avatar upload handler
  async function handleAvatarUpload(
    file: File,
    onProgress: (percent: number) => void,
  ): Promise<string> {
    const { uploadUrl, key } = await requestAvatarUpload({
      data: { contentType: file.type, fileSize: file.size },
    })
    await putFilePresigned(uploadUrl, file, onProgress)
    const result = await finalizeAvatarUpload({ data: { key } })

    await updateUserImage({ data: { imageUrl: result.avatarUrl } })
    toast.success('Avatar updated successfully')
    return result.avatarUrl
  }

  return (
    <div className="space-y-6">
      <FormErrorBanner error={updateProfile.error} />

      <AvatarCard
        avatarUrl={avatarUrl}
        onAvatarUrlChange={setAvatarUrl}
        onUpload={handleAvatarUpload}
        disabled={updateProfile.isPending}
      />

      {/* Profile information card */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update your name and view your email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              form.handleSubmit()
            }}
            className="space-y-6"
          >
            <div className="space-y-6">
              <form.Field
                name="name"
                validators={{
                  onChangeAsync: profileSchema.shape.name,
                }}
              >
                {(field: BaseFieldApi) => (
                  <FormTextField
                    field={field}
                    label="Name"
                    id="name"
                    autoComplete="name"
                  />
                )}
              </form.Field>

              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input id="email" type="email" value={user.email} disabled />
              </Field>
            </div>

            <div className="flex justify-end">
              <SubmitButton mutation={updateProfile} form={form}>
                Save Changes
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
