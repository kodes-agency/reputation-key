// Profile settings form — edit name, email (read-only), and avatar
// Per conventions: receives user data, uses TanStack Form + Zod schema.
// Avatar upload uses org logo upload functions (TODO: fix S3 key to user profile path).
import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { putFilePresigned } from './upload-utils'
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
import { ImageUploadField } from '#/components/forms/image-upload-field'
import type { BaseFieldApi } from '#/components/forms/form-text-field'
import { authClient } from '#/shared/auth/auth-client'
import { toast } from 'sonner'
import {
  requestOrgLogoUpload,
  finalizeOrgLogoUpload,
} from '#/contexts/identity/server/organizations'

// ── Schema ──────────────────────────────────────────────────────────

const profileSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
})

type FormValues = z.infer<typeof profileSchema>

// ── Props ───────────────────────────────────────────────────────────

export type Props = Readonly<{
  user: {
    name: string
    email: string
    image: string | null
  }
}>

// ── Component ───────────────────────────────────────────────────────

export function ProfileSettingsForm({ user }: Props) {
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.image)

  const requestUpload = useServerFn(requestOrgLogoUpload)
  const finalizeUpload = useServerFn(finalizeOrgLogoUpload)

  const form = useForm({
    defaultValues: {
      name: user.name,
    } satisfies FormValues,
    validators: { onSubmit: profileSchema },
    onSubmit: async ({ value }) => {
      setIsPending(true)
      setError(null)
      try {
        await authClient.updateUser({ name: value.name })
        toast.success('Profile updated successfully')
      } catch (err) {
        setError(err)
      } finally {
        setIsPending(false)
      }
    },
  })

  // Avatar upload handler
  async function handleAvatarUpload(file: File): Promise<string> {
    const { uploadUrl, key } = await requestUpload({
      data: { contentType: file.type, fileSize: file.size },
    })
    await putFilePresigned(uploadUrl, file)
    const result = await finalizeUpload({ data: { key } })

    // Persist avatar URL via better-auth
    await authClient.updateUser({ image: result.logoUrl })
    toast.success('Avatar updated successfully')
    return result.logoUrl
  }

  return (
    <div className="space-y-6">
      <FormErrorBanner error={error} />

      {/* Avatar card */}
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
            onImageUrlChange={setAvatarUrl}
            onUpload={handleAvatarUpload}
            variant="circle"
            disabled={isPending}
          />
        </CardContent>
      </Card>

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
              <SubmitButton mutation={{ isPending, error }} form={form}>
                Save Changes
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
