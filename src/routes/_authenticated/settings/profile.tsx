import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { useServerFn } from '@tanstack/react-start'
import { useMutationAction } from '#/components/hooks/use-mutation-action'
import {
  updateProfileFn,
  updateUserImageFn,
} from '#/contexts/identity/server/auth-settings'
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
  const updateUserImage = useMutationAction(updateUserImageFn, {
    successMessage: 'Avatar updated successfully',
  })
  const requestUpload = useServerFn(requestAvatarUpload)
  const finalizeUpload = useServerFn(finalizeAvatarUpload)

  return (
    <>
      <PageHeader
        title="Profile"
        description="Manage your name, email, and avatar."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Profile' }]}
      />
      <div className="mt-6">
        <ProfileSettingsPage
          user={ctx.user}
          updateProfile={updateProfile}
          updateUserImage={updateUserImage}
          requestAvatarUpload={requestUpload}
          finalizeAvatarUpload={finalizeUpload}
        />
      </div>
    </>
  )
}
