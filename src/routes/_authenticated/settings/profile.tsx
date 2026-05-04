import { createFileRoute } from '@tanstack/react-router'
import { ProfileSettingsPage } from '#/components/features/identity/profile-settings-page'
import type { AuthRouteContext } from '#/routes/_authenticated'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfileSettings,
})

function ProfileSettings() {
  const ctx = Route.useRouteContext() as AuthRouteContext
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your name, email, and avatar.
      </p>
      <div className="mt-6">
        <ProfileSettingsPage user={ctx.user} />
      </div>
    </>
  )
}
