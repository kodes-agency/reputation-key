import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/_settings/preferences')({
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Preferences</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Theme, notifications, and display settings.
      </p>
      <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Preferences settings form will appear here.
      </div>
    </>
  )
}
