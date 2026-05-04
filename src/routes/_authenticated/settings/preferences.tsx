import { createFileRoute } from '@tanstack/react-router'
import { PreferencesSettingsPage } from '#/components/features/settings/preferences-settings-page'

export const Route = createFileRoute('/_authenticated/settings/preferences')({
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return <PreferencesSettingsPage />
}
