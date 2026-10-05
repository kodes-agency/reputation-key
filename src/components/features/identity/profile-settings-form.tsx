import { useForm } from '@tanstack/react-form'
import { putFilePresigned } from '#/components/forms/image-setting/put-file-presigned'
import { DescriptionItem, DescriptionList } from '#/components/ui/description-list'
import { FormActions } from '#/components/forms/form-actions'
import { submitHandler } from '#/components/forms/form-submit'
import { FormTextField } from '#/components/forms/form-text-field'
import { SubmitButton } from '#/components/forms/submit-button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#/components/ui/card'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { AvatarCard } from './avatar-card'
import type { Action } from '#/components/hooks/use-action'
import {
  updateProfileInputSchema,
  type UpdateProfileInput,
} from '#/contexts/identity/application/dto/profile-settings.dto'

export type Props = Readonly<{
  user: {
    name: string
    email: string
    image: string | null
  }
  updateProfile: Action<{ data: { name: string } }>
  updateUserImage: Action<{ data: { imageUrl: string } }>
  /** Saves the avatar's removal: the same server call, with no image. */
  removeUserImage: Action<{ data: { imageUrl: null } }>
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
  removeUserImage,
  requestAvatarUpload,
  finalizeAvatarUpload,
}: Props) {
  const form = useForm({
    defaultValues: {
      name: user.name,
    } satisfies UpdateProfileInput,
    validators: { onSubmit: updateProfileInputSchema },
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

    // `updateUserImage` toasts the success itself; the form says nothing more.
    await updateUserImage({ data: { imageUrl: result.avatarUrl } })
    return result.avatarUrl
  }

  return (
    <div className="space-y-6">
      <AvatarCard
        avatarUrl={user.image}
        onUpload={handleAvatarUpload}
        // The mutation toasts the success; the setting says a refusal.
        onRemove={() => removeUserImage({ data: { imageUrl: null } })}
        disabled={updateProfile.isPending}
      />

      {/* Profile information card */}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Your details</CardTitle>
          <CardDescription>Update your name and view your email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitHandler(form)} className="space-y-6">
            <div className="space-y-6">
              <form.Field
                name="name"
                validators={{
                  onChangeAsync: updateProfileInputSchema.shape.name,
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

              <DescriptionList stacked aria-label="Sign-in email">
                <DescriptionItem term="Email">{user.email}</DescriptionItem>
              </DescriptionList>
            </div>

            <FormActions form={form} error={updateProfile.error}>
              <SubmitButton mutation={updateProfile} form={form}>
                Save changes
              </SubmitButton>
            </FormActions>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
