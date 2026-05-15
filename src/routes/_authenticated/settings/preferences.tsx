import { createFileRoute } from '@tanstack/react-router'
import { PreferencesSettingsPage } from '#/components/features/settings'

export const Route = createFileRoute('/_authenticated/settings/preferences')({
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return <PreferencesSettingsPage />
}
