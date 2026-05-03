import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/settings/security')({
  component: SecuritySettings,
})

function SecuritySettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Security</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your password and two-factor authentication.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Security settings form will appear here.
      </div>
    </>
  )
}
