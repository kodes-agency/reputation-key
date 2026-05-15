import { createFileRoute } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import { updateProfileFn } from '#/contexts/identity/server/auth-settings'
import {
  requestAvatarUpload,
  finalizeAvatarUpload,
} from '#/contexts/identity/server/organizations'
import { ProfileSettingsPage } from '#/components/features/identity'
import type { AuthRouteContext } from '#/routes/_authenticated'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfileSettings,
})

function ProfileSettings() {
  const ctx = Route.useRouteContext() as AuthRouteContext
  const updateProfile = useMutationAction(updateProfileFn, {
    successMessage: 'Profile updated successfully',
  })
  const requestUpload = useServerFn(requestAvatarUpload)
  const finalizeUpload = useServerFn(finalizeAvatarUpload)

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your name, email, and avatar.
      </p>
      <div className="mt-6">
        <ProfileSettingsPage
          user={ctx.user}
          updateProfile={updateProfile}
          requestAvatarUpload={requestUpload}
          finalizeAvatarUpload={finalizeUpload}
        />
      </div>
    </>
  )
}
