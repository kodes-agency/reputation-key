import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/layout/page-header'
import { PreferencesSettingsPage } from '#/components/features/settings'

export const Route = createFileRoute('/_authenticated/settings/preferences')({
  component: PreferencesSettings,
})

function PreferencesSettings() {
  return (
    <>
      <PageHeader
        title="Preferences"
        description="Customize how the app looks and behaves."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Preferences' }]}
      />
      <PreferencesSettingsPage />
    </>
  )
}
