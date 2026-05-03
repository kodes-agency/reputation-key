import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings/profile')({
  component: ProfileSettings,
})

function ProfileSettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your name, email, and avatar.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Profile settings form will appear here.
      </div>
    </>
  )
}
